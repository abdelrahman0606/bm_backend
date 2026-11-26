const os = require("os");
const { GmailAccount } = require("./gmailAccountModel");
const { GmailMessage } = require("./gmailMessageModel");
const { GmailThread } = require("./gmailThreadModel");
const { GmailLabel } = require("./gmailLabelModel");
const accountService = require("./gmailAccountService");
const mime = require("./gmailMime");
const audit = require("./gmailAuditService");
const events = require("./gmailEvents");
const storage = require("./gmailStorage");
const directReader = require("./gmailDirectReader");

/**
 * Keeping the server's copy of a mailbox in step with Gmail.
 *
 * This is the part that has to be right, because it runs unattended and a
 * mistake here is silent: missed mail looks exactly like no mail.
 *
 * **Gmail's model.** A mailbox has a monotonic `historyId`. Every change
 * bumps it, and `users.history.list?startHistoryId=X` replays everything that
 * happened after X as a list of records — messages added, messages deleted,
 * labels added, labels removed. So synchronization is: remember the cursor,
 * ask for everything since, apply it, store the new cursor. The expensive
 * full walk happens exactly once per mailbox.
 *
 * **Three failure modes are designed for, not patched around.**
 *
 * 1. *The cursor goes stale.* Google keeps history for about a week, then
 *    answers 404 for a cursor older than that. A mailbox whose server was off
 *    for a fortnight cannot be caught up incrementally. That is not an error:
 *    `HISTORY_GONE` triggers a full pass, which converges on the same state.
 *
 * 2. *The notification never arrives.* Pub/Sub is at-least-once, not
 *    exactly-once, and a watch expires after seven days whatever happens. So
 *    push is an optimization for latency and never the only path: every
 *    account also carries `nextSyncAt` and the scheduler sweeps it. If push
 *    stops, mail arrives late rather than not at all.
 *
 * 3. *The same change is applied twice.* Every message write is an upsert
 *    keyed by `(accountId, gmailId)`, and a label change is a `$set` of the
 *    whole list rather than an increment. Replaying a history range is
 *    therefore without consequence, which is what makes retrying safe.
 *
 * **Two workers never sync one mailbox at once.** Not for correctness, which
 * the upserts already give, but for quota: the second worker would spend the
 * same API units to compute the same answer. A lease on the account row makes
 * the claim atomic, and it expires, so a worker that dies mid-pass does not
 * hold the mailbox forever.
 */

/** Identifies this process in a lease, so a stuck lock can be traced. */
const WORKER_ID = `${os.hostname()}:${process.pid}`;

/** How long a worker may hold a mailbox before the lease is assumed dead. */
const LEASE_MS = 10 * 60 * 1000;

/** Message fetches in flight at once during a pass. */
const FETCH_CONCURRENCY = 5;

/** Ids listed per page while walking a mailbox. */
const LIST_PAGE_SIZE = 200;

/**
 * How many messages one initial pass stores before stopping to be resumed.
 *
 * A mailbox with 300,000 messages cannot be walked in a single run without
 * holding a lease for hours and spending the day's quota. The pass saves its
 * page token and returns; the scheduler picks it up on the next tick. The
 * user sees their mail arrive in pages, newest first — the order they want it
 * in anyway.
 */
const INITIAL_BATCH_LIMIT =
  Number(process.env.GMAIL_INITIAL_BATCH_LIMIT) || 1000;

/** Bodies larger than this are left in Gmail and fetched when opened. */
const MAX_STORED_BODY_BYTES = 512 * 1024;

/** How far back a first pass reaches, in days. 0 means the whole mailbox. */
const INITIAL_SYNC_DAYS = Number(process.env.GMAIL_INITIAL_SYNC_DAYS) || 0;

/** How long an up-to-date mailbox waits before being checked again. */
const IDLE_RESYNC_MS =
  Number(process.env.GMAIL_IDLE_RESYNC_MS) || 15 * 60 * 1000;

/** Failures in a row before a mailbox stops being retried automatically. */
const MAX_CONSECUTIVE_FAILURES =
  Number(process.env.GMAIL_MAX_SYNC_FAILURES) || 8;

/** Marker for "the cursor is too old to replay". */
const HISTORY_GONE = "historyGone";

/**
 * Compares two Gmail history ids.
 *
 * They are unsigned 64-bit values, which do not survive `Number`, so they are
 * compared as decimal strings: by length first, then lexically. Getting this
 * wrong would let a late notification move the cursor backwards and replay
 * days of history — or, worse, forward past unread changes.
 */
