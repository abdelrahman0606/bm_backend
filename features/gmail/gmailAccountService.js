const ApiError = require("../../utils/apiError");
const secretBox = require("../../core/security/secretBox");
const googleOAuth = require("../auth/googleOAuthService");
const { GoogleOAuthRequest } = require("../auth/googleOAuthRequestModel");
const { GmailAccount } = require("./gmailAccountModel");
const { GmailMessage } = require("./gmailMessageModel");
const { GmailThread } = require("./gmailThreadModel");
const { GmailLabel } = require("./gmailLabelModel");
const { GmailDraft } = require("./gmailDraftModel");
const gmailScopes = require("./gmailScopes");
const gmailClient = require("./gmailClient");
const tokenService = require("./gmailTokenService");
const audit = require("./gmailAuditService");
const events = require("./gmailEvents");

/**
 * Connecting, listing and disconnecting Gmail mailboxes.
 *
 * The OAuth dance itself is not reimplemented here. `features/auth/
 * googleOAuthService` already builds consent URLs, holds the PKCE verifier
 * server-side, exchanges codes and refreshes tokens for the Drive
 * integration, and all of that is scope-agnostic — so Gmail passes its own
 * scopes through it and the two features share one audited implementation of
 * the protocol. The only change made to it was adding `"gmail"` to the
 * `purpose` enum, which is what keeps the grants separated:
 *
 *   a state issued for Gmail cannot be redeemed by the Drive exchange, and a
 *   Drive state cannot be redeemed here.
 *
 * That check is not ceremony. A Gmail grant carries mail scopes; letting
 * either endpoint spend the other's state would mean a flow the user approved
 * for one thing being used for another.
 *
 * Ownership is the authorization model, and it is enforced in one function.
 * Every operation in this feature begins with `requireAccount(userId, id)`,
 * which loads the row by id *and* user. A mailbox is personal: there is no
 * company-wide view of one and no administrator override, so there is nothing
 * for the permission engine to decide. The id in the URL is never trusted on
 * its own.
 */

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

const SORT_FIELDS = {
  primaryFirst: { isPrimary: -1, sortIndex: 1, email: 1 },
  email: { email: 1 },
  name: { displayName: 1, email: 1 },
  lastUsed: { lastUsedAt: 1, email: 1 },
  created: { createdAt: 1, email: 1 },
  lastSync: { "syncState.lastSyncAt": 1, email: 1 },
};

const flipDirection = (sort) =>
  Object.keys(sort).reduce((flipped, key) => {
    const next = flipped;
    next[key] = sort[key] === 1 ? -1 : 1;
    return next;
  }, {});

/** Escapes a search term so it cannot act as a regular expression. */
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toArray = (value) => {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
};

const buildQuery = (userId, { search, status, accessLevel } = {}) => {
  const query = { userId };

  const keyword = String(search || "").trim();
  if (keyword) {
    const pattern = new RegExp(escapeRegex(keyword), "i");
    query.$or = [{ email: pattern }, { displayName: pattern }];
  }

  const levels = toArray(accessLevel);
  if (levels.length) query.accessLevel = { $in: levels };

  switch (status) {
    case "connected":
      query.needsReauth = false;
      break;
    case "needsLogin":
      query.needsReauth = true;
      break;
    case "hidden":
      query.isEnabled = false;
      break;
    case "syncFailed":
      query["syncState.status"] = "failed";
      break;
    default:
      break;
  }

  return query;
};

/**
 * The account, or a 404 — and never another user's.
 *
 * The single gate every other service calls. It returns the document without
 * the refresh token: nothing outside `gmailTokenService` needs it, and a
 * document that does not carry it cannot leak it.
 */
exports.requireAccount = async (userId, accountId) => {
  const account = await GmailAccount.findOne({ _id: accountId, userId });
  if (!account) throw new ApiError("Gmail account not found", 404);
  return account;
};

/** The same, plus a refusal when the mailbox cannot currently be used. */
exports.requireUsableAccount = async (userId, accountId, capability) => {
  const account = await exports.requireAccount(userId, accountId);

  if (account.needsReauth) {
    throw new ApiError(
      `${account.email} needs to be reconnected before it can be used.`,
      401,
    );
  }
  if (capability) gmailScopes.assertCan(account, capability);
  return account;
};

