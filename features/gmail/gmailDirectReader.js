const ApiError = require("../../utils/apiError");
const accountService = require("./gmailAccountService");
const mime = require("./gmailMime");

/**
 * Reads mail straight from Gmail, storing nothing.
 *
 * This is the default read path. Gmail is already the durable, indexed,
 * searchable store for a mailbox, so a message is fetched when it is asked
 * for and is not written down — see `gmailStorage` for the reasoning and for
 * what that costs.
 *
 * **The hard part is the unified inbox.** Gmail has no endpoint for "newest
 * across these four mailboxes", and `messages.list` returns ids only — in
 * reverse chronological order per mailbox, with no dates. So merging by date
 * across mailboxes means knowing each candidate's date, which means fetching
 * it. Done naively that is "fetch every page of every mailbox and sort",
 * which spends N times the quota to show one page.
 *
 * Instead this does a **k-way merge with one message of lookahead per
 * mailbox**: hold the head of each mailbox's id stream, compare their dates,
 * take the newest, and pull that mailbox's next head. For a page of 25 across
 * 3 mailboxes that is 27 fetches rather than 75, and for the common case of
 * one mailbox it is exactly 25 with no merge at all.
 *
 * **Pagination is a composite cursor.** Each mailbox has its own opaque
 * Gmail page token plus how far into that page this reader has consumed. Both
 * travel in one base64url token, so the client keeps passing back one string
 * and never sees the shape. Page *numbers* cannot work here: Gmail does not
 * offer an offset, and faking one would mean re-walking every earlier page on
 * every request.
 */

/** Ids asked for per mailbox per page. */
const PAGE_SIZE = 50;

/** Message fetches in flight at once. */
const CONCURRENCY = 5;

/** Bodies above this are not carried in a list row. */
const MAX_PREVIEW_BODY_BYTES = 64 * 1024;

const encodeCursor = (state) =>
  Buffer.from(JSON.stringify(state), "utf8").toString("base64url");

const decodeCursor = (cursor) => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(String(cursor), "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return null;
    return parsed;
  } catch {
    // A cursor we cannot read is treated as no cursor: the alternative is
    // refusing to show a mailbox because a stale token was passed back.
    return null;
  }
};

/**
 * Turns Gmail's message resource into the shape the API returns.
 *
 * The same field names the cached path produced, so a client cannot tell
 * which path answered — apart from the pagination token, which it has to
 * pass back.
 */
const toRow = (raw, accountId, { withBody = false } = {}) => {
  const headers = raw.payload?.headers || [];
  const parts = mime.walkParts(raw.payload);
  const header = (name) => mime.headerValue(headers, name);
  const labelIds = raw.labelIds || [];
  const labels = new Set(labelIds);

  const bodyBytes =
    Buffer.byteLength(parts.text || "", "utf8") +
    Buffer.byteLength(parts.html || "", "utf8");
  const keepBody = withBody || bodyBytes <= MAX_PREVIEW_BODY_BYTES;

  return {
    accountId: String(accountId),
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
    // Gmail's own receipt time, and the only trustworthy one: the `Date`
    // header is written by the sender and is routinely wrong.
    internalDate: raw.internalDate
      ? new Date(Number(raw.internalDate)).toISOString()
      : null,
    sizeEstimate: Number(raw.sizeEstimate) || 0,
    attachments: parts.attachments,
    hasAttachments: parts.attachments.some(
      (attachment) => !attachment.inline || Boolean(attachment.filename),
    ),
    isUnread: labels.has("UNREAD"),
    isStarred: labels.has("STARRED"),
    isImportant: labels.has("IMPORTANT"),
    isDraft: labels.has("DRAFT"),
    isSent: labels.has("SENT"),
    isInInbox: labels.has("INBOX"),
    isTrashed: labels.has("TRASH"),
    isSpam: labels.has("SPAM"),
    origin: labels.has("SENT") ? "sent" : "inbound",
    ...(keepBody
      ? {
          bodyText: parts.text,
          bodyHtml: withBody ? parts.html : null,
          bodyFetchedAt: new Date().toISOString(),
          bodyTruncated: false,
        }
      : { bodyText: null, bodyHtml: null, bodyTruncated: true }),
  };
};

