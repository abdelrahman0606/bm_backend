const mongoose = require("mongoose");
const { mailModel } = require("./gmailStorage");

/**
 * A Gmail label, mirrored so the UI can name one without a round trip.
 *
 * Gmail has no folders: INBOX, SENT, SPAM, TRASH, STARRED and every category
 * are labels, and so is everything the user made. A message's `labelIds` are
 * therefore meaningless to display until they can be resolved to names, which
 * is what this is for.
 *
 * Mirrored, not owned: Gmail is the source of truth and a sync overwrites
 * this wholesale. Nothing here is edited locally.
 */
const gmailLabelSchema = new mongoose.Schema(
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
    /** Gmail's label id: "INBOX", "Label_12"... */
    labelId: { type: String, required: true },
    name: { type: String, required: true },
    /** `system` labels cannot be renamed or deleted; `user` ones can. */
    type: { type: String, enum: ["system", "user"], default: "user" },
    messageListVisibility: { type: String, default: null },
    labelListVisibility: { type: String, default: null },
    color: {
      textColor: { type: String, default: null },
      backgroundColor: { type: String, default: null },
    },
    /**
     * Counts as Gmail last reported them. Not recomputed locally: the server
     * only holds the messages it has synced, so a local count would be
     * smaller than the truth and look like data loss.
     */
    messagesTotal: { type: Number, default: null },
    messagesUnread: { type: Number, default: null },
    threadsTotal: { type: Number, default: null },
    threadsUnread: { type: Number, default: null },
    syncedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

gmailLabelSchema.index({ accountId: 1, labelId: 1 }, { unique: true });
gmailLabelSchema.index({ accountId: 1, type: 1, name: 1 });
gmailLabelSchema.index({ userId: 1 });

/// Bound to local MongoDB, never Atlas: this is mail content, and
/// `mongoose.model(...)` would put it on the default (Atlas)
/// connection. See `gmailStorage` for why. Only written at all when
/// `GMAIL_STORE_MESSAGES=true`; the default reads straight from Gmail.
const GmailLabel = mailModel("GmailLabel", gmailLabelSchema);

module.exports = { GmailLabel, gmailLabelSchema };