/** An authorized Gmail client for one mailbox. */
exports.clientFor = (account) =>
  gmailClient.createClient({
    getAccessToken: ({ forceRefresh } = {}) =>
      tokenService.accessTokenFor(account._id, { forceRefresh }),
  });

/** The mailbox used when a send does not name one. */
exports.primaryAccount = async (userId) => {
  const primary = await GmailAccount.findOne({
    userId,
    isPrimary: true,
    isEnabled: true,
  });
  if (primary) return primary;
  return GmailAccount.findOne({ userId, isEnabled: true }).sort({
    sortIndex: 1,
  });
};

/** One page of this user's mailboxes. */
exports.listAccounts = async (userId, options = {}) => {
  const page = Math.max(0, Number(options.page) || 0);
  const requested = Number(options.limit) || DEFAULT_PAGE_SIZE;
  const limit = Math.min(Math.max(1, requested), MAX_PAGE_SIZE);

  const query = buildQuery(userId, options);
  const base = SORT_FIELDS[options.sortBy] || SORT_FIELDS.primaryFirst;
  const sort =
    String(options.descending) === "true" ? flipDirection(base) : base;

  const [accounts, total] = await Promise.all([
    GmailAccount.find(query)
      .sort(sort)
      .skip(page * limit)
      .limit(limit)
      .exec(),
    GmailAccount.countDocuments(query),
  ]);

  return {
    accounts,
    total,
    page,
    limit,
    hasMore: (page + 1) * limit < total,
  };
};

// ───────────────────────────── Connecting ──────────────────────────────────

/**
 * Starts a consent flow for a Gmail mailbox.
 *
 * Refuses before opening a browser window when the encryption key is not
 * configured: the flow would otherwise run to the end and fail at the moment
 * the refresh token had to be stored, after the user had already approved
 * access to their mail. Failing first is the kinder and safer order.
 *
 * Passing `accountId` re-authorizes that mailbox: its address becomes the
 * login hint so Google offers the right account first.
 */
exports.startConsent = async (
  userId,
  { accessLevel = "modify", platform, redirectUri, accountId },
) => {
  secretBox.assertConfigured();
  const scopes = gmailScopes.scopesForLevel(accessLevel);

  let loginHint = null;
  if (accountId) {
    const account = await exports.requireAccount(userId, accountId);
    loginHint = account.email;
  }

  return googleOAuth.startConsent({
    accessLevel,
    platform,
    redirectUri,
    loginHint,
    userId,
    accountId: accountId || null,
    purpose: "gmail",
    scopes,
    // A mailbox has to be synced while nobody is signed in, so the refresh
    // token is the whole point of this flow.
    offline: true,
    prompt: "consent select_account",
    store: GoogleOAuthRequest,
  });
};

/**
 * Finishes a consent flow and saves the mailbox.
 *
 * The order of the checks is the security of the endpoint: the state is
 * looked up, proved to be for Gmail, proved to belong to this caller, proved
 * unused and unexpired, and *then* burned before the code is exchanged — so a
 * replay arriving during the round trip to Google finds a used state rather
 * than a second chance.
 */
