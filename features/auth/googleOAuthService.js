const crypto = require("crypto");
const { URL, URLSearchParams } = require("url");
const axios = require("axios");
const { OAuth2Client } = require("google-auth-library");
const ApiError = require("../../utils/apiError");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DRIVE_ABOUT_ENDPOINT = "https://www.googleapis.com/drive/v3/about";

/** Requested alongside the Drive scope so an account can be labelled. */
const IDENTITY_SCOPES = ["openid", "email", "profile"];

/**
 * The one Drive scope each access level stands for.
 *
 * `drive.file` sees only what this app created or the user opened with it,
 * `drive` sees everything, `drive.readonly` sees everything but changes
 * nothing. The level the client asks for is the scope we request, so the
 * stored level can never claim more access than Google granted.
 */
const DRIVE_SCOPE_BY_LEVEL = {
  appOnly: "https://www.googleapis.com/auth/drive.file",
  full: "https://www.googleapis.com/auth/drive",
  readOnly: "https://www.googleapis.com/auth/drive.readonly",
};

const STATE_TTL_MINUTES = 10;

const scopesForLevel = (accessLevel) => {
  const driveScope = DRIVE_SCOPE_BY_LEVEL[accessLevel];
  if (!driveScope) {
    throw new ApiError(
      `Unknown access level "${accessLevel}". Expected one of: ${Object.keys(
        DRIVE_SCOPE_BY_LEVEL,
      ).join(", ")}`,
      400,
    );
  }
  // The Drive scope on its own, with no identity scopes alongside it.
  //
  // Asking for `openid email profile` together with a restricted Drive scope
  // makes one consent request span two very different trust levels, and
  // Google is measurably stricter about it — a working build of this flow in
  // another app of ours sends the single Drive scope and nothing else. The
  // account's email and name come from Drive's own `about.get` instead, which
  // every Drive scope permits, so nothing is lost by dropping them.
  return [driveScope];
};


/** Recovers the level from granted scopes, which is what we trust. */
const levelFromScopes = (scopes = []) => {
  if (scopes.includes(DRIVE_SCOPE_BY_LEVEL.full)) return "full";
  if (scopes.includes(DRIVE_SCOPE_BY_LEVEL.readOnly)) return "readOnly";
  return "appOnly";
};

/**
 * OAuth client credentials for a platform.
 *
 * Desktop and web are separate clients in the Google console, and only the
 * secrets live here — that is the reason this flow moved to the server.
 */
const credentialsFor = (platform) => {
  const isDesktop = ["windows", "macos", "linux", "desktop"].includes(
    String(platform).toLowerCase(),
  );

  const clientId = isDesktop
    ? process.env.GOOGLE_CLIENT_ID_DESKTOP
    : process.env.GOOGLE_CLIENT_ID_WEB;
  const clientSecret = isDesktop
    ? process.env.GOOGLE_CLIENT_SECRET_DESKTOP
    : process.env.GOOGLE_CLIENT_SECRET_WEB;

  if (!clientId) {
    throw new ApiError(
      `No Google client id configured for ${isDesktop ? "desktop" : "web"}. ` +
        `Set GOOGLE_CLIENT_ID_${isDesktop ? "DESKTOP" : "WEB"}.`,
      500,
    );
  }
  if (!clientSecret) {
    throw new ApiError(
      `No Google client secret configured for ${
        isDesktop ? "desktop" : "web"
      }. Set GOOGLE_CLIENT_SECRET_${isDesktop ? "DESKTOP" : "WEB"}.`,
      500,
    );
  }

  return { clientId, clientSecret, isDesktop };
};

const base64Url = (buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const createCodeVerifier = () => base64Url(crypto.randomBytes(64));

const challengeFor = (codeVerifier) =>
  base64Url(crypto.createHash("sha256").update(codeVerifier).digest());

const createState = () => base64Url(crypto.randomBytes(32));

const normaliseTokens = (data) => ({
  accessToken: data.access_token || null,
  refreshToken: data.refresh_token || null,
  idToken: data.id_token || null,
  tokenType: data.token_type || "Bearer",
  scopes: typeof data.scope === "string" ? data.scope.split(" ") : [],
  expiresIn: data.expires_in || null,
  expiresAt: data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000)
    : null,
});

const asNumber = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asGoogleError = (error, fallback) => {
  if (error instanceof ApiError) return error;
  const data = error.response?.data;
  const detail = data?.error_description || data?.error;
  const status = error.response?.status;
  return new ApiError(
    detail ? `${fallback}: ${detail}` : fallback,
    status >= 400 && status < 500 ? 400 : 502,
  );
};