const historyIdIsNewer = (candidate, current) => {
  if (!candidate) return false;
  if (!current) return true;
  const a = String(candidate);
  const b = String(current);
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
};

// ───────────────────────────── Storing messages ────────────────────────────

/**
 * Turns one Gmail message into the fields this backend stores.
 *
 * Pure — no database, no network — so the mapping can be tested against real
 * API fixtures, which is where the subtle bugs are. `origin` is the caller's
 * knowledge rather than the message's: only our own send path knows that a
 * message is one of ours.
 */
const mapMessage = (raw, { origin = "imported", storeBody = true } = {}) => {
  const headers = raw.payload?.headers || [];
  const parts = mime.walkParts(raw.payload);
  const labelIds = raw.labelIds || [];

  const header = (name) => mime.headerValue(headers, name);

  const { text, html } = parts;
  const bodyBytes =
    Buffer.byteLength(text || "", "utf8") +
    Buffer.byteLength(html || "", "utf8");
  const keepBody = storeBody && bodyBytes <= MAX_STORED_BODY_BYTES;

  // `internalDate` is epoch milliseconds as a string, and it is the only
  // trustworthy timestamp: the `Date` header is written by the sender and is
  // routinely wrong, sometimes by years.
  const internalDate = raw.internalDate
    ? new Date(Number(raw.internalDate))
    : new Date();

  const document = {
    gmailId: raw.id,
    threadId: raw.threadId,
    historyId: raw.historyId ? String(raw.historyId) : null,
    subject: mime.decodeEncodedWords(header("subject") || ""),
    from: mime.parseAddress(header("from")) || {},
    replyTo: mime.parseAddressList(header("reply-to")),
    to: mime.parseAddressList(header("to")),
    cc: mime.parseAddressList(header("cc")),
    rfcMessageId: header("message-id") || null,
    inReplyTo: header("in-reply-to") || null,
    references: String(header("references") || "")
      .split(/\s+/)
      .filter(Boolean),
    labelIds,
    snippet: mime.decodeEncodedWords(raw.snippet || ""),
    internalDate,
    sizeEstimate: Number(raw.sizeEstimate) || 0,
    attachments: parts.attachments,
    // An inline image with no filename is part of the body, not a file the
    // user attached, so it does not raise the paperclip.
    hasAttachments: parts.attachments.some(
      (attachment) => !attachment.inline || Boolean(attachment.filename),
    ),
    origin,
  };

  if (keepBody && (text || html)) {
    document.bodyText = text;
    document.bodyHtml = html;
    document.bodyFetchedAt = new Date();
    document.bodyTruncated = false;
  } else if (storeBody && bodyBytes > MAX_STORED_BODY_BYTES) {
    // Left unfetched rather than cut: half a message stored as though it
    // were whole is worse than one the reader has to open.
    document.bodyFetchedAt = null;
    document.bodyTruncated = true;
  }

  GmailMessage.applyLabelFlags(document);
  return document;
};

/**
 * Writes one message, creating or updating it.
 *
 * Returns `{ message, created }`. The upsert is what makes replay harmless,
 * and `created` is what decides whether a "new mail" event is published: a
 * message seen twice must not notify twice.
 */
const storeMessage = async (account, raw, options = {}) => {
  if (!storage.keepsMessages()) {
    // Nothing is stored in direct mode. Returning the mapped message keeps
    // the callers that only want the shape working, and `created: false`
    // stops anything treating this as news.
    return { message: mapMessage(raw, options), created: false };
  }

  const fields = mapMessage(raw, options);

  const result = await GmailMessage.findOneAndUpdate(
    { accountId: account._id, gmailId: raw.id },
    {
      $set: { ...fields, userId: account.userId },
      $setOnInsert: { accountId: account._id },
    },
    { new: true, upsert: true, includeResultMetadata: true },
  );

  const message = result.value || result;
  // The driver's own result is the only honest signal for "was this new":
  // comparing timestamps would misread a message updated in the same
  // millisecond it was created.
  const created = result.lastErrorObject
    ? !result.lastErrorObject.updatedExisting
    : false;

  return { message, created };
};

/**
 * Rebuilds a thread summary from the messages now stored for it.
 *
 * Reads them back rather than trusting the batch in hand: a reply can arrive
 * in a different history record than the message it answers, and a summary
 * built from one record alone would undercount the conversation.
 */