exports.completeConsent = async (userId, { state, code }) => {
  secretBox.assertConfigured();

  const request = await GoogleOAuthRequest.findOne({ state }).select(
    "+codeVerifier",
  );

  if (!request) {
    throw new ApiError("This sign-in request expired. Start again.", 400);
  }
  if (request.purpose !== "gmail") {
    throw new ApiError(
      "This sign-in request is not for connecting a Gmail mailbox",
      400,
    );
  }
  if (String(request.userId) !== String(userId)) {
    throw new ApiError("This sign-in request belongs to another user", 403);
  }
  if (request.usedAt) {
    throw new ApiError("This sign-in request was already used", 400);
  }
  if (request.expiresAt.getTime() < Date.now()) {
    throw new ApiError("This sign-in request expired. Start again.", 400);
  }

  request.usedAt = new Date();
  await request.save();

  const tokens = await googleOAuth.exchangeCode({
    code,
    codeVerifier: request.codeVerifier,
    redirectUri: request.redirectUri,
    platform: request.platform,
  });

  if (!tokens.accessToken) {
    throw new ApiError("Google did not return an access token", 502);
  }

  // The granted scopes, not the requested ones: a user can untick a
  // permission on the consent screen, and a stored level taken from the
  // request would claim access this grant does not have.
  const grantedScopes = tokens.scopes.length ? tokens.scopes : request.scopes;
  const accessLevel = gmailScopes.levelFromScopes(grantedScopes);

  if (!accessLevel) {
    throw new ApiError(
      "The permissions granted do not allow reading this mailbox. " +
        "Connect it again and leave the Gmail permission ticked.",
      400,
    );
  }

  // Read the mailbox's own address from Gmail rather than from an id token.
  // These scopes carry no identity claim — asking for `openid email profile`
  // alongside a restricted mail scope would widen the consent screen for
  // information `users.getProfile` already gives us.
  const profile = await exports.fetchProfileWithToken(tokens.accessToken);
  const email = String(profile.emailAddress || "").toLowerCase();
  if (!email) {
    throw new ApiError("Google did not return the mailbox address", 502);
  }

  const account = await exports.saveConnectedAccount(userId, {
    email,
    refreshToken: tokens.refreshToken,
    scopes: grantedScopes,
    accessLevel,
    platform: request.platform,
    messagesTotal: profile.messagesTotal,
    threadsTotal: profile.threadsTotal,
    historyId: profile.historyId,
  });

  await audit.record({
    accountId: account._id,
    userId,
    operation: "account.connected",
    actor: audit.userActor(userId),
    request: { subject: email },
    result: { affected: 1 },
  });
  events.accountConnected(account);

  return {
    account,
    accessLevel,
    scopes: grantedScopes,
    // The access token is not returned. Unlike Drive, where the client talks
    // to Google directly, every Gmail call goes through this backend — so a
    // client never needs one, and handing one out would put a live mail
    // credential on a device for no reason.
    syncQueued: true,
  };
};

/** `users.getProfile` with a bare access token, before an account exists. */
exports.fetchProfileWithToken = async (accessToken) => {
  const client = gmailClient.createClient({
    getAccessToken: async () => accessToken,
  });
  return client.getProfile();
};

/**
 * Creates or updates the row for a freshly authorized mailbox.
 *
 * Reconnecting keeps everything the user arranged — its place in the list,
 * whether it sends by default, its signature — and replaces only the grant.
 * The sync cursor is kept too: a reconnected mailbox resumes from its history
 * id instead of re-downloading everything, and Google's seven-day history
 * window makes that the right default. A gap longer than that is detected by
 * the sync itself, which falls back to a full pass.
 *
 * A missing refresh token leaves the stored one alone: Google omits it when
 * the user had already consented, and overwriting with null would silently
 * sign the mailbox out.
 */
exports.saveConnectedAccount = async (userId, details) => {
  const sealed = details.refreshToken
    ? secretBox.seal(details.refreshToken)
    : null;

  const existing = await GmailAccount.findOne({
    userId,
    email: details.email,
  }).select("+refreshToken");

  if (existing) {
    if (sealed) existing.refreshToken = sealed;
    existing.scopes = details.scopes;
    existing.accessLevel = details.accessLevel;
    existing.platform = details.platform || existing.platform;
    existing.messagesTotal = details.messagesTotal ?? existing.messagesTotal;
    existing.threadsTotal = details.threadsTotal ?? existing.threadsTotal;
    existing.needsReauth = false;
    existing.signedOutAt = null;
    existing.isEnabled = true;
    existing.lastUsedAt = new Date();
    existing.syncState.status = "idle";
    existing.syncState.failureCount = 0;
    existing.syncState.lastError = null;
    // Sync as soon as the scheduler next ticks.
    existing.syncState.nextSyncAt = new Date();
    if (!existing.syncState.lastHistoryId && details.historyId) {
      existing.syncState.lastHistoryId = String(details.historyId);
    }
    await existing.save();
    // A cached token minted for the previous grant may carry narrower scopes.
    tokenService.forget(existing._id);
    await exports.ensureOnePrimary(userId);
    return GmailAccount.findById(existing._id);
  }

  const count = await GmailAccount.countDocuments({ userId });
  const highest = await GmailAccount.findOne({ userId })
    .sort({ sortIndex: -1 })
    .select("sortIndex");

  const created = await GmailAccount.create({
    userId,
    email: details.email,
    // These scopes carry no profile claim, so the address is the only name we
    // have until the user sets one. Inventing a display name from the local
    // part would be a guess shown as a fact.
    displayName: details.displayName || details.email,
    refreshToken: sealed,
    scopes: details.scopes,
    accessLevel: details.accessLevel,
    platform: details.platform || "web",
    // The first mailbox has to be the sending one, or a send with no account
    // named would have nowhere to go.
    isPrimary: count === 0,
    isEnabled: true,
    sortIndex: highest ? highest.sortIndex + 1 : 0,
    messagesTotal: details.messagesTotal ?? null,
    threadsTotal: details.threadsTotal ?? null,
    // Not the history id from the profile: the first pass is a full one, and
    // the cursor is set from what that pass actually observed. Starting from
    // "now" would silently skip every message already in the mailbox.
    syncState: {
      status: "idle",
      nextSyncAt: new Date(),
    },
    // A grant with no refresh token can be used until the access token
    // expires and never again, which is indistinguishable from signed out.
    needsReauth: !details.refreshToken,
    lastUsedAt: new Date(),
  });

  await exports.ensureOnePrimary(userId);
  return GmailAccount.findById(created._id);
};

