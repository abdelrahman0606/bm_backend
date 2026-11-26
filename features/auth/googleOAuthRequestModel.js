const mongoose = require("mongoose");

/**
 * A consent flow that has been started but not finished.
 *
 * Holding this server-side is what makes the exchange safe: the PKCE code
 * verifier and the redirect URI never leave the server, so a client can only
 * come back with a `state` we issued and a `code` for the redirect URI we
 * chose. The row is single use (`usedAt`) and expires on its own, so a state
 * cannot be replayed.
 */
const googleOAuthRequestSchema = new mongoose.Schema(
  {
    // Opaque value handed to Google and echoed back to us.
    state: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Null for a login flow: nobody is signed in yet when it starts. For a
    // Drive flow it is the owner, and the exchange refuses a state whose
    // owner is not the caller.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    // What the finished flow may be redeemed for. Checked on exchange, so a
    // state issued by the public login endpoint cannot be spent connecting a
    // Drive account, or the other way round. "gmail" is held to the same
    // rule: a Gmail grant carries mail scopes, and the Drive exchange must
    // not be able to redeem one.
    purpose: {
      type: String,
      enum: ["drive", "login", "gmail"],
      default: "drive",
      required: true,
    },
    // PKCE verifier. Stays here; only its SHA-256 challenge went to Google.
    codeVerifier: {
      type: String,
      required: true,
      select: false,
    },
    // Only a Drive flow has one; a login asks for the identity scopes alone.
    accessLevel: {
      type: String,
      default: null,
    },
    scopes: {
      type: [String],
      default: [],
    },
    platform: {
      type: String,
      default: "web",
    },
    // The exact redirect URI sent to Google. The token exchange has to repeat
    // it byte for byte, so it is stored rather than rebuilt.
    redirectUri: {
      type: String,
      required: true,
    },
    // Set when re-authorising an existing account, so the finished flow can
    // be matched back to it even if the user picks a different Google account
    // on the consent screen.
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GoogleAccount",
      default: null,
    },
    loginHint: {
      type: String,
      default: null,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

// Mongo drops finished and abandoned flows on its own; nothing has to sweep.
googleOAuthRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const GoogleOAuthRequest = mongoose.model(
  "GoogleOAuthRequest",
  googleOAuthRequestSchema,
);

module.exports = { GoogleOAuthRequest };
