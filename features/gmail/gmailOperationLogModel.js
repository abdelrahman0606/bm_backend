const mongoose = require("mongoose");
const { addressSchema } = require("./gmailMessageModel");

/**
 * The audit trail for everything this backend does *to* a mailbox.
 *
 * Three jobs, one collection, because they are the same question asked three
 * ways.
 *
 * **1. "Did it send?"** The honest answer to that is narrower than it looks.
 * Gmail accepting a message for delivery is the only thing we observe; it is
 * not delivery, and it is certainly not the recipient reading it. So `status`
 * tops out at `accepted` — Gmail took it and returned a message id — and
 * nothing in this collection ever claims more. A bounce arrives later as a
 * new inbound message from the mailer-daemon; it is not a status change here,
 * because the send genuinely did succeed.
 *
 * **2. "What went wrong?"** A failed send keeps the Google error code, the
 * attempt count and whether it is worth retrying, which is what turns "email
 * didn't work" into something actionable.
 *
 * **3. "Who did it?"** `actor.kind` separates a person's action from an
 * automated one. Nothing automated writes here yet. It is here now because
 * retrofitting provenance onto an audit log is how you end up with an audit
 * log you cannot trust: the rows written before the column existed are
 * indistinguishable from the rows written by a user.
 */

const OPERATIONS = [
  "message.send",
  "message.reply",
  "message.replyAll",
  "message.forward",
  "draft.create",
  "draft.update",
  "draft.send",
  "draft.delete",
  "message.modifyLabels",
  "message.markRead",
  "message.markUnread",
  "message.star",
  "message.unstar",
  "message.archive",
  "message.trash",
  "message.untrash",
  "message.deleteForever",
  "thread.modifyLabels",
  "thread.trash",
  "thread.deleteForever",
  "label.create",
  "label.update",
  "label.delete",
  "account.connected",
  "account.disconnected",
  "account.signedOut",
  "watch.started",
  "watch.stopped",
  "sync.completed",
  "sync.failed",
];

/**
 * `queued` was written but not attempted; `accepted` means Gmail took it;
 * `failed` means it did not, with a reason. There is no `delivered` and no
 * `read`, deliberately — see the note above.
 */
const STATUSES = ["queued", "accepted", "failed"];

/** Who asked for the operation. */
const ACTOR_KINDS = [
  // A signed-in person, through the API.
  "user",
  // The backend itself: a scheduled sync, a watch renewal.
  "system",
  // An automated agent acting for a user. Reserved; nothing writes it yet.
  "agent",
];

const gmailOperationLogSchema = new mongoose.Schema(
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
    operation: { type: String, enum: OPERATIONS, required: true },
    status: { type: String, enum: STATUSES, default: "queued" },

    actor: {
      kind: { type: String, enum: ACTOR_KINDS, default: "user" },
      /** The user, or null for a system action. */
      id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      /** Free text for a system or agent action: "gmail-scheduler". */
      label: { type: String, default: null },
    },

    /**
     * What was asked for, summarized. Recipients and subject are kept because
     * an audit trail that cannot say who was written to is not one. Bodies
     * are not: they are already in the mailbox, and a second copy in a log
     * that outlives the message is a liability rather than a record.
     */
    request: {
      to: { type: [addressSchema], default: [] },
      cc: { type: [addressSchema], default: [] },
      bcc: { type: [addressSchema], default: [] },
      subject: { type: String, default: null },
      attachmentCount: { type: Number, default: 0 },
      attachmentBytes: { type: Number, default: 0 },
      /** The message or thread an operation acted on. */
      targetGmailId: { type: String, default: null },
      targetThreadId: { type: String, default: null },
      addLabelIds: { type: [String], default: [] },
      removeLabelIds: { type: [String], default: [] },
    },

    /** What Gmail returned. */
    result: {
      gmailMessageId: { type: String, default: null },
      threadId: { type: String, default: null },
      draftId: { type: String, default: null },
      labelIds: { type: [String], default: [] },
      /** Affected count, for the operations that take a list. */
      affected: { type: Number, default: 0 },
    },

    error: {
      /** Google's own reason string: "rateLimitExceeded", "invalidArgument". */
      code: { type: String, default: null },
      httpStatus: { type: Number, default: null },
      message: { type: String, default: null },
      /** Whether another attempt could plausibly succeed. */
      retryable: { type: Boolean, default: false },
    },

    attempts: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },

    /**
     * Caller-supplied key that makes a send idempotent.
     *
     * The failure this prevents is specific and bad: a client sends, the
     * response is lost to a dropped connection, the client retries, and the
     * recipient gets the mail twice. With a key, the second attempt finds
     * this row and returns the first result instead of sending again. The
     * unique index is what enforces it, so two concurrent retries cannot both
     * get through.
     */
    idempotencyKey: { type: String, default: null },
  },
  { timestamps: true },
);

// The send history, per mailbox and across a user's mailboxes.
gmailOperationLogSchema.index({ accountId: 1, createdAt: -1 });
gmailOperationLogSchema.index({ userId: 1, createdAt: -1 });

// "Failed sends", which is the view worth having.
gmailOperationLogSchema.index({
  accountId: 1,
  operation: 1,
  status: 1,
  createdAt: -1,
});

// Enforces idempotency. Sparse, because most operations do not supply a key.
gmailOperationLogSchema.index(
  { idempotencyKey: 1 },
  { unique: true, sparse: true },
);

// What an automated agent did, for review. Sparse: almost every row is a user.
gmailOperationLogSchema.index(
  { "actor.kind": 1, createdAt: -1 },
  { sparse: true },
);

const GmailOperationLog = mongoose.model(
  "GmailOperationLog",
  gmailOperationLogSchema,
);

module.exports = {
  GmailOperationLog,
  OPERATIONS,
  STATUSES,
  ACTOR_KINDS,
  gmailOperationLogSchema,
};