// ──────────────────────────── Editing and removal ──────────────────────────

/**
 * Saves the fields a user may edit.
 *
 * The access level is not one of them: it is the OAuth scope, so changing it
 * means asking Google again. A caller that wants a different level starts a
 * new consent flow, and the validator refuses the field outright rather than
 * ignoring it — an ignored permission change is one a caller believes took
 * effect.
 */
exports.updateAccount = async (userId, accountId, changes) => {
  const account = await exports.requireAccount(userId, accountId);

  if (typeof changes.displayName === "string") {
    const trimmed = changes.displayName.trim();
    if (trimmed) account.displayName = trimmed;
  }
  if (typeof changes.sendAsName === "string") {
    account.sendAsName = changes.sendAsName.trim() || null;
  }
  if (typeof changes.signature === "string") {
    account.signature = changes.signature || null;
  }

  if (typeof changes.isEnabled === "boolean") {
    if (account.isPrimary && !changes.isEnabled) {
      throw new ApiError(
        "The sending mailbox cannot be hidden. Make another mailbox the " +
          "sending one first.",
        400,
      );
    }
    account.isEnabled = changes.isEnabled;
  }

  if (changes.isPrimary === true && !account.isPrimary) {
    account.isPrimary = true;
    account.isEnabled = true;
    account.sortIndex = -1;
    await account.save();
    await GmailAccount.updateMany(
      { userId, _id: { $ne: account._id } },
      { $set: { isPrimary: false } },
    );
    await exports.reindex(userId);
    const updated = await GmailAccount.findById(account._id);
    events.accountUpdated(updated);
    return updated;
  }

  await account.save();
  const updated = await GmailAccount.findById(account._id);
  events.accountUpdated(updated);
  return updated;
};

exports.setPrimary = (userId, accountId) =>
  exports.updateAccount(userId, accountId, { isPrimary: true });

/**
 * Signs a mailbox out without forgetting it.
 *
 * The grant is revoked at Google, the sealed refresh token is dropped and the
 * watch is stopped, but the row and its synced mail stay — so signing back in
 * is one step and the user does not lose their mailbox view. Deleting the
 * mail here would be a surprise: "sign out" is not "forget everything".
 */
exports.signOutAccount = async (userId, accountId) => {
  const account = await GmailAccount.findOne({
    _id: accountId,
    userId,
  }).select("+refreshToken");
  if (!account) throw new ApiError("Gmail account not found", 404);

  // Best effort, and in this order: tell Gmail to stop publishing before the
  // credential that authorizes the call is thrown away.
  await exports.stopWatchQuietly(account);

  if (account.refreshToken) {
    try {
      await googleOAuth.revokeToken(secretBox.open(account.refreshToken));
    } catch (error) {
      // A token we cannot open or Google will not revoke is still a token we
      // are about to delete. Nothing is gained by refusing the sign-out.
      console.warn(
        `[gmail] could not revoke the grant for ${account.email}: ${error.message}`,
      );
    }
  }

  account.refreshToken = null;
  account.needsReauth = true;
  account.signedOutAt = new Date();
  account.watch.active = false;
  account.syncState.status = "paused";
  account.syncState.nextSyncAt = null;
  await account.save();
  tokenService.forget(account._id);

  await audit.record({
    accountId: account._id,
    userId,
    operation: "account.signedOut",
    actor: audit.userActor(userId),
  });

  const fresh = await GmailAccount.findById(account._id);
  events.accountSignedOut(fresh);
  return fresh;
};

