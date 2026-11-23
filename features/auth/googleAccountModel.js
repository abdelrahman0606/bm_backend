const mongoose = require("mongoose");

/// How much of a connected Google Drive the app may touch. One of these maps
/// onto exactly one Drive OAuth scope, so the level is the permission rather
/// than a label describing one.
const ACCESS_LEVELS = ["appOnly", "full", "readOnly"];

const PROVIDERS = ["google", "microsoft", "dropbox", "custom"];

/**
 * One external account a user has connected.
 *
 * The refresh token lives here and only here: it is `select: false` so no
 * ordinary query can pull it out by accident, and the JSON transform deletes
 * it as a second line of defence. Clients are handed short-lived access
 * tokens instead, which is the whole point of holding the OAuth client secret
 * on the server.
 */
const googleAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: PROVIDERS,
      default: "google",
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    displayName: {
      type: String,
      default: "",
      trim: true,
    },
    photoUrl: {
      type: String,
      default: null,
    },
    // The provider's own id for the account, when it gives one.
    externalId: {
      type: String,
      default: null,
    },
    // Never sent to a client. See the note above.
    refreshToken: {
      type: String,
      default: null,
      select: false,
    },
    scopes: {
      type: [String],
      default: [],
    },
    accessLevel: {
      type: String,
      enum: ACCESS_LEVELS,
      default: "appOnly",
    },
    // The account uploads go to. Exactly one per user, enforced by the
    // service rather than the schema, because keeping it true needs a write
    // to the other rows.
    isPrimary: {
      type: Boolean,
      default: false,
    },
    // Whether this account's files are merged into the browser.
    isEnabled: {
      type: Boolean,
      default: true,
    },
    sortIndex: {
      type: Number,
      default: 0,
    },
    quotaTotal: {
      type: Number,
      default: null,
    },
    quotaUsed: {
      type: Number,
      default: null,
    },
    quotaTrashed: {
      type: Number,
      default: null,
    },
    // Folder the browser opens at; null means the account's own root.
    rootFolderId: {
      type: String,
      default: null,
    },
    // Set when the stored refresh token stopped working, so the client can
    // ask for consent again instead of failing every call.
    needsReauth: {
      type: Boolean,
      default: false,
    },
    lastError: {
      type: String,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    // Room for provider-specific extras without a schema change.
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
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

// One row per account per user. Signing the same Google account in again
// updates that row instead of creating a second one.
googleAccountSchema.index(
  { userId: 1, provider: 1, email: 1 },
  { unique: true },
);

// The list is read as "this user's accounts, primary first, then arranged".
googleAccountSchema.index({ userId: 1, isPrimary: -1, sortIndex: 1 });

/** True when the account can be used without the user signing in again. */
googleAccountSchema.virtual("isSignedOut").get(function isSignedOut() {
  // `refreshToken` is not selected by default; treat "not loaded" as unknown
  // and fall back to the explicit flag, which is always present.
  if (this.refreshToken === undefined) return this.needsReauth === true;
  return !this.refreshToken;
});

const GoogleAccount = mongoose.model("GoogleAccount", googleAccountSchema);

// Exported as an object rather than the bare model, because the level and
// provider lists travel with it: the validators and the service both check
// against the same source the schema enum uses.
module.exports = {
  GoogleAccount,
  ACCESS_LEVELS,
  PROVIDERS,
  googleAccountSchema,
};