const refreshThread = async (account, threadId) => {
  if (!threadId || !storage.keepsMessages()) return null;

  const messages = await GmailMessage.find({
    accountId: account._id,
    threadId,
  })
    .select(
      "gmailId internalDate subject snippet labelIds isUnread isStarred " +
        "isInInbox isTrashed hasAttachments from to cc historyId",
    )
    .lean();

  if (messages.length === 0) {
    await GmailThread.deleteOne({ accountId: account._id, gmailId: threadId });
    return null;
  }

  const summary = GmailThread.summaryFrom(messages);
  return GmailThread.findOneAndUpdate(
    { accountId: account._id, gmailId: threadId },
    {
      $set: { ...summary, userId: account.userId },
      $setOnInsert: { accountId: account._id, gmailId: threadId },
    },
    { new: true, upsert: true },
  );
};

/** Mirrors the mailbox's labels. Gmail is the source of truth; we overwrite. */
const syncLabels = async (account) => {
  // Nothing to mirror: the read path asks Gmail for labels when it needs
  // them, which is one quota unit and always current.
  if (!storage.keepsMessages()) return { synced: 0, removed: 0 };

  const client = accountService.clientFor(account);
  const response = await client.labels.list();
  const labels = response.labels || [];

  await Promise.all(
    labels.map((label) =>
      GmailLabel.updateOne(
        { accountId: account._id, labelId: label.id },
        {
          $set: {
            userId: account.userId,
            name: label.name,
            type: label.type === "system" ? "system" : "user",
            messageListVisibility: label.messageListVisibility || null,
            labelListVisibility: label.labelListVisibility || null,
            color: {
              textColor: label.color?.textColor || null,
              backgroundColor: label.color?.backgroundColor || null,
            },
            messagesTotal: label.messagesTotal ?? null,
            messagesUnread: label.messagesUnread ?? null,
            threadsTotal: label.threadsTotal ?? null,
            threadsUnread: label.threadsUnread ?? null,
            syncedAt: new Date(),
          },
          $setOnInsert: { accountId: account._id, labelId: label.id },
        },
        { upsert: true },
      ),
    ),
  );

  // A label deleted in Gmail has to go here too, or it sits in the filter
  // list forever pointing at nothing.
  const keep = labels.map((label) => label.id);
  const removed = await GmailLabel.deleteMany({
    accountId: account._id,
    labelId: { $nin: keep },
  });

  await GmailAccount.updateOne(
    { _id: account._id },
    { $set: { labelsSyncedAt: new Date() } },
  );

  if (labels.length > 0 || removed.deletedCount > 0) {
    events.labelsChanged({
      userId: account.userId,
      accountId: account._id,
      count: labels.length,
    });
  }

  return { synced: labels.length, removed: removed.deletedCount || 0 };
};

/**
 * Fetches a list of message ids, a few at a time.
 *
 * Bounded concurrency rather than `Promise.all` over a whole page: 200
 * simultaneous requests is how a sync earns a rate limit, and the client's
 * backoff would then serialize them anyway — slower, with wasted calls. A
 * message that vanished between listing and fetching resolves to null rather
 * than failing the batch, because mail does get deleted while you read it.
 */
const fetchMessages = async (client, ids, { format = "full" } = {}) => {
  const chunks = [];
  for (let index = 0; index < ids.length; index += FETCH_CONCURRENCY) {
    chunks.push(ids.slice(index, index + FETCH_CONCURRENCY));
  }

  const fetched = [];
  await chunks.reduce(
    (previous, chunk) =>
      previous.then(async () => {
        const batch = await Promise.all(
          chunk.map((id) =>
            client.messages.get(id, { format }).catch((error) => {
              if (error.httpStatus === 404) return null;
              throw error;
            }),
          ),
        );
        batch.filter(Boolean).forEach((message) => fetched.push(message));
      }),
    Promise.resolve(),
  );

  return fetched;
};

// ─────────────────────────────── Full pass ─────────────────────────────────

/**
 * Walks the mailbox and stores what it finds, newest first.
 *
 * The order of the first two steps matters and is easy to get backwards: the
 * current `historyId` is read **before** anything is listed. Anything that
 * arrives during the walk then falls after that cursor and is picked up by
 * the next incremental pass. Reading the cursor afterwards would skip
 * everything that arrived while the walk was running.
 *
 * Resumable: when a pass reaches `INITIAL_BATCH_LIMIT` it saves its page
 * token and returns `{ done: false }`, and the scheduler calls it again.
 */