/**
 * Forgets a mailbox and everything synced from it.
 *
 * Nothing is deleted from Gmail: the mail stays in the user's mailbox, and
 * only this backend's copy goes. The operation log is kept deliberately —
 * it records what this system did, and deleting the audit trail along with
 * the account would defeat the point of having one.
 */
exports.removeAccount = async (userId, accountId) => {
  const account = await GmailAccount.findOne({
    _id: accountId,
    userId,
  }).select("+refreshToken");
  if (!account) throw new ApiError("Gmail account not found", 404);

  await exports.stopWatchQuietly(account);

  if (account.refreshToken) {
    try {
      await googleOAuth.revokeToken(secretBox.open(account.refreshToken));
    } catch (error) {
      console.warn(
        `[gmail] could not revoke the grant for ${account.email}: ${error.message}`,
      );
    }
  }

  const scope = { accountId: account._id };
  const [messages, threads, labels, drafts] = await Promise.all([
    GmailMessage.deleteMany(scope),
    GmailThread.deleteMany(scope),
    GmailLabel.deleteMany(scope),
    GmailDraft.deleteMany(scope),
  ]);

  await GmailAccount.deleteOne({ _id: account._id, userId });
  tokenService.forget(account._id);

  await exports.ensureOnePrimary(userId);
  await exports.reindex(userId);

  await audit.record({
    accountId: account._id,
    userId,
    operation: "account.disconnected",
    actor: audit.userActor(userId),
    result: { affected: messages.deletedCount || 0 },
  });
  events.accountDisconnected({
    userId,
    accountId: account._id,
    email: account.email,
  });

  return {
    id: String(account._id),
    email: account.email,
    deleted: {
      messages: messages.deletedCount || 0,
      threads: threads.deletedCount || 0,
      labels: labels.deletedCount || 0,
      drafts: drafts.deletedCount || 0,
    },
  };
};

/**
 * Tells Gmail to stop publishing a mailbox's changes, ignoring failures.
 *
 * Used on the way out of sign-out and delete, where the account is going away
 * whatever Gmail says. Defined here rather than in the watch service to keep
 * the dependency one-way: the watch service needs accounts, not the reverse.
 */
exports.stopWatchQuietly = async (account) => {
  if (!account.watch?.active) return false;
  try {
    await exports.clientFor(account).stopWatch();
    return true;
  } catch (error) {
    console.warn(
      `[gmail] could not stop the watch on ${account.email}: ${error.message}`,
    );
    return false;
  }
};

/** Makes sure exactly one of the user's mailboxes is the sending one. */
exports.ensureOnePrimary = async (userId) => {
  const primaries = await GmailAccount.find({ userId, isPrimary: true }).sort({
    sortIndex: 1,
  });

  if (primaries.length === 1) {
    if (!primaries[0].isEnabled) {
      primaries[0].isEnabled = true;
      await primaries[0].save();
    }
    return primaries[0];
  }

  if (primaries.length > 1) {
    const keep = primaries[0];
    await GmailAccount.updateMany(
      { userId, _id: { $ne: keep._id } },
      { $set: { isPrimary: false } },
    );
    return keep;
  }

  const first = await GmailAccount.findOne({ userId }).sort({ sortIndex: 1 });
  if (!first) return null;
  first.isPrimary = true;
  first.isEnabled = true;
  await first.save();
  return first;
};

/** Keeps `sortIndex` dense, so an arranged order survives a deletion. */
exports.reindex = async (userId) => {
  const accounts = await GmailAccount.find({ userId })
    .sort({ isPrimary: -1, sortIndex: 1, email: 1 })
    .select("sortIndex");

  await Promise.all(
    accounts.map((account, index) =>
      account.sortIndex === index
        ? Promise.resolve()
        : GmailAccount.updateOne(
            { _id: account._id },
            { $set: { sortIndex: index } },
          ),
    ),
  );
  return accounts.length;
};

exports.SORT_FIELDS = SORT_FIELDS;
exports.buildQuery = buildQuery;