/**
 * Redirect URIs we are willing to send a user to.
 *
 * This is the one check that stops the endpoint being an authorization-code
 * exfiltration tool: without it a caller could ask for a consent URL that
 * redirects Google's `code` to a host they control, and then exchange it with
 * our client secret. Desktop uses a loopback listener, which is what Google
 * prescribes for installed apps; web has to be configured explicitly.
 */
const assertRedirectAllowed = (redirectUri, isDesktop) => {
  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new ApiError("redirectUri is not a valid URL", 400);
  }

  if (isDesktop) {
    // Node reports an IPv6 host bracketed, so both spellings are accepted.
    const isLoopbackHost = [
      "127.0.0.1",
      "localhost",
      "::1",
      "[::1]",
    ].includes(parsed.hostname);
    if (parsed.protocol !== "http:" || !isLoopbackHost) {
      throw new ApiError(
        "A desktop redirectUri must be a loopback address, " +
          "for example http://127.0.0.1:53682",
        400,
      );
    }
    if (parsed.search || parsed.hash) {
      throw new ApiError(
        "A desktop redirectUri must not carry a query or fragment",
        400,
      );
    }
    return parsed.toString();
  }

  const allowed = (process.env.GOOGLE_OAUTH_REDIRECT_URIS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    throw new ApiError(
      "No web redirect URI is configured. Set GOOGLE_OAUTH_REDIRECT_URIS " +
        "to a comma separated allow list.",
      500,
    );
  }
  if (!allowed.includes(redirectUri)) {
    throw new ApiError("redirectUri is not in the configured allow list", 403);
  }
  return redirectUri;
};

/**
 * Builds the Google consent URL for one access level.
 *
 * `access_type=offline` with `prompt=consent` is what makes Google return a
 * refresh token; without it the grant lasts an hour and the user would have
 * to re-consent constantly. `select_account` lets a second account be added
 * while the first is still signed in.
 */
/**
 * Query parameters that turn an ordinary authorization request into the
 * desktop Google Picker.
 *
 * Google runs the picker itself, in the system browser, as part of consent,
 * and appends `picked_file_ids` to the redirect. That is why this needs no
 * JavaScript, no API key and no page of our own — unlike the web Picker.
 *
 * The files the user picks become reachable under `drive.file`, which is a
 * non-sensitive scope: it needs no verification review, so this is the way to
 * reach existing Drive files while the app is unverified.
 */
const onePickParams = ({
  allowMultiple = true,
  allowFolderSelection = true,
  mimeTypes,
  fileIds,
} = {}) => ({
  trigger_onepick: "true",
  ...(allowMultiple ? { allow_multiple: "true" } : {}),
  ...(allowFolderSelection ? { allow_folder_selection: "true" } : {}),
  ...(Array.isArray(mimeTypes) && mimeTypes.length > 0
    ? { mimetypes: mimeTypes.join(",") }
    : {}),
  ...(Array.isArray(fileIds) && fileIds.length > 0
    ? { file_ids: fileIds.join(",") }
    : {}),
});

const buildConsentUrl = ({
  accessLevel,
  platform,
  redirectUri,
  state,
  codeChallenge,
  loginHint,
  // A login asks for the identity scopes alone; Drive overrides nothing and
  // gets the scopes its access level stands for.
  scopes: scopeOverride,
  // Offline access is what makes Google return a refresh token. A Drive
  // connection needs one; a login reads the id token once and is done, so
  // asking would mean holding a long-lived grant for no reason.
  offline = true,
  // Re-consenting every time is right for Drive, where the refresh token has
  // to come back, but it is friction on a login that only needs an identity.
  prompt = "consent select_account",
  // Set to turn this into the desktop Google Picker flow. See onePickParams.
  onePick = null,
}) => {
  const { clientId, isDesktop } = credentialsFor(platform);
  // The Picker flow dictates its own scope and ignores the access level: the
  // guide allows `drive.file` and nothing alongside it.
  const scopes = onePick
    ? [DRIVE_SCOPE_BY_LEVEL.appOnly]
    : scopeOverride || scopesForLevel(accessLevel);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: assertRedirectAllowed(redirectUri, isDesktop),
    response_type: "code",
    scope: scopes.join(" "),
    // The Picker flow requires exactly `consent`.
    prompt: onePick ? "consent" : prompt,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  // Incremental authorization would widen the grant past `drive.file`, which
  // is the one thing this flow forbids.
  if (!onePick) params.set("include_granted_scopes", "true");
  if (offline) params.set("access_type", "offline");
  if (loginHint && !onePick) params.set("login_hint", loginHint);
  if (onePick) {
    Object.entries(onePickParams(onePick)).forEach(([key, value]) => {
      params.set(key, value);
    });
  }

  return { url: `${AUTH_ENDPOINT}?${params.toString()}`, scopes };
};