const runFullSync = async (account, { limit = INITIAL_BATCH_LIMIT } = {}) => {
  const client = accountService.clientFor(account);

  // In direct mode there is no backfill, because there is nothing to fill:
  // every read goes to Gmail, which already holds the whole mailbox. All a
  // "full pass" has to do is establish the history cursor, so that the next
  // incremental pass knows what counts as new. One call instead of a walk
  // over every message the mailbox has ever held.
  if (!storage.keepsMessages()) {
    const profile = await client.getProfile();
    await GmailAccount.updateOne(
      { _id: account._id },
      {
        $set: {
          messagesTotal: profile.messagesTotal ?? null,
          threadsTotal: profile.threadsTotal ?? null,
          "syncState.lastHistoryId": profile.historyId
            ? String(profile.historyId)
            : null,
          "syncState.initialPageToken": null,
          "syncState.lastSyncAt": new Date(),
          "syncState.lastFullSyncAt": new Date(),
          "syncState.status": "idle",
        },
      },
    );
    return {
      mode: "cursor",
      done: true,
      stored: 0,
      added: 0,
      updated: 0,
      removed: 0,
    };
  }

  const resuming = Boolean(account.syncState?.initialPageToken);

  // Only on a fresh pass: resuming must keep the cursor the first page
  // established rather than moving it forward to now.
  let anchorHistoryId = account.syncState?.lastHistoryId || null;
  if (!resuming) {
    const profile = await client.getProfile();
    anchorHistoryId = profile.historyId ? String(profile.historyId) : null;
    await GmailAccount.updateOne(
      { _id: account._id },
      {
        $set: {
          messagesTotal: profile.messagesTotal ?? null,
          threadsTotal: profile.threadsTotal ?? null,
        },
      },
    );
  }

  await syncLabels(account);

  const query =
    INITIAL_SYNC_DAYS > 0 ? `newer_than:${INITIAL_SYNC_DAYS}d` : undefined;
  const threadIds = new Set();
  const counters = { stored: 0, added: 0 };

  /**
   * One page, then the next, recursively.
   *
   * Recursion rather than a loop so each page's token is a parameter instead
   * of mutable state, and so the stopping condition — the limit, or no next
   * token — is in one place. Depth is bounded by `limit / LIST_PAGE_SIZE`.
   */
  const processPage = async (pageToken) => {
    const page = await client.messages.list({
      maxResults: LIST_PAGE_SIZE,
      pageToken,
      q: query,
      // The first pass takes the whole mailbox, trash and spam included: a
      // user looking for something they deleted expects to find it, and
      // excluding them would make the local copy quietly incomplete.
      includeSpamTrash: true,
    });

    const ids = (page.messages || []).map((message) => message.id);

    if (ids.length > 0) {
      const raws = await fetchMessages(client, ids);
      // Bodies are not stored during a full pass: for a large mailbox that is
      // gigabytes of text nobody has asked to read. Envelopes, labels and
      // attachment descriptors are, so lists and filters are complete, and a
      // body is fetched the first time a message is opened.
      const results = await Promise.all(
        raws.map((raw) => storeMessage(account, raw, { storeBody: false })),
      );
      results.forEach(({ message, created }) => {
        counters.stored += 1;
        if (created) counters.added += 1;
        threadIds.add(message.threadId);
      });
    }

    const next = page.nextPageToken || null;
    if (next && counters.stored < limit) return processPage(next);
    return next;
  };

  const remainingToken = await processPage(
    account.syncState?.initialPageToken || undefined,
  );

  await Promise.all(
    Array.from(threadIds).map((threadId) => refreshThread(account, threadId)),
  );

  const done = !remainingToken;
  const update = {
    "syncState.initialPageToken": done ? null : remainingToken,
    "syncState.initialSyncedCount":
      (account.syncState?.initialSyncedCount || 0) + counters.stored,
    "syncState.lastSyncAt": new Date(),
    "syncState.status": done ? "idle" : "initial",
    // Held while the walk is in progress so a resumed pass knows where it
    // started; only *adopted* as the live cursor once the walk finishes.
    "syncState.lastHistoryId": anchorHistoryId,
  };

  if (done) {
    update["syncState.lastFullSyncAt"] = new Date();
  }

  await GmailAccount.updateOne({ _id: account._id }, { $set: update });

  return {
    mode: "full",
    done,
    stored: counters.stored,
    added: counters.added,
    updated: counters.stored - counters.added,
    removed: 0,
  };
};

// ──────────────────────────── Incremental pass ─────────────────────────────