const gmailDate = (value, dayOffset = 0) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + dayOffset);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}/${month}/${day}`;
};

/** Builds the `q` Gmail should answer, from our own filter shape. */
const queryFor = (filter = {}) => {
  // A caller-supplied Gmail query wins outright: it is a language Gmail
  // implements, and silently bolting our own terms onto it would change what
  // the user typed.
  if (filter.q) return String(filter.q);

  const terms = [];

  if (filter.from) terms.push(`from:${filter.from}`);
  if (filter.to) terms.push(`to:${filter.to}`);
  if (filter.subject) terms.push(`subject:(${filter.subject})`);
  if (filter.isUnread === true) terms.push("is:unread");
  if (filter.isStarred === true) terms.push("is:starred");
  if (filter.hasAttachments === true) terms.push("has:attachment");
  // Gmail's date terms are day-granular and exclusive at the edges, so the
  // range is widened by a day and the exact bounds are applied below. Being
  // slightly generous here and exact afterwards is the only way to get both.
  if (filter.after) terms.push(`after:${gmailDate(filter.after, -1)}`);
  if (filter.before) terms.push(`before:${gmailDate(filter.before, 1)}`);
  // A plain keyword search goes to Gmail as a bare term, which searches the
  // whole message — more than our own substring match did, not less.
  if (filter.search) terms.push(`(${filter.search})`);

  return terms.join(" ");
};

/**
 * Applies the bounds Gmail's day-granular query cannot express.
 *
 * Only the date edges: everything else was expressed as a Gmail term and is
 * already exact. Filtering more here would mean returning fewer rows than the
 * page asked for and reporting a page size that is not what was delivered.
 */
const withinBounds = (row, filter) => {
  if (!row.internalDate) return true;
  const at = new Date(row.internalDate).getTime();
  if (filter.after && at < new Date(filter.after).getTime()) return false;
  if (filter.before && at > new Date(filter.before).getTime()) return false;
  return true;
};

/** Which labels a list should be restricted to. */
const labelsFor = (filter = {}) => {
  // One label or several, both accepted: a query string gives a bare string
  // for a single value and an array for a repeated one.
  const given = filter.labelIds;
  if (!given) return [];
  const labels = Array.isArray(given) ? given : [given];
  return labels.filter(Boolean);
};

/** Fetches message resources a few at a time. */
const fetchAll = async (client, ids, options) => {
  const chunks = [];
  for (let index = 0; index < ids.length; index += CONCURRENCY) {
    chunks.push(ids.slice(index, index + CONCURRENCY));
  }

  const fetched = [];
  await chunks.reduce(
    (previous, chunk) =>
      previous.then(async () => {
        const batch = await Promise.all(
          chunk.map((id) =>
            client.messages.get(id, options).catch((error) => {
              // Mail gets deleted while you are reading it. One missing
              // message must not fail the page.
              if (error.httpStatus === 404) return null;
              throw error;
            }),
          ),
        );
        batch.filter(Boolean).forEach((raw) => fetched.push(raw));
      }),
    Promise.resolve(),
  );

  return fetched;
};

/**
 * One mailbox's id stream, with a position.
 *
 * Holds the current page of ids and how far into it the reader has gone, so
 * the cursor can describe exactly where to resume.
 */
class MailboxStream {
  constructor({ account, client, query, labelIds, includeSpamTrash, state }) {
    this.account = account;
    this.client = client;
    this.query = query;
    this.labelIds = labelIds;
    this.includeSpamTrash = includeSpamTrash;
    this.pageToken = state?.t || undefined;
    this.offset = Number(state?.o) || 0;
    this.ids = null;
    this.exhausted = state?.done === true;
    this.head = null;
  }

  get id() {
    return String(this.account._id);
  }

  /** Loads the current page of ids, if it is not loaded. */
  async _page() {
    if (this.ids !== null) return;
    const page = await this.client.messages.list({
      ...(this.query ? { q: this.query } : {}),
      ...(this.labelIds.length > 0 ? { labelIds: this.labelIds } : {}),
      maxResults: PAGE_SIZE,
      pageToken: this.pageToken,
      includeSpamTrash: this.includeSpamTrash,
    });
    this.ids = (page.messages || []).map((message) => message.id);
    this.nextPageToken = page.nextPageToken || null;
    this.resultSizeEstimate = page.resultSizeEstimate || 0;
  }

  /**
   * Walks forward to the page that holds the current offset.
   *
   * Recursive rather than a loop so each step's page token is a parameter
   * instead of mutable state mid-await. Depth is one per exhausted Gmail
   * page, which is bounded by the mailbox.
   */
  async _advance() {
    await this._page();
    if (this.offset < this.ids.length) return true;
    if (!this.nextPageToken) {
      this.exhausted = true;
      return false;
    }
    this.pageToken = this.nextPageToken;
    this.offset = 0;
    this.ids = null;
    return this._advance();
  }

  /** The newest message this mailbox has not yet handed over, or null. */
  async peek() {
    if (this.head || this.exhausted) return this.head;

    if (!(await this._advance())) return null;

    const id = this.ids[this.offset];
    const raw = await this.client.messages
      .get(id, { format: "full" })
      .catch((error) => {
        if (error.httpStatus === 404) return null;
        throw error;
      });

    if (!raw) {
      // Deleted between listing and fetching; skip it and look again.
      this.offset += 1;
      return this.peek();
    }

    this.head = toRow(raw, this.id);
    return this.head;
  }

  /** Consumes the head, so the next peek moves on. */
  take() {
    const taken = this.head;
    this.head = null;
    this.offset += 1;
    return taken;
  }

  /** Where to resume, for the cursor. */
  get state() {
    return {
      t: this.pageToken || null,
      o: this.offset,
      done: this.exhausted,
    };
  }
}

/** The single-mailbox path: list the ids, fetch them, return them in order. */
const singleMailboxPage = async (stream, filter, limit) => {
  const page = await stream.client.messages.list({
    ...(stream.query ? { q: stream.query } : {}),
    ...(stream.labelIds.length > 0 ? { labelIds: stream.labelIds } : {}),
    maxResults: limit,
    pageToken: stream.pageToken,
    includeSpamTrash: stream.includeSpamTrash,
  });

  const ids = (page.messages || []).map((message) => message.id);
  const raws = await fetchAll(stream.client, ids, { format: "full" });

  // Gmail's order is the answer — newest first for a label listing, and
  // relevance-ranked for a query. Re-sorting either would be wrong.
  const byId = new Map(raws.map((raw) => [raw.id, raw]));
  const messages = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((raw) => toRow(raw, stream.id))
    .filter((row) => withinBounds(row, filter));

  return {
    messages,
    nextCursor: page.nextPageToken
      ? encodeCursor({
          v: 1,
          s: { [stream.id]: { t: page.nextPageToken, o: 0, done: false } },
        })
      : null,
    estimate: page.resultSizeEstimate || messages.length,
  };
};

/**
 * One page of messages, newest first, across one or more mailboxes.
 *
 * Returns `{ messages, nextCursor, estimate }`. There is no total: Gmail
 * gives only a `resultSizeEstimate`, which is what it is called because it is
 * one, and reporting an estimate as a total would make a client draw page
 * numbers that do not exist.
 */
const listMessages = async (userId, { accounts, filter = {}, limit = 25, cursor }) => {
  if (accounts.length === 0) {
    return { messages: [], nextCursor: null, estimate: 0 };
  }

  const query = queryFor(filter);
  const labelIds = labelsFor(filter);
  const includeSpamTrash =
    filter.includeTrash === true ||
    filter.includeSpam === true ||
    labelIds.includes("TRASH") ||
    labelIds.includes("SPAM");

  const saved = decodeCursor(cursor);
  const streams = accounts.map(
    (account) =>
      new MailboxStream({
        account,
        client: accountService.clientFor(account),
        query,
        labelIds,
        includeSpamTrash,
        state: saved?.s?.[String(account._id)],
      }),
  );

  // One mailbox needs no merge: Gmail already returns it newest-first, so the
  // page is a list call plus one fetch per row. This is the common case and
  // it is worth not paying the merge's lookahead for.
  if (streams.length === 1) {
    return singleMailboxPage(streams[0], filter, limit);
  }

  // The merge itself, recursive so each step's awaits are not in a loop.
  // Depth is bounded by `limit`.
  const drain = async (collected) => {
    if (collected.length >= limit) return collected;

    // The lookahead: every mailbox's current head, so the newest can be
    // chosen. Resolved together, so N mailboxes cost one round trip rather
    // than N sequential ones.
    const heads = await Promise.all(streams.map((stream) => stream.peek()));

    let bestIndex = -1;
    let bestAt = -Infinity;
    heads.forEach((head, index) => {
      if (!head || !head.internalDate) return;
      const at = new Date(head.internalDate).getTime();
      if (at > bestAt) {
        bestAt = at;
        bestIndex = index;
      }
    });

    // Every mailbox is spent.
    if (bestIndex === -1) return collected;

    const row = streams[bestIndex].take();
    return drain(withinBounds(row, filter) ? [...collected, row] : collected);
  };

  const messages = await drain([]);

  const exhausted = streams.every((stream) => stream.exhausted && !stream.head);

  return {
    messages,
    // The cursor is the position of every mailbox at once. A mailbox whose
    // head was fetched but not returned records the offset it is still on, so
    // nothing is skipped — at the cost of fetching that one message again on
    // the next page, which is the price of not storing it.
    nextCursor: exhausted
      ? null
      : encodeCursor({
          v: 1,
          // Built with reduce rather than Object.fromEntries: the project's
          // configured Node baseline predates it.
          s: streams.reduce((state, stream) => {
            const next = state;
            next[stream.id] = stream.state;
            return next;
          }, {}),
        }),
    estimate: streams.reduce(
      (total, stream) => total + (stream.resultSizeEstimate || 0),
      0,
    ),
  };
};

/** One message, in full, with its body. */
const getMessage = async (account, gmailId) => {
  const client = accountService.clientFor(account);

  let raw;
  try {
    raw = await client.messages.get(gmailId, { format: "full" });
  } catch (error) {
    if (error.httpStatus === 404) {
      throw new ApiError("This message no longer exists in Gmail", 404);
    }
    throw error;
  }

  return toRow(raw, String(account._id), { withBody: true });
};

/** A whole conversation, oldest first. */
const getThread = async (account, threadId) => {
  const client = accountService.clientFor(account);

  let raw;
  try {
    raw = await client.threads.get(threadId, { format: "full" });
  } catch (error) {
    if (error.httpStatus === 404) {
      throw new ApiError("This conversation no longer exists in Gmail", 404);
    }
    throw error;
  }

  const messages = (raw.messages || [])
    .map((message) => toRow(message, String(account._id), { withBody: true }))
    .sort(
      (a, b) =>
        new Date(a.internalDate || 0) - new Date(b.internalDate || 0),
    );

  return { messages, historyId: raw.historyId ? String(raw.historyId) : null };
};

/** Builds the conversation summary a list row needs. */
const summarizeThread = (raw, accountId) => {
  const rows = (raw.messages || []).map((message) =>
    toRow(message, accountId),
  );
  if (rows.length === 0) {
    return {
      accountId,
      gmailId: raw.id,
      subject: "",
      snippet: raw.snippet || "",
      participants: [],
      labelIds: [],
      messageCount: 0,
      unreadCount: 0,
      lastMessageAt: null,
    };
  }

  const ordered = [...rows].sort(
    (a, b) => new Date(a.internalDate || 0) - new Date(b.internalDate || 0),
  );
  const oldest = ordered[0];
  const newest = ordered[ordered.length - 1];

  const seen = new Map();
  ordered.forEach((row) => {
    [row.from, ...(row.to || []), ...(row.cc || [])]
      .filter((address) => address && address.email)
      .forEach((address) => {
        if (!seen.has(address.email)) seen.set(address.email, address);
      });
  });

  const labels = new Set();
  ordered.forEach((row) =>
    (row.labelIds || []).forEach((label) => labels.add(label)),
  );

  return {
    accountId,
    gmailId: raw.id,
    historyId: raw.historyId ? String(raw.historyId) : null,
    subject: oldest.subject || "",
    snippet: newest.snippet || raw.snippet || "",
    participants: Array.from(seen.values()),
    labelIds: Array.from(labels),
    messageCount: ordered.length,
    unreadCount: ordered.filter((row) => row.isUnread).length,
    hasAttachments: ordered.some((row) => row.hasAttachments),
    isStarred: ordered.some((row) => row.isStarred),
    isInInbox: ordered.some((row) => row.isInInbox),
    // A thread counts as trashed only when nothing is left outside the
    // trash, which is how Gmail treats it.
    isTrashed: ordered.every((row) => row.isTrashed),
    firstMessageAt: oldest.internalDate,
    lastMessageAt: newest.internalDate,
    lastMessageGmailId: newest.gmailId,
  };
};

/**
 * The same summary, from rows that have already been mapped.
 *
 * Saves re-walking the MIME of a thread we have just fetched in full, which
 * is the whole cost of opening a conversation.
 */
const summarizeThreadFromRows = (threadId, historyId, rows, accountId) => {
  if (rows.length === 0) {
    return {
      accountId,
      gmailId: threadId,
      historyId,
      subject: "",
      snippet: "",
      participants: [],
      labelIds: [],
      messageCount: 0,
      unreadCount: 0,
      lastMessageAt: null,
    };
  }

  const ordered = [...rows].sort(
    (a, b) => new Date(a.internalDate || 0) - new Date(b.internalDate || 0),
  );
  const oldest = ordered[0];
  const newest = ordered[ordered.length - 1];

  const seen = new Map();
  ordered.forEach((row) => {
    [row.from, ...(row.to || []), ...(row.cc || [])]
      .filter((address) => address && address.email)
      .forEach((address) => {
        if (!seen.has(address.email)) seen.set(address.email, address);
      });
  });

  const labels = new Set();
  ordered.forEach((row) =>
    (row.labelIds || []).forEach((label) => labels.add(label)),
  );

  return {
    accountId,
    gmailId: threadId,
    historyId,
    subject: oldest.subject || "",
    snippet: newest.snippet || "",
    participants: Array.from(seen.values()),
    labelIds: Array.from(labels),
    messageCount: ordered.length,
    unreadCount: ordered.filter((row) => row.isUnread).length,
    hasAttachments: ordered.some((row) => row.hasAttachments),
    isStarred: ordered.some((row) => row.isStarred),
    isInInbox: ordered.some((row) => row.isInInbox),
    isTrashed: ordered.every((row) => row.isTrashed),
    firstMessageAt: oldest.internalDate,
    lastMessageAt: newest.internalDate,
    lastMessageGmailId: newest.gmailId,
  };
};

/**
 * Conversations for a list, built from Gmail's thread listing.
 *
 * Gmail's `threads.list` gives ids and a snippet but no participants or
 * counts, and fetching every thread in full to compute them would be a page
 * of conversations costing a page of conversations' worth of messages. So
 * each thread is fetched with metadata only and summarized — which is one
 * call per thread, and the reason the message list is the cheaper view.
 */
const listThreads = async ({ accounts, filter = {}, limit = 25, cursor }) => {
  if (accounts.length !== 1) {
    throw new ApiError(
      "Conversations are listed one mailbox at a time. Pick a mailbox, or "
        + "use the message list for a unified view.",
      400,
    );
  }

  const account = accounts[0];
  const client = accountService.clientFor(account);
  const saved = decodeCursor(cursor);
  const labelIds = labelsFor(filter);

  const page = await client.threads.list({
    ...(queryFor(filter) ? { q: queryFor(filter) } : {}),
    ...(labelIds.length > 0 ? { labelIds } : {}),
    maxResults: limit,
    pageToken: saved?.s?.[String(account._id)]?.t || undefined,
    includeSpamTrash: filter.includeTrash === true,
  });

  const threads = await (page.threads || []).reduce(
    (previous, summary) =>
      previous.then(async (all) => {
        const full = await client.threads
          .get(summary.id, { format: "metadata" })
          .catch((error) => {
            if (error.httpStatus === 404) return null;
            throw error;
          });
        if (!full) return all;
        return [...all, summarizeThread(full, String(account._id))];
      }),
    Promise.resolve([]),
  );

  return {
    threads,
    nextCursor: page.nextPageToken
      ? encodeCursor({
          v: 1,
          s: { [String(account._id)]: { t: page.nextPageToken, o: 0 } },
        })
      : null,
    estimate: page.resultSizeEstimate || threads.length,
  };
};

module.exports = {
  PAGE_SIZE,
  MAX_PREVIEW_BODY_BYTES,
  encodeCursor,
  decodeCursor,
  toRow,
  queryFor,
  gmailDate,
  withinBounds,
  labelsFor,
  MailboxStream,
  listMessages,
  listThreads,
  getMessage,
  getThread,
  summarizeThread,
  summarizeThreadFromRows,
};
