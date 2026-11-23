const ApiError = require("../../utils/apiError");
const { GoogleOAuthRequest } = require("./googleOAuthRequestModel");
const googleOAuth = require("./googleOAuthService");
const authService = require("./authService");

/**
 * Google sign-in for the app itself, with the OAuth client secret kept here.
 *
 * The desktop app used to run this flow on its own, which meant shipping the
 * secret inside the installer. Now it asks for a consent URL, catches the
 * redirect on a loopback port, and sends the authorization code here — a code
 * is useless without the secret, so nothing sensitive is in the app.
 *
 * What comes back is the Google **id token**, not a session: it goes straight
 * into the existing `POST /auth/google`, which already verifies it, applies
 * the invitation rules and issues our own JWT. Keeping that split means the
 * register/login logic has exactly one implementation.
 *
 * Both endpoints are public, because nobody is signed in while signing in.
 * What keeps them safe is the same as for the Drive flow: the redirect URI is
 * validated rather than trusted, the PKCE verifier never leaves the server,
 * and a state is single use, expires in minutes and is marked `login` so it
 * cannot be redeemed for a Drive connection.
 */

/** Starts a login consent flow. */
exports.startLogin = async ({ platform, redirectUri, loginHint }) =>
  googleOAuth.startLoginConsent({
    platform,
    redirectUri,
    loginHint,
    store: GoogleOAuthRequest,
  });

/**
 * Finishes a login flow and returns the verified Google identity.
 *
 * The id token is verified here before being handed back, so a caller cannot
 * talk us into relaying a token for an account that never consented.
 */
exports.completeLogin = async ({ state, code }) => {
  const request = await GoogleOAuthRequest.findOne({ state }).select(
    "+codeVerifier",
  );

  if (!request) {
    throw new ApiError("This sign-in request expired. Start again.", 400);
  }
  if (request.purpose !== "login") {
    throw new ApiError("This sign-in request is not for signing in", 400);
  }
  if (request.usedAt) {
    throw new ApiError("This sign-in request was already used", 400);
  }
  if (request.expiresAt.getTime() < Date.now()) {
    throw new ApiError("This sign-in request expired. Start again.", 400);
  }

  // Burn the state before the exchange, so a replay cannot ride on a slow
  // network round trip.
  request.usedAt = new Date();
  await request.save();

  const tokens = await googleOAuth.exchangeCode({
    code,
    codeVerifier: request.codeVerifier,
    redirectUri: request.redirectUri,
    platform: request.platform,
  });

  if (!tokens.idToken) {
    throw new ApiError(
      "Google did not return an identity token. The sign-in must request " +
        "the openid scope.",
      502,
    );
  }

  // Verified with the same four strategies `POST /auth/google` uses, rather
  // than a second, weaker implementation: it tries the id token against every
  // configured client id and falls back to Google's tokeninfo and userinfo
  // endpoints, which between them cover the cases a single verifyIdToken call
  // gets wrong — a token minted for another of our client ids, and a local
  // clock too far off for the signature check.
  let identity;
  try {
    identity = await authService.verifyGoogleToken(
      tokens.idToken,
      request.platform,
    );
  } catch (error) {
    // Say what was wrong with the token, not just that something was.
    throw new ApiError(
      `Could not read the Google account identity. ${error.message} ` +
        `(${googleOAuth.describeIdToken(tokens.idToken)})`,
      502,
    );
  }

  if (!identity || !identity.email) {
    throw new ApiError(
      "Google returned an account with no email address. The sign-in needs " +
        "the email scope.",
      502,
    );
  }

  return {
    // Fed straight into POST /auth/google by the client.
    idToken: tokens.idToken,
    platform: request.platform,
    email: identity.email,
    // verifyGoogleToken speaks the shape the login route expects (`name`),
    // which differs from the Drive flow's (`displayName`).
    displayName: identity.name || null,
    photoUrl: identity.picture || null,
    emailVerified: identity.email_verified === true,
  };
};
