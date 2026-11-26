const mongoose = require("mongoose");
const ApiError = require("../../utils/apiError");
const { GmailMessage } = require("./gmailMessageModel");
const { GmailThread } = require("./gmailThreadModel");
const { GmailLabel } = require("./gmailLabelModel");
const accountService = require("./gmailAccountService");
const syncService = require("./gmailSyncService");
const directReader = require("./gmailDirectReader");
const storage = require("./gmailStorage");
const mime = require("./gmailMime");

/**
 * Reading mail.
 *
 * **Gmail is the store.** By default nothing is kept here: a list, a message
 * and a conversation are read straight from Gmail through
 * `gmailDirectReader`, and a new message reaches a client in the event that
 * announces it rather than being written down and read back. Gmail is
 * already the durable, indexed, searchable store for that mailbox, and a
 * second copy means a second thing to keep in step and a second place
 * somebody's private mail exists.
 *
 * `GMAIL_STORE_MESSAGES=true` turns on a local cache instead, which buys
 * cross-mailbox search and cheaper repeat reads at the cost of holding the
 * mail. `gmailStorage` has the full reasoning and the trade-offs both ways.
 * Both paths return the same shapes, so a client cannot tell which answered
 * — except for pagination, where the direct path is cursor-based because
 * Gmail offers no offset.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Normalizes a repeatable query parameter.
 *
 * `?labelIds=INBOX&labelIds=UNREAD` arrives as an array, `?labelIds=INBOX,UNREAD`
 * as one string. Both are accepted, because the second is what a
 * hand-written URL looks like and reading it as a single label id would
 * return an empty list — which reads as "no mail" rather than as a mistake.
 */
const toArray = (value) => {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : [entry]))
    .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
    .filter((entry) => entry !== "" && entry !== null && entry !== undefined);
};

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * The mailboxes a request may read, verified.
 *
 * Naming none means every enabled mailbox — the unified inbox. Naming some
 * verifies each belongs to the caller: an id in a query string is never
 * taken on trust.
 */
const accountsFor = async (userId, accountId) => {
  const ids = toArray(accountId);

  if (ids.length === 0) {
    const { accounts } = await accountService.listAccounts(userId, {
      limit: 100,
      status: "connected",
    });
    return accounts.filter((account) => account.isEnabled);
  }

  return Promise.all(
    ids.map((id) => accountService.requireUsableAccount(userId, id, "read")),
  );
};

// ─────────────────────────── the cached path ───────────────────────────────
// Only reachable with GMAIL_STORE_MESSAGES=true.

const scopeFor = (userId, accounts) => ({
  userId,
  ...(accounts.length > 0
    ? { accountId: { $in: accounts.map((account) => account._id) } }
    : {}),
});

const buildQuery = (scope, options = {}) => {
  const query = { ...scope };

  const labels = toArray(options.labelIds);
  if (labels.length > 0) query.labelIds = { $all: labels };
  if (options.threadId) query.threadId = options.threadId;

  if (options.from) {
    query["from.email"] = new RegExp(escapeRegex(options.from), "i");
  }
  if (options.to) query["to.email"] = new RegExp(escapeRegex(options.to), "i");
  if (options.subject) {
    query.subject = new RegExp(escapeRegex(options.subject), "i");
  }

  if (options.isUnread !== undefined) query.isUnread = options.isUnread;
  if (options.isStarred !== undefined) query.isStarred = options.isStarred;
  if (options.hasAttachments !== undefined) {
    query.hasAttachments = options.hasAttachments;
  }

  const after = parseDate(options.after);
  const before = parseDate(options.before);
  if (after || before) {
    query.internalDate = {
      ...(after ? { $gte: after } : {}),
      ...(before ? { $lte: before } : {}),
    };
  }

  if (!options.includeTrash && !labels.includes("TRASH")) {
    query.isTrashed = false;
  }
  if (!options.includeSpam && !labels.includes("SPAM")) {
    query.isSpam = false;
  }

  const keyword = String(options.search || "").trim();
  if (keyword) {
    const pattern = new RegExp(escapeRegex(keyword), "i");
    query.$or = [
      { subject: pattern },
      { snippet: pattern },
      { "from.email": pattern },
      { "from.name": pattern },
    ];
  }

  return query;
};