/**
 * Folds one history record into the batch being collected.
 *
 * Gmail reports four kinds of change and they can appear in the same record
 * for the same message, so they are collected and applied once rather than
 * applied as they are read. The handling is deliberately asymmetric:
 *
 *  - *added* needs a fetch, because the record carries only ids;
 *  - *deleted* is a local delete — the message is gone from Gmail for good;
 *  - *label changes* accumulate into one add/remove pair per message, and
 *    Gmail's own full label list wins over the deltas when it sends one.
 *
 * Synchronous and pure: it only mutates the accumulator it is handed, which
 * is what lets a page of 500 records be folded without any I/O.
 */
const applyHistoryRecord = (record, collected) => {
  (record.messagesAdded || []).forEach((entry) => {
    if (entry.message?.id) collected.addedIds.add(entry.message.id);
  });

  (record.messagesDeleted || []).forEach((entry) => {
    if (entry.message?.id) collected.deletedIds.add(entry.message.id);
  });

  const changes = [
    ...(record.labelsAdded || []).map((entry) => ({
      entry,
      add: entry.labelIds || [],
      remove: [],
    })),
    ...(record.labelsRemoved || []).map((entry) => ({
      entry,
      add: [],
      remove: entry.labelIds || [],
    })),
  ];

  changes.forEach(({ entry, add, remove }) => {
    const id = entry.message?.id;
    if (!id) return;

    const existing = collected.labelChanges.get(id) || {
      threadId: entry.message?.threadId || null,
      add: new Set(),
      remove: new Set(),
      authoritative: null,
    };

    add.forEach((label) => {
      existing.add.add(label);
      existing.remove.delete(label);
    });
    remove.forEach((label) => {
      existing.remove.add(label);
      existing.add.delete(label);
    });

    // Gmail usually echoes the message's whole label list. When it does, that
    // is the truth and the deltas are redundant; the last record wins,
    // because records arrive in order.
    if (entry.message?.labelIds) {
      existing.authoritative = entry.message.labelIds;
    }

    collected.labelChanges.set(id, existing);
  });

  return collected;
};

/** Writes the collected label changes, recomputing the derived flags. */
const applyLabelChanges = async (account, labelChanges) => {
  const touchedThreads = new Set();
  let updated = 0;

  await Promise.all(
    Array.from(labelChanges.entries()).map(async ([gmailId, change]) => {
      const message = await GmailMessage.findOne({
        accountId: account._id,
        gmailId,
      }).select("labelIds threadId");

      // Not stored yet: it will arrive through `messagesAdded` with its
      // labels already correct, so there is nothing to patch.
      if (!message) return;

      const next = change.authoritative
        ? [...change.authoritative]
        : Array.from(
            new Set(
              (message.labelIds || [])
                .filter((label) => !change.remove.has(label))
                .concat(Array.from(change.add)),
            ),
          );

      const before = [...(message.labelIds || [])].sort().join(",");
      const after = [...next].sort().join(",");
      if (before === after) return;

      const flags = { labelIds: next };
      GmailMessage.applyLabelFlags(flags);
      await GmailMessage.updateOne({ _id: message._id }, { $set: flags });
      updated += 1;
      touchedThreads.add(message.threadId || change.threadId);

      events.messageUpdated({
        userId: account.userId,
        accountId: account._id,
        message: { gmailId, threadId: message.threadId, ...flags },
        changed: ["labelIds"],
      });
    }),
  );

  return { updated, touchedThreads };
};

/**
 * Delivers what changed without writing any of it down.
 *
 * This is the direct-mode counterpart of the storing pass, and it is the
 * whole point of that mode: a new message is fetched once and handed to the
 * client **in the event that announces it**, rather than being written to a
 * database so the client can ask for it back. One Gmail fetch, one frame,
 * no copy.
 *
 * The body travels with it, capped — a notification the user cannot open
 * without a round trip is most of the way to no notification at all. Over
 * the cap the envelope goes alone and the client fetches the message, which
 * is the right trade for the rare enormous mail.
 *
 * Label changes need no fetch at all: Gmail's history records carry the
 * message's whole label list, so the frame is built straight from the record.
 * That is strictly better than the storing path, which has to read the row
 * back to compute a delta.
 */