/**
 * Starts a consent flow and records everything the exchange will need.
 *
 * Returns the URL to open plus the opaque state the client sends back; the
 * verifier and the redirect URI stay on the server.
 */
const startConsent = async ({
  accessLevel,
  platform,
  redirectUri,
  loginHint,
  userId,
  accountId,
  // "drive" connects an account; "login" only proves who the user is.
  purpose = "drive",
  scopes: scopeOverride,
  offline = true,
  prompt,
  onePick = null,
  // Injected by the tests so they can run without a database.
  store,
}) => {
  const { isDesktop } = credentialsFor(platform);
  const safeRedirect = assertRedirectAllowed(redirectUri, isDesktop);
  const codeVerifier = createCodeVerifier();
  const state = createState();

  const { url, scopes } = buildConsentUrl({
    accessLevel,
    platform,
    redirectUri: safeRedirect,
    state,
    codeChallenge: challengeFor(codeVerifier),
    loginHint,
    scopes: scopeOverride,
    offline,
    prompt,
    onePick,
  });

  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60 * 1000);
  await store.create({
    state,
    userId: userId || null,
    purpose,
    codeVerifier,
    accessLevel: accessLevel || null,
    scopes,
    platform,
    redirectUri: safeRedirect,
    accountId: accountId || null,
    loginHint: loginHint || null,
    expiresAt,
  });

  return { url, state, scopes, expiresAt };
};

/**
 * Starts a consent flow that only establishes who the user is.
 *
 * Used by the public login endpoint, so it asks for nothing but the identity
 * scopes and no offline access: the id token that comes back is verified and
 * handed to the existing Google login, and the grant is not kept.
 */
const startPickerConsent = async ({
  platform,
  redirectUri,
  userId,
  accountId,
  allowMultiple,
  allowFolderSelection,
  mimeTypes,
  fileIds,
  store,
}) =>
  startConsent({
    platform,
    redirectUri,
    userId,
    accountId,
    purpose: "drive",
    // Whatever the user picks is reachable under `drive.file`, so the account
    // this creates or updates is recorded at that level.
    accessLevel: "appOnly",
    store,
    onePick: {
      allowMultiple,
      allowFolderSelection,
      mimeTypes,
      fileIds,
    },
  });

const startLoginConsent = async ({ platform, redirectUri, loginHint, store }) =>
  startConsent({
    platform,
    redirectUri,
    loginHint,
    purpose: "login",
    scopes: IDENTITY_SCOPES,
    offline: false,
    prompt: "select_account",
    store,
  });

/**
 * Trades an authorization code for tokens.
 *
 * Done with a plain POST rather than through the library's helper so the
 * exact parameters Google sees are visible here, including the PKCE verifier
 * and the redirect URI, both of which have to match the consent request.
 */