const SELECT_LIST =
  "gmailId threadId subject from to cc snippet internalDate labelIds " +
  "isUnread isStarred isImportant isInInbox isTrashed isSpam isDraft " +
  "isSent hasAttachments attachments sizeEstimate accountId origin";

const listFromCache = async (userId, accounts, options, page, limit) => {
  const query = buildQuery(scopeFor(userId, accounts), options);
  const descending = String(options.descending ?? "true") !== "false";

  const [messages, total] = await Promise.all([
    GmailMessage.find(query)
      .select(SELECT_LIST)
      .sort({ internalDate: descending ? -1 : 1 })
      .skip(page * limit)
      .limit(limit)
      .lean(),
    GmailMessage.countDocuments(query),
  ]);

  return {
    messages,
    total,
    page,
    limit,
    hasMore: (page + 1) * limit < total,
    source: "cache",
  };
};

// ───────────────────────────── the read API ────────────────────────────────

/**
 * One page of messages, newest first.
 *
 * The direct path paginates by `nextPageToken`, not by page number: Gmail has
 * no offset, and faking one would mean re-walking every earlier page on every
 * request. `total` is absent there for a related reason — Gmail gives a
 * `resultSizeEstimate`, and presenting an estimate as a total would have a
 * client drawing page numbers that do not exist.
 */