const deliverWithoutStoring = async (account, collected, newestHistoryId) => {
  const client = accountService.clientFor(account);
  let added = 0;

  if (collected.addedIds.size > 0) {
    const raws = await fetchMessages(client, Array.from(collected.addedIds));

    raws.forEach((raw) => {
      const row = directReader.toRow(raw, String(account._id), {
        withBody: true,
      });

      // Our own sends come back through history too, and a notification for
      // the message you just sent is noise.
      if (row.isSent || row.isDraft) return;

      added += 1;
      events.messageReceived({
        userId: account.userId,
        accountId: account._id,
        accountEmail: account.email,
        message: row,
        // The body, so the client can show the message without asking for
        // it. Dropped above the cap rather than truncated: half a message
        // presented as whole is worse than one that needs a fetch.
        body:
          Buffer.byteLength(row.bodyText || "", "utf8") <=
          directReader.MAX_PREVIEW_BODY_BYTES
            ? row.bodyText
            : null,
      });
    });
  }

  let updated = 0;
  collected.labelChanges.forEach((change, gmailId) => {
    // Only the records where Gmail sent the whole list are acted on. A bare
    // delta would need the previous labels to apply to, and in this mode
    // there is nothing holding them — so it is left for the client's own
    // refetch rather than guessed at.
    if (!change.authoritative) return;
    updated += 1;
    const labels = new Set(change.authoritative);
    events.messageUpdated({
      userId: account.userId,
      accountId: account._id,
      message: {
        gmailId,
        threadId: change.threadId,
        labelIds: change.authoritative,
        isUnread: labels.has("UNREAD"),
        isStarred: labels.has("STARRED"),
        isInInbox: labels.has("INBOX"),
        isTrashed: labels.has("TRASH"),
      },
      changed: ["labelIds"],
    });
  });

  const removed = collected.deletedIds.size;
  if (removed > 0) {
    events.messageDeleted({
      userId: account.userId,
      accountId: account._id,
      gmailIds: Array.from(collected.deletedIds),
      permanent: true,
    });
  }

  await GmailAccount.updateOne(
    { _id: account._id },
    {
      $set: {
        "syncState.lastHistoryId": String(newestHistoryId),
        "syncState.lastSyncAt": new Date(),
        "syncState.status": "idle",
      },
    },
  );

  return {
    mode: "incremental",
    done: true,
    stored: 0,
    added,
    updated,
    removed,
  };
};

/**
 * Catches a mailbox up from its stored cursor.
 *
 * Throws an error tagged `HISTORY_GONE` when Gmail refuses the cursor, which
 * the caller turns into a full pass. That is a designed path, not a fallback
 * bolted on: a server offline for longer than Google's history window has no
 * other way back to a correct state.
 */
const runIncrementalSync = async (account) => {
  const startHistoryId = account.syncState?.lastHistoryId;
  if (!startHistoryId) {
    const error = new Error("No history cursor; a full pass is needed");
    error.reason = HISTORY_GONE;
    throw error;
  }

  const client = accountService.clientFor(account);
  const collected = {
    addedIds: new Set(),
    deletedIds: new Set(),
    labelChanges: new Map(),
  };
  let newestHistoryId = startHistoryId;

  const readPage = async (pageToken) => {
    const page = await client.history.list({
      startHistoryId,
      pageToken,
      maxResults: 500,
    });

    (page.history || []).forEach((record) =>
      applyHistoryRecord(record, collected),
    );

    if (historyIdIsNewer(page.historyId, newestHistoryId)) {
      newestHistoryId = String(page.historyId);
    }

    if (page.nextPageToken) return readPage(page.nextPageToken);
    return null;
  };

  try {
    await readPage(undefined);
  } catch (error) {
    if (error.httpStatus === 404) {
      const stale = new Error(
        "Gmail no longer holds history from this point; a full pass is needed",
      );
      stale.reason = HISTORY_GONE;
      throw stale;
    }
    throw error;
  }

  // A message added and then deleted inside the same range never existed as
  // far as this mailbox is concerned.
  collected.deletedIds.forEach((id) => collected.addedIds.delete(id));

  if (!storage.keepsMessages()) {
    return deliverWithoutStoring(account, collected, newestHistoryId);
  }

  const touchedThreads = new Set();
  let added = 0;

  if (collected.addedIds.size > 0) {
    const raws = await fetchMessages(client, Array.from(collected.addedIds));
    const results = await Promise.all(
      // New mail is stored with its body: it is one message, the user is
      // about to read it, and a notification that cannot be opened is worse
      // than the storage is worth.
      raws.map((raw) => storeMessage(account, raw, { storeBody: true })),
    );

    results.forEach(({ message, created }) => {
      touchedThreads.add(message.threadId);
      if (!created) return;
      added += 1;

      // Only genuinely incoming mail is announced as received. Our own sends
      // come back through history too, and a notification for the message
      // you just sent is noise.
      const isOutgoing = message.isSent || message.isDraft;
      if (!isOutgoing) {
        events.messageReceived({
          userId: account.userId,
          accountId: account._id,
          accountEmail: account.email,
          message,
        });
      }
    });
  }

  let removed = 0;
  if (collected.deletedIds.size > 0) {
    const ids = Array.from(collected.deletedIds);
    const existing = await GmailMessage.find({
      accountId: account._id,
      gmailId: { $in: ids },
    })
      .select("threadId")
      .lean();
    existing.forEach((message) => touchedThreads.add(message.threadId));

    const result = await GmailMessage.deleteMany({
      accountId: account._id,
      gmailId: { $in: ids },
    });
    removed = result.deletedCount || 0;

    if (removed > 0) {
      events.messageDeleted({
        userId: account.userId,
        accountId: account._id,
        gmailIds: ids,
        permanent: true,
      });
    }
  }

  const labelResult = await applyLabelChanges(account, collected.labelChanges);
  labelResult.touchedThreads.forEach((threadId) =>
    touchedThreads.add(threadId),
  );

  const threads = await Promise.all(
    Array.from(touchedThreads)
      .filter(Boolean)
      .map((threadId) => refreshThread(account, threadId)),
  );
  threads.filter(Boolean).forEach((thread) =>
    events.threadUpdated({
      userId: account.userId,
      accountId: account._id,
      thread,
    }),
  );

  await GmailAccount.updateOne(
    { _id: account._id },
    {
      $set: {
        "syncState.lastHistoryId": String(newestHistoryId),
        "syncState.lastSyncAt": new Date(),
        "syncState.status": "idle",
      },
    },
  );

  return {
    mode: "incremental",
    done: true,
    stored: added,
    added,
    updated: labelResult.updated,
    removed,
  };
};

