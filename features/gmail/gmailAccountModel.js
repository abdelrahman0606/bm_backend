const mongoose = require("mongoose");
const { ACCESS_LEVELS } = require("./gmailScopes");

/**
 * A Gmail mailbox one BM user has connected.
 *
 * This is deliberately a separate collection from `GoogleAccount`, which
 * holds connected Drives. They look similar and are not: a Drive row carries
 * a storage quota and a root folder, a Gmail row carries a history cursor and
 * a push subscription, and the same person may well connect the same Google
 * account to both at different permission levels. Folding them together
 * would mean one row with two half-empty halves and one unique key fighting
 * two lifecycles — and it would mean touching the working Drive feature to
 * add mail sync state to it.
 *
 * What *is* shared is the OAuth machinery: `features/auth/googleOAuthService`
 * builds the consent URL, exchanges the code and refreshes the token for both.
 *
 * The refresh token is sealed with AES-256-GCM (`core/security/secretBox`)
 * before it is written, is `select: false` so no ordinary query can pull it
 * out, and is stripped by both JSON transforms. A refresh token for a mail
 * scope is a standing permission to read somebody's mail; it never leaves
 * this process, and clients are handed nothing but the data they asked for.
 */

/** Where an account stands with the server's copy of its mailbox. */
const SYNC_STATUSES = [
  "idle",
  // A first pass is walking the mailbox backwards in pages.
  "initial",
  // An incremental pass is applying history records.
  "syncing",
  // Google refused the stored grant, or the mailbox is gone.
  "failed",
  // Paused by the user, or by repeated failures.
  "paused",
];

const syncStateSchema = new mongoose.Schema(
  {
    status: { type: String, enum: SYNC_STATUSES, default: "idle" },
    /**
     * Gmail's own cursor. Every mailbox change bumps it, and
     * `users.history.list?startHistoryId=` replays everything since. This is
     * the single most important field in the collection: it is what makes
     * synchronization incremental instead of a repeated full download.
     *
     * A string, not a number: Gmail documents it as an unsigned 64-bit value,
     * which does not fit a JavaScript number safely.
     */
    lastHistoryId: { type: String, default: null },
    /** Page token of an initial sync that has not finished yet. */
    initialPageToken: { type: String, default: null },
    initialSyncedCount: { type: Number, default: 0 },
    lastSyncAt: { type: Date, default: null },
    lastFullSyncAt: { type: Date, default: null },
    /** When the scheduler should next look at this account. */
    nextSyncAt: { type: Date, default: null },
    /**
     * Held by whichever worker is syncing this account, with an expiry. One
     * mailbox is never synced by two workers at once — not because it would
     * corrupt anything (every write is an upsert keyed by the Gmail id) but
     * because it would double the API quota spend and race the cursor
     * backwards.
     */
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    /** Consecutive failures, which is what the backoff is computed from. */
    failureCount: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
  },
  { _id: false },
);

/**
 * The Gmail `users.watch` subscription that makes new mail arrive as a push
 * rather than a poll.
 *
 * Google expires a watch after seven days whatever happens, so renewal is not
 * an error path — it is the normal operating cycle, and the scheduler renews
 * well before expiry. `active: false` with an expiry in the past is the
 * resting state of an account that has never been watched.
 */
const watchSchema = new mongoose.Schema(
  {
    active: { type: Boolean, default: false },
    /** Pub/Sub topic this mailbox publishes to. */
    topicName: { type: String, default: null },
    /** `historyId` the watch was established at. */
    historyId: { type: String, default: null },
    expiration: { type: Date, default: null },
    lastRenewedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    /** Notifications received, for a glance at whether push is working. */
    notificationCount: { type: Number, default: 0 },
    lastNotificationAt: { type: Date, default: null },
  },
  { _id: false },
);

const gmailAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    displayName: { type: String, default: "", trim: true },
    photoUrl: { type: String, default: null },
    /** Google's stable id for the person, from the id token's `sub`. */
    googleUserId: { type: String, default: null },

    // ── The grant ──────────────────────────────────────────────────────────
    /** Sealed by core/security/secretBox. Never selected, never serialized. */
    refreshToken: { type: String, default: null, select: false },
    scopes: { type: [String], default: [] },
    accessLevel: {
      type: String,
      enum: ACCESS_LEVELS,
      default: "modify",
    },
    /** The OAuth client the grant was issued to; refreshing needs the same. */
    platform: { type: String, default: "web" },
    /** Set when Google stopped accepting the stored grant. */
    needsReauth: { type: Boolean, default: false },
    signedOutAt: { type: Date, default: null },

    // ── Presentation ───────────────────────────────────────────────────────
    /** The mailbox new mail is sent from when none is named. */
    isPrimary: { type: Boolean, default: false },
    /** Whether this mailbox is merged into the unified inbox. */
    isEnabled: { type: Boolean, default: true },
    sortIndex: { type: Number, default: 0 },
    /** Name on outgoing mail; falls back to the Google profile name. */
    sendAsName: { type: String, default: null, trim: true },
    signature: { type: String, default: null },

    // ── Mailbox facts, as Gmail last reported them ─────────────────────────
    messagesTotal: { type: Number, default: null },
    threadsTotal: { type: Number, default: null },
    labelsSyncedAt: { type: Date, default: null },

    syncState: { type: syncStateSchema, default: () => ({}) },
    watch: { type: watchSchema, default: () => ({}) },

    lastUsedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.refreshToken;
        if (ret.syncState) {
          // Lease bookkeeping is the scheduler's business, not a client's.
          delete ret.syncState.lockedBy;
          delete ret.syncState.lockedUntil;
        }
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.refreshToken;
        return ret;
      },
    },
  },
);

// One row per mailbox per user. Connecting the same mailbox again updates it.
gmailAccountSchema.index({ userId: 1, email: 1 }, { unique: true });

// "This user's mailboxes, the sending one first, then as arranged."
gmailAccountSchema.index({ userId: 1, isPrimary: -1, sortIndex: 1 });

// A push notification names a mailbox by address and nothing else, and the
// same mailbox may be connected by several BM users — so this lookup returns
// every row for that address and each is synced on its own grant.
gmailAccountSchema.index({ email: 1 });

// The two sweeps the scheduler runs.
gmailAccountSchema.index({ "watch.active": 1, "watch.expiration": 1 });
gmailAccountSchema.index({ "syncState.nextSyncAt": 1 });

/** True when the mailbox can be used without the user signing in again. */
gmailAccountSchema.virtual("isSignedOut").get(function isSignedOut() {
  // `refreshToken` is not selected by default, so "not loaded" is unknown and
  // the explicit flag answers instead.
  if (this.refreshToken === undefined) return this.needsReauth === true;
  return !this.refreshToken;
});

/** True when synchronization is believed to be keeping up. */
gmailAccountSchema.virtual("isSyncHealthy").get(function isSyncHealthy() {
  if (this.needsReauth) return false;
  const state = this.syncState || {};
  return state.status !== "failed" && (state.failureCount || 0) === 0;
});

const GmailAccount = mongoose.model("GmailAccount", gmailAccountSchema);

module.exports = {
  GmailAccount,
  SYNC_STATUSES,
  gmailAccountSchema,
};