exports.listMessages = async (userId, options = {}) => {
  const page = Math.max(0, Number(options.page) || 0);
  const limit = Math.min(
    Math.max(1, Number(options.limit) || DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );

  const accounts = await accountsFor(userId, options.accountId);
  if (accounts.length === 0) {
    return {
      messages: [],
      total: 0,
      page,
      limit,
      hasMore: false,
      source: storage.keepsMessages() ? "cache" : "gmail",
    };
  }

  if (storage.keepsMessages()) {
    return listFromCache(userId, accounts, options, page, limit);
  }

  const result = await directReader.listMessages(userId, {
    accounts,
    filter: {
      q: options.q,
      labelIds: toArray(options.labelIds),
      from: options.from,
      to: options.to,
      subject: options.subject,
      search: options.search,
      isUnread: options.isUnread,
      isStarred: options.isStarred,
      hasAttachments: options.hasAttachments,
      after: parseDate(options.after),
      before: parseDate(options.before),
      includeTrash: options.includeTrash,
      includeSpam: options.includeSpam,
    },
    limit,
    cursor: options.pageToken || options.cursor,
  });

  return {
    messages: result.messages,
    // Gmail's own number, named for what it is.
    estimate: result.estimate,
    limit,
    hasMore: result.nextCursor !== null,
    nextPageToken: result.nextCursor,
    source: "gmail",
  };
};

/** One page of conversations. */
exports.listThreads = async (userId, options = {}) => {
  const page = Math.max(0, Number(options.page) || 0);
  const limit = Math.min(
    Math.max(1, Number(options.limit) || DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );

  const accounts = await accountsFor(userId, options.accountId);
  if (accounts.length === 0) {
    return { threads: [], total: 0, page, limit, hasMore: false };
  }

  if (storage.keepsMessages()) {
    const query = { ...scopeFor(userId, accounts) };
    const labels = toArray(options.labelIds);
    if (labels.length > 0) query.labelIds = { $all: labels };
    if (options.isUnread === true) query.unreadCount = { $gt: 0 };
    if (!options.includeTrash && !labels.includes("TRASH")) {
      query.isTrashed = false;
    }

    const [threads, total] = await Promise.all([
      GmailThread.find(query)
        .sort({ lastMessageAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .lean(),
      GmailThread.countDocuments(query),
    ]);

    return {
      threads,
      total,
      page,
      limit,
      hasMore: (page + 1) * limit < total,
      source: "cache",
    };
  }

  const result = await directReader.listThreads({
    accounts,
    filter: {
      q: options.q,
      labelIds: toArray(options.labelIds),
      search: options.search,
      isUnread: options.isUnread,
      includeTrash: options.includeTrash,
    },
    limit,
    cursor: options.pageToken || options.cursor,
  });

  return {
    threads: result.threads,
    estimate: result.estimate,
    limit,
    hasMore: result.nextCursor !== null,
    nextPageToken: result.nextCursor,
    source: "gmail",
  };
};

/**
 * One message, with its body and its labels resolved to names.
 *
 * The label names cost one extra Gmail call. Worth it: a message's
 * `labelIds` are meaningless to display — Gmail has no folders, so "INBOX"
 * and "Label_7" are all a client would otherwise have to show.
 */
exports.getMessage = async (userId, accountId, gmailId, options = {}) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "read",
  );

  if (storage.keepsMessages()) {
    const stored = await GmailMessage.findOne({
      accountId: account._id,
      gmailId,
    });
    if (!stored) throw new ApiError("Message not found in this mailbox", 404);
    const complete =
      options.withBody === false
        ? stored
        : await exports.ensureBody(account, stored);
    return {
      message: complete,
      labels: await exports.resolveLabels(account, complete.labelIds),
      bodyAvailable: Boolean(complete.bodyText || complete.bodyHtml),
      bodyTooLarge: complete.bodyTruncated === true,
    };
  }

  const message = await directReader.getMessage(account, gmailId);

  return {
    message,
    labels: await exports.resolveLabels(account, message.labelIds),
    bodyAvailable: Boolean(message.bodyText || message.bodyHtml),
    bodyTooLarge: message.bodyTruncated === true,
  };
};

/** A whole conversation, oldest first. */
exports.getThread = async (userId, accountId, threadId) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "read",
  );

  if (storage.keepsMessages()) {
    const thread = await GmailThread.findOne({
      accountId: account._id,
      gmailId: threadId,
    });
    const messages = await GmailMessage.find({
      accountId: account._id,
      threadId,
    }).sort({ internalDate: 1 });

    if (messages.length === 0) {
      throw new ApiError("Thread not found in this mailbox", 404);
    }
    return {
      thread:
        thread ||
        GmailThread.summaryFrom(messages.map((message) => message.toObject())),
      messages,
      source: "cache",
    };
  }

  const result = await directReader.getThread(account, threadId);
  if (result.messages.length === 0) {
    throw new ApiError("Thread not found in this mailbox", 404);
  }

  return {
    // Summarized from the messages Gmail just returned, so the shape matches
    // the cached path without a second request.
    thread: directReader.summarizeThreadFromRows(
      threadId,
      result.historyId,
      result.messages,
      String(account._id),
    ),
    messages: result.messages,
    source: "gmail",
  };
};

/**
 * Fetches and stores a message's body. Cached mode only.
 *
 * A 404 means Gmail no longer has it, which makes the local row wrong too —
 * so it goes, rather than staying as a row that can never be opened.
 */
exports.ensureBody = async (account, message) => {
  if (message.bodyFetchedAt && (message.bodyText || message.bodyHtml)) {
    return message;
  }

  const client = accountService.clientFor(account);

  let raw;
  try {
    raw = await client.messages.get(message.gmailId, { format: "full" });
  } catch (error) {
    if (error.httpStatus === 404) {
      await GmailMessage.deleteOne({ _id: message._id });
      await syncService.refreshThread(account, message.threadId);
      throw new ApiError("This message no longer exists in Gmail", 404);
    }
    throw error;
  }

  const { message: stored } = await syncService.storeMessage(account, raw, {
    storeBody: true,
    origin: message.origin,
  });
  return stored;
};

/**
 * Turns label ids into `{labelId, name, type}` for display.
 *
 * Read from Gmail unless the cache is on. One call per message opened, which
 * is the cost of not keeping a label table — and Gmail's label list is one
 * quota unit, the cheapest call it offers.
 */
