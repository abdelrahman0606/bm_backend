const mongoose = require("mongoose");
const { mailModel } = require("./gmailStorage");
const { addressSchema } = require("./gmailMessageModel");

/**
 * A draft, mirrored from Gmail.
 *
 * Gmail owns drafts: a draft composed here appears in the user's own Gmail
 * and the other way round, which is the point of mirroring rather than
 * keeping a private "unsent" table. What is kept locally is the addressing
 * and the body, so a draft list and a resumed compose need no round trip.
 *
 * A draft's underlying message has its own Gmail id and lives in
 * `GmailMessage` too, labelled DRAFT. This row is the composing view of it.
 */
const gmailDraftSchema = new mongoose.Schema(
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
    /** Gmail's draft id. Distinct from the message id. */
    draftId: { type: String, required: true },
    messageGmailId: { type: String, default: null },
    threadId: { type: String, default: null },

    to: { type: [addressSchema], default: [] },
    cc: { type: [addressSchema], default: [] },
    bcc: { type: [addressSchema], default: [] },
    subject: { type: String, default: "" },
    bodyText: { type: String, default: null },
    bodyHtml: { type: String, default: null },

    /** Attachment descriptors only; the bytes are in Gmail. */
    attachments: {
      type: [
        new mongoose.Schema(
          {
            attachmentId: { type: String, default: null },
            filename: { type: String, default: "" },
            mimeType: { type: String, default: "application/octet-stream" },
            size: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** Set when this draft is a reply, so sending keeps the threading. */
    inReplyTo: { type: String, default: null },
    references: { type: [String], default: [] },

    /** Mirrors Gmail; `sent` is terminal and the row is kept as history. */
    status: {
      type: String,
      enum: ["draft", "sent", "discarded"],
      default: "draft",
    },
    lastError: { type: String, default: null },
    syncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

gmailDraftSchema.index({ accountId: 1, draftId: 1 }, { unique: true });
gmailDraftSchema.index({ accountId: 1, status: 1, updatedAt: -1 });
gmailDraftSchema.index({ userId: 1, updatedAt: -1 });

/// Bound to local MongoDB, never Atlas: this is mail content, and
/// `mongoose.model(...)` would put it on the default (Atlas)
/// connection. See `gmailStorage` for why. Only written at all when
/// `GMAIL_STORE_MESSAGES=true`; the default reads straight from Gmail.
const GmailDraft = mailModel("GmailDraft", gmailDraftSchema);

module.exports = { GmailDraft, gmailDraftSchema };