// ───────────────────────────── Orchestration ───────────────────────────────

/**
 * Takes the lease on a mailbox, or reports that somebody else holds it.
 *
 * One atomic `findOneAndUpdate`: the filter matches only a free or expired
 * lease, so two workers racing cannot both win. The expiry is what stops a
 * crashed worker locking a mailbox permanently.
 */
const claimLease = async (accountId, { leaseMs = LEASE_MS } = {}) => {
  const now = new Date();
  const until = new Date(now.getTime() + leaseMs);

  return GmailAccount.findOneAndUpdate(
    {
      _id: accountId,
      $or: [
        { "syncState.lockedUntil": null },
        { "syncState.lockedUntil": { $lt: now } },
      ],
    },
    {
      $set: {
        "syncState.lockedBy": WORKER_ID,
        "syncState.lockedUntil": until,
      },
    },
    { new: true },
  );
};

const releaseLease = (accountId, extra = {}) =>
  GmailAccount.updateOne(
    { _id: accountId },
    {
      $set: {
        "syncState.lockedBy": null,
        "syncState.lockedUntil": null,
        ...extra,
      },
    },
  );

/**
 * How long to wait after a failure: one minute, doubling, capped at an hour.
 *
 * Capped rather than unbounded, so a mailbox that failed overnight is retried
 * in the morning without anyone intervening — and spaced out, so a Gmail
 * outage does not turn into a retry storm against it.
 */
const backoffFor = (failureCount) => {
  const minutes = Math.min(2 ** Math.max(0, failureCount - 1), 60);
  return new Date(Date.now() + minutes * 60 * 1000);
};

/** Picks the pass this mailbox needs. */
const chooseMode = (account, requested) => {
  if (requested === "full") return "full";
  if (account.syncState?.initialPageToken) return "full";
  if (!account.syncState?.lastHistoryId) return "full";
  return "incremental";
};

/**
 * Syncs one mailbox. The entry point for the scheduler and for a push.
 *
 * `mode` is a request, not an instruction: `auto` picks an incremental pass
 * when there is a usable cursor and a full one otherwise, and an incremental
 * pass that finds its cursor stale upgrades itself. No caller has to know
 * which is needed.
 */
