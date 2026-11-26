const ApiError = require("../../utils/apiError");
const secretBox = require("../../core/security/secretBox");
const googleOAuth = require("../auth/googleOAuthService");
const { GmailAccount } = require("./gmailAccountModel");

/**
 * Hands out Gmail access tokens, and nothing else hands them out.
 *
 * Everything that talks to Gmail comes through here, which gives one place to
 * enforce four things.
 *
 * **The refresh token is opened for as long as one HTTP call takes.** It is
 * read from the database sealed, decrypted in a local, and never stored
 * decrypted, never logged, never returned. Callers receive a *client*, not a
 * credential — `clientFor(account)` is the public shape, and an access token
 * is an implementation detail of it.
 *
 * **One refresh per account, not one per caller.** A sync, a send and a label
 * change arriving together used to mean three token requests for the same
 * mailbox. The in-flight promise is shared, so concurrent callers wait on one
 * round trip. Google rate-limits the token endpoint too.
 *
 * **A dead grant is recorded once.** When Google refuses the refresh token —
 * the user revoked access, or changed their password — the account is flagged
 * `needsReauth` and every later call fails fast with a message telling the
 * user to reconnect, instead of each one discovering it again.
 *
 * **The cache is in-process and that is deliberate.** Access tokens live an
 * hour; a restart or a second instance simply refreshes again, which costs
 * one call. Putting them in Mongo or Redis would mean a second place where a
 * live credential sits at rest, for no gain.
 */

/** accountId → { accessToken, expiresAt } */
const cache = new Map();

/** accountId → in-flight refresh promise. */
const inFlight = new Map();

/**
 * Treat a token as expired a minute early. A token that passes the check and
 * then expires in transit produces a 401 the client has to recover from; a
 * minute of margin costs nothing and removes the race.
 */
const EXPIRY_MARGIN_MS = 60 * 1000;

const isFresh = (entry) =>
  Boolean(entry) &&
  entry.accessToken &&
  entry.expiresAt instanceof Date &&
  entry.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now();

/** Forgets a mailbox's cached token. Called on sign-out and on failure. */
const forget = (accountId) => {
  cache.delete(String(accountId));
  inFlight.delete(String(accountId));
};

const forgetAll = () => {
  cache.clear();
  inFlight.clear();
};

/**
 * Reads the sealed refresh token for an account.
 *
 * Loaded by id with `+refreshToken` rather than taken from a document the
 * caller already has, because a document fetched normally does not carry it —
 * and a caller that had to remember to select it would eventually forget.
 */
const loadGrant = async (accountId) => {
  const account = await GmailAccount.findById(accountId).select(
    "+refreshToken email platform needsReauth userId accessLevel scopes",
  );
  if (!account) throw new ApiError("Gmail account not found", 404);
  return account;
};

const signedOutError = (account) =>
  new ApiError(
    `${account.email} is signed out. Reconnect it to use this mailbox.`,
    401,
  );

/**
 * Refreshes and caches a mailbox's access token.
 *
 * The write-back is narrow on purpose: `updateOne` with the specific fields,
 * not `account.save()`. A sync running in parallel may be moving the history
 * cursor on the same document, and saving a whole document loaded a second
 * ago would roll that back.
 */
const refresh = async (accountId) => {
  const account = await loadGrant(accountId);

  if (!account.refreshToken) {
    forget(accountId);
    throw signedOutError(account);
  }

  // Opened here and held in a local for the length of one token request.
  // A failure to open means the encryption key is missing or wrong, which
  // `secretBox` reports as a 500 — deliberately not caught: the stored token
  // is intact and the account must not be flagged as needing re-consent for
  // what is a server misconfiguration.
  const refreshToken = secretBox.open(account.refreshToken);

  try {
    const tokens = await googleOAuth.refreshAccessToken({
      refreshToken,
      platform: account.platform || "web",
    });

    if (!tokens.accessToken) {
      throw new ApiError("Google returned no access token", 502);
    }

    const expiresAt =
      tokens.expiresAt || new Date(Date.now() + 55 * 60 * 1000);

    cache.set(String(accountId), {
      accessToken: tokens.accessToken,
      expiresAt,
    });

    const update = {
      needsReauth: false,
      lastUsedAt: new Date(),
      "syncState.lastError": null,
    };
    // Google returns the granted scopes on a refresh. If the user has since
    // narrowed them in their account settings, this is where we find out —
    // so the stored level follows the grant rather than the other way round.
    if (tokens.scopes && tokens.scopes.length > 0) {
      update.scopes = tokens.scopes;
    }
    await GmailAccount.updateOne({ _id: accountId }, { $set: update });

    return cache.get(String(accountId));
  } catch (error) {
    forget(accountId);

    // 401 is Google refusing the grant itself: re-consent is the only fix, so
    // record it. Anything else (a network blip, a 5xx) leaves the account
    // alone — flagging it would send the user to a consent screen they do
    // not need.
    if (error.statusCode === 401) {
      await GmailAccount.updateOne(
        { _id: accountId },
        {
          $set: {
            needsReauth: true,
            "syncState.status": "failed",
            "syncState.lastError": error.message,
            "syncState.lastErrorAt": new Date(),
          },
        },
      );
    }
    throw error;
  }
};

/**
 * A usable access token for a mailbox.
 *
 * `forceRefresh` is how the HTTP client recovers from a 401: it says "the
 * token you gave me was refused, get another" without this module having to
 * guess why.
 */
const accessTokenFor = async (accountId, { forceRefresh = false } = {}) => {
  const key = String(accountId);

  if (!forceRefresh) {
    const cached = cache.get(key);
    if (isFresh(cached)) return cached.accessToken;
  } else {
    cache.delete(key);
  }

  if (!inFlight.has(key)) {
    // The promise is registered before it is awaited, so a second caller
    // arriving in the same tick finds it and waits rather than starting its
    // own refresh.
    const pending = refresh(key).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }

  const entry = await inFlight.get(key);
  return entry.accessToken;
};

/** Exposed for the tests, and for a diagnostic endpoint later. */
const cachedExpiry = (accountId) => {
  const entry = cache.get(String(accountId));
  return entry ? entry.expiresAt : null;
};

module.exports = {
  EXPIRY_MARGIN_MS,
  accessTokenFor,
  forget,
  forgetAll,
  cachedExpiry,
  // Overridden in tests so the client can be built without a database.
  _internals: { cache, inFlight, isFresh, loadGrant },
};