exports.resolveLabels = async (account, labelIds = []) => {
  if (labelIds.length === 0) return [];

  const all = storage.keepsMessages()
    ? await GmailLabel.find({
        accountId: account._id,
        labelId: { $in: labelIds },
      })
        .select("labelId name type color")
        .lean()
    : await exports.labelsOf(account);

  const known = new Map(all.map((label) => [label.labelId, label]));
  // An id with no matching label is still reported, by id: dropping it would
  // make a message look as though it carried fewer labels than it does.
  return labelIds.map(
    (labelId) => known.get(labelId) || { labelId, name: labelId, type: "system" },
  );
};

/** Every label in a mailbox, for an account already verified. */
exports.labelsOf = async (account) => {
  if (storage.keepsMessages()) {
    return GmailLabel.find({ accountId: account._id })
      .sort({ type: 1, name: 1 })
      .lean();
  }

  const client = accountService.clientFor(account);
  const response = await client.labels.list();

  return (response.labels || [])
    .map((label) => ({
      labelId: label.id,
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
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "system" ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    });
};

/** Every label in a mailbox, by id, for a request. */
exports.listLabels = async (userId, accountId) =>
  exports.labelsOf(await accountService.requireAccount(userId, accountId));

/**
 * Downloads an attachment.
 *
 * The descriptor is read from the message rather than taken from the
 * request: that is what proves this attachment belongs to a message in a
 * mailbox this user owns, and it is where the filename and type come from.
 */
exports.getAttachment = async (userId, accountId, gmailId, attachmentId) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "read",
  );

  let attachments;
  if (storage.keepsMessages()) {
    const stored = await GmailMessage.findOne({
      accountId: account._id,
      gmailId,
    })
      .select("attachments")
      .lean();
    attachments = stored ? stored.attachments : null;
  } else {
    ({ attachments } = await directReader.getMessage(account, gmailId));
  }

  if (!attachments) throw new ApiError("Message not found in this mailbox", 404);

  const descriptor = attachments.find(
    (attachment) => attachment.attachmentId === attachmentId,
  );
  if (!descriptor) {
    throw new ApiError("This message has no such attachment", 404);
  }

  const client = accountService.clientFor(account);
  const response = await client.messages.attachment(gmailId, attachmentId);
  if (!response.data) {
    throw new ApiError("Gmail returned no attachment data", 502);
  }

  return {
    filename: descriptor.filename || "attachment",
    mimeType: descriptor.mimeType || "application/octet-stream",
    size: Number(response.size) || descriptor.size || 0,
    content: mime.decodeBase64Url(response.data),
  };
};

/**
 * Unread counts per mailbox, for the badges.
 *
 * Read from Gmail's own INBOX label, which carries the count — so the badge
 * is the number Gmail shows rather than a count of what we happen to hold.
 * One quota unit per mailbox.
 */
exports.unreadCounts = async (userId) => {
  if (storage.keepsMessages()) {
    const rows = await GmailMessage.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(String(userId)),
          isUnread: true,
          isInInbox: true,
          isTrashed: false,
          isSpam: false,
        },
      },
      { $group: { _id: "$accountId", unread: { $sum: 1 } } },
    ]);
    return rows.map((row) => ({
      accountId: String(row._id),
      unread: row.unread,
    }));
  }

  const accounts = await accountsFor(userId, null);

  return Promise.all(
    accounts.map(async (account) => {
      try {
        const label = await accountService
          .clientFor(account)
          .labels.get("INBOX");
        return {
          accountId: String(account._id),
          unread: Number(label.messagesUnread) || 0,
        };
      } catch {
        // A badge is not worth failing the request for.
        return { accountId: String(account._id), unread: 0 };
      }
    }),
  );
};

exports.DEFAULT_PAGE_SIZE = DEFAULT_PAGE_SIZE;
exports.MAX_PAGE_SIZE = MAX_PAGE_SIZE;
exports.buildQuery = buildQuery;
exports.toArray = toArray;
exports.accountsFor = accountsFor;