const syncAccount = async (
  accountOrId,
  { mode = "auto", force = false } = {},
) => {
  const accountId = accountOrId._id || accountOrId;
  const locked = await claimLease(accountId);

  if (!locked) return { skipped: "locked", accountId: String(accountId) };

  if (locked.needsReauth && !force) {
    await releaseLease(accountId, {
      "syncState.status": "failed",
      "syncState.nextSyncAt": null,
    });
    return { skipped: "needsReauth", accountId: String(accountId) };
  }

  const startedAt = Date.now();
  events.syncStarted({ userId: locked.userId, accountId: locked._id, mode });

  try {
    let result;
    if (chooseMode(locked, mode) === "full") {
      result = await runFullSync(locked);
    } else {
      try {
        result = await runIncrementalSync(locked);
      } catch (error) {
        if (error.reason !== HISTORY_GONE) throw error;
        // The designed recovery: the cursor is unusable, so converge the slow
        // way. The mailbox ends in the same state either way.
        console.warn(
          `[gmail] history gone for ${locked.email}; running a full pass`,
        );
        const fresh = await GmailAccount.findById(accountId);
        fresh.syncState.initialPageToken = null;
        fresh.syncState.lastHistoryId = null;
        result = await runFullSync(fresh);
        result.recoveredFromStaleCursor = true;
      }
    }

    const durationMs = Date.now() - startedAt;
    await releaseLease(accountId, {
      "syncState.failureCount": 0,
      "syncState.lastError": null,
      // An unfinished initial pass is asked for again at once; a mailbox that
      // is up to date waits for the ordinary interval.
      "syncState.nextSyncAt": result.done
        ? new Date(Date.now() + IDLE_RESYNC_MS)
        : new Date(),
    });

    events.syncCompleted({
      userId: locked.userId,
      accountId: locked._id,
      mode: result.mode,
      added: result.added || 0,
      updated: result.updated || 0,
      removed: result.removed || 0,
      durationMs,
    });

    return { ...result, accountId: String(accountId), durationMs };
  } catch (error) {
    const failureCount = (locked.syncState?.failureCount || 0) + 1;
    const willRetry = failureCount < MAX_CONSECUTIVE_FAILURES;

    await releaseLease(accountId, {
      "syncState.status": willRetry ? "idle" : "failed",
      "syncState.failureCount": failureCount,
      "syncState.lastError": error.message,
      "syncState.lastErrorAt": new Date(),
      "syncState.nextSyncAt": willRetry ? backoffFor(failureCount) : null,
    });

    await audit.record({
      accountId,
      userId: locked.userId,
      operation: "sync.failed",
      actor: audit.systemActor("gmail-sync"),
      status: "failed",
    });

    events.syncFailed({
      userId: locked.userId,
      accountId: locked._id,
      mode,
      error,
      willRetry,
    });

    // A grant Google has stopped accepting is the user's to fix, and they
    // cannot fix what they are not told about.
    if (error.statusCode === 401 || error.httpStatus === 401) {
      events.accountNeedsReauth({
        userId: locked.userId,
        accountId: locked._id,
        email: locked.email,
        reason: error.message,
      });
    }

    console.error(
      `[gmail] sync failed for ${locked.email} ` +
        `(attempt ${failureCount}): ${error.message}`,
    );

    return {
      accountId: String(accountId),
      failed: true,
      error: error.message,
      willRetry,
    };
  }
};

/**
 * Mailboxes the scheduler should look at now.
 *
 * Ordered by how overdue they are, so a backlog is worked through fairly
 * rather than one mailbox starving the rest.
 */
const dueAccounts = ({ now = new Date(), limit = 20 } = {}) =>
  GmailAccount.find({
    isEnabled: true,
    needsReauth: false,
    "syncState.nextSyncAt": { $ne: null, $lte: now },
    $or: [
      { "syncState.lockedUntil": null },
      { "syncState.lockedUntil": { $lt: now } },
    ],
  })
    .sort({ "syncState.nextSyncAt": 1 })
    .limit(limit)
    .select("_id email userId");

/**
 * Asks for a mailbox to be synced soon.
 *
 * Used by the push endpoint, which has to answer Pub/Sub in milliseconds and
 * cannot wait for a sync to run. Setting `nextSyncAt` is the handoff:
 * durable, so the request survives a restart, and idempotent, so ten
 * notifications in a second produce one pass.
 */
const requestSync = (accountId, { delayMs = 0 } = {}) =>
  GmailAccount.updateOne(
    { _id: accountId },
    { $set: { "syncState.nextSyncAt": new Date(Date.now() + delayMs) } },
  );

module.exports = {
  WORKER_ID,
  LEASE_MS,
  INITIAL_BATCH_LIMIT,
  MAX_STORED_BODY_BYTES,
  IDLE_RESYNC_MS,
  MAX_CONSECUTIVE_FAILURES,
  HISTORY_GONE,
  historyIdIsNewer,
  mapMessage,
  storeMessage,
  refreshThread,
  syncLabels,
  fetchMessages,
  applyHistoryRecord,
  applyLabelChanges,
  runFullSync,
  runIncrementalSync,
  claimLease,
  releaseLease,
  backoffFor,
  chooseMode,
  syncAccount,
  dueAccounts,
  requestSync,
  deliverWithoutStoring,
};
