const mongoose = require("mongoose");

/**
 * Every Gmail push notification we have accepted, so none is processed twice.
 *
 * Google Cloud Pub/Sub guarantees *at least once* delivery. That is not a
 * caveat to note and move past — it is the normal case: a push whose
 * acknowledgement is slow, lost, or returns a 500 is redelivered, and a
 * busy mailbox can produce several notifications for one change. Without a
 * record of what has been seen, each redelivery would replay a history range
 * and spend quota re-fetching messages that are already stored.
 *
 * So the Pub/Sub message id — unique per publish, stable across
 * redeliveries — is written here under a unique index *before* any work
 * starts. The insert is the lock: a duplicate fails on the index, and the
 * endpoint answers 204 so Pub/Sub stops retrying.
 *
 * Rows expire on their own. A week is far longer than Pub/Sub's retention,
 * so a redelivery can never outlive the record that would suppress it, and
 * the collection does not grow without bound.
 */

const STATUSES = [
  // Claimed, work not finished.
  "received",
  // The history range was applied.
  "processed",
  // Applying it failed; the reason is kept and the scheduler will reconcile.
  "failed",
  // Nothing to do: no account for that address, or the history id was stale.
  "skipped",
];

const gmailPushNotificationSchema = new mongoose.Schema(
  {
    /**
     * Pub/Sub's own message id. The deduplication key, and the reason this
     * collection exists.
     */
    pubsubMessageId: { type: String, required: true },
    /** The mailbox Gmail says changed. */
    emailAddress: { type: String, required: true, lowercase: true, trim: true },
    /**
     * The history id Gmail reports as current. Sync replays from the
     * account's *stored* cursor up to here, so an out-of-order or duplicated
     * notification cannot move the cursor backwards.
     */
    historyId: { type: String, default: null },
    /** The Pub/Sub subscription that delivered it, for diagnosis. */
    subscription: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    receivedAt: { type: Date, default: Date.now },

    status: { type: String, enum: STATUSES, default: "received" },
    /** Accounts this notification was applied to: one address, many users. */
    accountIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "GmailAccount" }],
      default: [],
    },
    messagesAdded: { type: Number, default: 0 },
    processedAt: { type: Date, default: null },
    error: { type: String, default: null },

    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true },
);

// The lock. A redelivered notification fails to insert, which is the signal
// that it has already been claimed.
gmailPushNotificationSchema.index({ pubsubMessageId: 1 }, { unique: true });

// Mongo sweeps expired rows; nothing has to.
gmailPushNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// "What has this mailbox been told lately", for diagnosing a quiet push.
gmailPushNotificationSchema.index({ emailAddress: 1, receivedAt: -1 });

// Notifications that failed, which the reconciliation pass looks at.
gmailPushNotificationSchema.index({ status: 1, receivedAt: -1 });

const GmailPushNotification = mongoose.model(
  "GmailPushNotification",
  gmailPushNotificationSchema,
);

module.exports = {
  GmailPushNotification,
  STATUSES,
  gmailPushNotificationSchema,
};