const exchangeCode = async ({ code, codeVerifier, redirectUri, platform }) => {
  const { clientId, clientSecret } = credentialsFor(platform);

  try {
    const response = await axios.post(
      TOKEN_ENDPOINT,
      new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    return normaliseTokens(response.data);
  } catch (error) {
    throw asGoogleError(error, "Could not complete Google sign-in");
  }
};

/**
 * Swaps a stored refresh token for a fresh access token.
 *
 * Google does not return a new refresh token here, so the caller keeps the
 * one it has. An `invalid_grant` means the user revoked the grant or it
 * expired, and the account has to go through consent again.
 */
const refreshAccessToken = async ({ refreshToken, platform }) => {
  const { clientId, clientSecret } = credentialsFor(platform);

  try {
    const response = await axios.post(
      TOKEN_ENDPOINT,
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    return normaliseTokens(response.data);
  } catch (error) {
    const reason = error.response?.data?.error;
    if (reason === "invalid_grant" || reason === "invalid_request") {
      throw new ApiError(
        "Google no longer accepts this account's saved permission. " +
          "Sign in again to reconnect it.",
        401,
      );
    }
    throw asGoogleError(error, "Could not refresh the Google access token");
  }
};

/** Tells Google to forget a grant. Best effort: failures are not fatal. */
const revokeToken = async (token) => {
  if (!token) return false;
  try {
    await axios.post(
      REVOKE_ENDPOINT,
      new URLSearchParams({ token }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * Reads the account behind an access token: who it is and how full the Drive
 * is. Used right after consent so the stored row has a name and a quota.
 */
const fetchDriveProfile = async (accessToken) => {
  try {
    const response = await axios.get(DRIVE_ABOUT_ENDPOINT, {
      params: { fields: "user,storageQuota" },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = response.data?.user || {};
    const quota = response.data?.storageQuota || {};
    return {
      email: user.emailAddress || null,
      displayName: user.displayName || null,
      photoUrl: user.photoLink || null,
      externalId: user.permissionId || null,
      quotaTotal: asNumber(quota.limit),
      quotaUsed: asNumber(quota.usage),
      quotaTrashed: asNumber(quota.usageInDriveTrash),
    };
  } catch (error) {
    throw asGoogleError(error, "Could not read the Google account");
  }
};

/** Every Google client id this deployment knows about. */
const allConfiguredClientIds = () =>
  [
    process.env.GOOGLE_CLIENT_ID_WEB,
    process.env.GOOGLE_CLIENT_ID_DESKTOP,
    process.env.GOOGLE_CLIENT_ID_ANDROID,
    process.env.GOOGLE_CLIENT_ID_IOS,
    process.env.GOOGLE_CLIENT_ID,
  ].filter(Boolean);

/**
 * Reads an id token's claims **without verifying it**.
 *
 * Only ever used to explain a verification failure: an audience that belongs
 * to a different client, or an expiry in the past, are the two usual causes
 * and both are invisible otherwise. Never use this to establish identity.
 */
const peekIdTokenClaims = (idToken) => {
  try {
    const segment = String(idToken).split(".")[1];
    if (!segment) return null;
    const json = Buffer.from(
      segment.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const claims = JSON.parse(json);
    return {
      aud: claims.aud || null,
      iss: claims.iss || null,
      exp: claims.exp || null,
      expired: claims.exp ? claims.exp * 1000 < Date.now() : null,
      hasEmail: Boolean(claims.email),
    };
  } catch {
    return null;
  }
};

/** A one-line summary of why a token looks wrong, for an error message. */
const describeIdToken = (idToken) => {
  const claims = peekIdTokenClaims(idToken);
  if (!claims) return "the token could not be decoded";
  const parts = [];
  if (claims.expired) parts.push("it expired");
  if (!claims.hasEmail) parts.push("it carries no email claim");
  if (claims.aud && !allConfiguredClientIds().includes(claims.aud)) {
    parts.push(
      `its audience (${claims.aud}) is not one of this server's client ids`,
    );
  }
  if (parts.length === 0) return "no obvious problem with its claims";
  return parts.join(", and ");
};

/**
 * Verifies an id token and returns the identity in it, or throws.
 *
 * The audience is checked against every configured client id, not just the
 * one for this platform: the same account can sign in from desktop and from
 * the phone, and a token minted for either is legitimately ours.
 */
const verifyIdToken = async (idToken, platform) => {
  const { clientId } = credentialsFor(platform);
  const audience = allConfiguredClientIds();
  const ticket = await new OAuth2Client(clientId).verifyIdToken({
    idToken,
    audience: audience.length > 0 ? audience : clientId,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new ApiError(
      "The Google token carries no email address. The sign-in needs the " +
        "email scope.",
      502,
    );
  }
  return {
    email: payload.email,
    displayName: payload.name || payload.given_name || null,
    photoUrl: payload.picture || null,
    emailVerified: payload.email_verified === true,
  };
};

/**
 * Pulls the email out of the id token that came with the exchange, or null.
 *
 * Soft on purpose: the Drive flow reads the profile from the Drive API as a
 * fallback, so a token it cannot verify is not fatal there. The reason is
 * logged rather than dropped, because a silent null here is exactly what
 * makes a failure further up unexplainable.
 */
const emailFromIdToken = async (idToken, platform) => {
  if (!idToken) return null;
  try {
    return await verifyIdToken(idToken, platform);
  } catch (error) {
    console.warn(
      `Google id token verification failed (${error.message}); ` +
        `${describeIdToken(idToken)}`,
    );
    return null;
  }
};

module.exports = {
  IDENTITY_SCOPES,
  DRIVE_SCOPE_BY_LEVEL,
  STATE_TTL_MINUTES,
  scopesForLevel,
  levelFromScopes,
  credentialsFor,
  assertRedirectAllowed,
  buildConsentUrl,
  startConsent,
  startLoginConsent,
  startPickerConsent,
  onePickParams,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  fetchDriveProfile,
  emailFromIdToken,
  verifyIdToken,
  peekIdTokenClaims,
  describeIdToken,
  allConfiguredClientIds,
  createCodeVerifier,
  challengeFor,
  createState,
};
