const mongoose = require("mongoose");
const { mailModel } = require("./gmailStorage");

/**
 * One Gmail message, as much of it as is worth keeping here.
 *
 * The rule this collection follows: **store what has to be queried, fetch
 * what only has to be displayed.** Headers, labels, dates and attachment
 * descriptors are indexed and filtered on constantly, so they live here.
 * Message bodies are large, are read once, and Gmail serves them quickly by
 * id — so a body is cached only after someone opens the message
 * (`bodyFetchedAt`), and attachment *bytes* are never stored at all; the
 * descriptor is enough to stream one on demand.
 *
 * That keeps the collection proportional to mailbox size rather than to
 * mailbox bytes, and means a mailbox of 200k messages is a few hundred MB of
 * metadata rather than tens of gigabytes of duplicated mail.
 *
 * Every row is scoped to both `accountId` and `userId`. `accountId` is what
 * makes it unique; `userId` is denormalized so a unified inbox across a
 * user's mailboxes is one indexed query, and so no query can reach another
 * user's mail even if an account id leaks.
 */

/** One address, parsed out of a header, kept as both parts. */
const addressSchema = new mongoose.Schema(
  {
    name: { type: String, default: null },
    email: { type: String, default: null, lowercase: true, trim: true },
  },
  { _id: false },
);

/**
 * An attachment as Gmail describes it. `attachmentId` is the handle that
 * `users.messages.attachments.get` takes; it is stable for the message, so a
 * download needs no extra round trip to find it.
 */
const attachmentSchema = new mongoose.Schema(
  {
    attachmentId: { type: String, default: null },
    partId: { type: String, default: null },
    filename: { type: String, default: "" },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    /** An image referenced by the HTML body rather than listed as a file. */
    inline: { type: Boolean, default: false },
    contentId: { type: String, default: null },
  },
  { _id: false },
);

const gmailMessageSchema = new mongoose.Schema(
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
    /** Gmail's id for the message within this mailbox. */
    gmailId: { type: String, required: true },
    threadId: { type: String, required: true },
    /** The history id this version of the message was observed at. */
    historyId: { type: String, default: null },

    // ── Envelope ───────────────────────────────────────────────────────────
    subject: { type: String, default: "" },
    from: { type: addressSchema, default: () => ({}) },
    replyTo: { type: [addressSchema], default: [] },
    to: { type: [addressSchema], default: [] },
    cc: { type: [addressSchema], default: [] },
    /**
     * Only ever populated for mail *we* sent, and only from our own send
     * call. Gmail does not reveal another sender's Bcc, and inferring one
     * would be a fabrication.
     */
    bcc: { type: [addressSchema], default: [] },
    /** RFC 5322 Message-ID, and the threading chain, kept verbatim. */
    rfcMessageId: { type: String, default: null },
    inReplyTo: { type: String, default: null },
    references: { type: [String], default: [] },

    // ── Gmail's own view ───────────────────────────────────────────────────
    labelIds: { type: [String], default: [] },
    snippet: { type: String, default: "" },
    internalDate: { type: Date, default: null, required: true },
    sizeEstimate: { type: Number, default: 0 },

    /**
     * Denormalized from `labelIds`, purely so these can be indexed and
     * sorted. Kept in step by `applyLabelFlags`, which is the only thing
     * allowed to write them — a flag and its label disagreeing is the one
     * inconsistency this collection could develop.
     */
    isUnread: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },
    isImportant: { type: Boolean, default: false },
    isDraft: { type: Boolean, default: false },
    isSent: { type: Boolean, default: false },
    isInInbox: { type: Boolean, default: false },
    isTrashed: { type: Boolean, default: false },
    isSpam: { type: Boolean, default: false },
    hasAttachments: { type: Boolean, default: false },

    // ── Body cache, filled on first open ───────────────────────────────────
    bodyText: { type: String, default: null },
    bodyHtml: { type: String, default: null },
    bodyFetchedAt: { type: Date, default: null },
    /** True when the stored body was cut to stay within the cap. */
    bodyTruncated: { type: Boolean, default: false },

    attachments: { type: [attachmentSchema], default: [] },

    /**
     * Who put this message in the mailbox, as far as this backend knows:
     * `inbound` arrived, `sent` went out through us, `imported` was found by
     * a sync and had already been sent by something else. It is what lets the
     * send history distinguish our own sends from the rest of the Sent label.
     */
    origin: {
      type: String,
      enum: ["inbound", "sent", "imported"],
      default: "imported",
    },

    /** Set when this message was sent by one of our own send operations. */
    operationLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GmailOperationLog",
      default: null,
    },

    /** Reserved for a later classifier; nothing writes it today. */
    analysis: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// Identity. Also the upsert key, which is what makes a replayed history
// record or a re-delivered push notification cost nothing: the same message
// observed twice is one row, written twice.
gmailMessageSchema.index({ accountId: 1, gmailId: 1 }, { unique: true });

// The default list: one mailbox, newest first.
gmailMessageSchema.index({ accountId: 1, internalDate: -1 });

// Filtered by label — which is how "inbox", "sent", "spam", "trash" and every
// user label are all asked for, since Gmail has no folders, only labels.
gmailMessageSchema.index({ accountId: 1, labelIds: 1, internalDate: -1 });

// A conversation, oldest first, which is how a thread is read.
gmailMessageSchema.index({ accountId: 1, threadId: 1, internalDate: 1 });

// The unread badge and the unread filter.
gmailMessageSchema.index({ accountId: 1, isUnread: 1, internalDate: -1 });

// The unified inbox across every mailbox this user has connected.
gmailMessageSchema.index({ userId: 1, internalDate: -1 });

// "Mail from this person", for the contact view and recipient suggestions.
gmailMessageSchema.index({ accountId: 1, "from.email": 1, internalDate: -1 });

// Local keyword search over what is cheap to index. Full Gmail search
// operators go to Gmail itself (`users.messages.list?q=`), which is the only
// thing that implements them correctly; this covers the common case without a
// round trip, and bodies are left out on purpose so the index stays small.
gmailMessageSchema.index(
  { subject: "text", snippet: "text" },
  { weights: { subject: 10, snippet: 2 }, name: "gmail_message_text" },
);

/**
 * Keeps the boolean flags in step with `labelIds`.
 *
 * The single writer for all of them, called from the sync and from every
 * organize operation, so there is one place where a label and its flag can
 * be made to agree.
 */
gmailMessageSchema.statics.applyLabelFlags = (doc) => {
  const labels = new Set(doc.labelIds || []);
  doc.isUnread = labels.has("UNREAD");
  doc.isStarred = labels.has("STARRED");
  doc.isImportant = labels.has("IMPORTANT");
  doc.isDraft = labels.has("DRAFT");
  doc.isSent = labels.has("SENT");
  doc.isInInbox = labels.has("INBOX");
  doc.isTrashed = labels.has("TRASH");
  doc.isSpam = labels.has("SPAM");
  return doc;
};

/// Bound to local MongoDB, never Atlas: this is mail content, and
/// `mongoose.model(...)` would put it on the default (Atlas)
/// connection. See `gmailStorage` for why. Only written at all when
/// `GMAIL_STORE_MESSAGES=true`; the default reads straight from Gmail.
const GmailMessage = mailModel("GmailMessage", gmailMessageSchema);

module.exports = {
  GmailMessage,
  addressSchema,
  attachmentSchema,
  gmailMessageSchema,
};
