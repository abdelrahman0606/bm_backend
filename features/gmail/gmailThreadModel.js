const mongoose = require("mongoose");
const { mailModel } = require("./gmailStorage");
const { addressSchema } = require("./gmailMessageModel");

/**
 * A conversation, summarized.
 *
 * Everything here could be computed from `GmailMessage` with an aggregation,
 * and for one thread that would be fine. The inbox is the problem: listing
 * 50 conversations newest-first, each with a participant list and an unread
 * count, is a group-and-sort over the whole mailbox on every page load. So
 * the summary is maintained as messages arrive and the list becomes an
 * indexed read.
 *
 * It is a cache with a single writer (`recalculateFrom`), and it is rebuilt
 * from the messages rather than patched, so it cannot drift away from them.
 */
const gmailThreadSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GmailAccount",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Gmail's thread id. */
    gmailId: { type: String, required: true },
    historyId: { type: String, default: null },

    /** The subject of the first message, which is what Gmail shows. */
    subject: { type: String, default: "" },
    /** The snippet of the *latest* message, which is what a list shows. */
    snippet: { type: String, default: "" },

    /** Everyone who has written in or been written to, deduplicated. */
    participants: { type: [addressSchema], default: [] },
    /** The union of every message's labels: how a thread is filtered. */
    labelIds: { type: [String], default: [] },

    messageCount: { type: Number, default: 0 },
    unreadCount: { type: Number, default: 0 },
    hasAttachments: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },
    isInInbox: { type: Boolean, default: false },
    isTrashed: { type: Boolean, default: false },

    firstMessageAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: null, required: true },
    /** Id of the newest message, so opening a thread needs no sort. */
    lastMessageGmailId: { type: String, default: null },
  },
  { timestamps: true },
);

gmailThreadSchema.index({ accountId: 1, gmailId: 1 }, { unique: true });

// The conversation list for one mailbox, and for every mailbox at once.
gmailThreadSchema.index({ accountId: 1, lastMessageAt: -1 });
gmailThreadSchema.index({ userId: 1, lastMessageAt: -1 });
gmailThreadSchema.index({ accountId: 1, labelIds: 1, lastMessageAt: -1 });
gmailThreadSchema.index({ accountId: 1, unreadCount: 1, lastMessageAt: -1 });

/**
 * Rebuilds a thread's summary from the messages it actually contains.
 *
 * Takes the messages rather than reading them, so the caller can hand over
 * the batch it has just written and the recalculation costs no query. Returns
 * the fields to `$set`, not a document: the write is an upsert, because the
 * thread may be being created by the same message that is updating it.
 */
gmailThreadSchema.statics.summaryFrom = (messages = []) => {
  if (messages.length === 0) return null;

  const ordered = [...messages].sort(
    (a, b) => new Date(a.internalDate) - new Date(b.internalDate),
  );
  const newest = ordered[ordered.length - 1];
  const oldest = ordered[0];

  const seen = new Map();
  ordered.forEach((message) => {
    [message.from, ...(message.to || []), ...(message.cc || [])]
      .filter((address) => address && address.email)
      .forEach((address) => {
        if (!seen.has(address.email)) {
          seen.set(address.email, {
            name: address.name || null,
            email: address.email,
          });
        }
      });
  });

  const labels = new Set();
  ordered.forEach((message) =>
    (message.labelIds || []).forEach((label) => labels.add(label)),
  );

  return {
    subject: oldest.subject || "",
    snippet: newest.snippet || "",
    participants: Array.from(seen.values()),
    labelIds: Array.from(labels),
    messageCount: ordered.length,
    unreadCount: ordered.filter((message) => message.isUnread).length,
    hasAttachments: ordered.some((message) => message.hasAttachments),
    isStarred: ordered.some((message) => message.isStarred),
    isInInbox: ordered.some((message) => message.isInInbox),
    // A thread counts as trashed only when nothing is left outside the trash,
    // which is how Gmail treats it: one trashed reply does not bury the
    // conversation.
    isTrashed: ordered.every((message) => message.isTrashed),
    firstMessageAt: oldest.internalDate,
    lastMessageAt: newest.internalDate,
    lastMessageGmailId: newest.gmailId,
    historyId: newest.historyId || null,
  };
};

/// Bound to local MongoDB, never Atlas: this is mail content, and
/// `mongoose.model(...)` would put it on the default (Atlas)
/// connection. See `gmailStorage` for why. Only written at all when
/// `GMAIL_STORE_MESSAGES=true`; the default reads straight from Gmail.
const GmailThread = mailModel("GmailThread", gmailThreadSchema);

module.exports = { GmailThread, gmailThreadSchema };
