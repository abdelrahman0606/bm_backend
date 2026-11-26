const ApiError = require("../../utils/apiError");
const { GoogleAccount } = require("./googleAccountModel");
const { GoogleOAuthRequest } = require("./googleOAuthRequestModel");
const googleOAuth = require("./googleOAuthService");

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 100;

/** Sort orders the accounts list offers, mirroring the app's own list. */
const SORT_FIELDS = {
  primaryFirst: { isPrimary: -1, sortIndex: 1, email: 1 },
  email: { email: 1 },
  name: { displayName: 1, email: 1 },
  lastUsed: { lastUsedAt: 1, email: 1 },
  created: { createdAt: 1, email: 1 },
  accessLevel: { accessLevel: 1, email: 1 },
};

const flipDirection = (sort) =>
  Object.keys(sort).reduce((flipped, key) => {
    const next = flipped;
    next[key] = sort[key] === 1 ? -1 : 1;
    return next;
  }, {});

/** Escapes a search term so it cannot act as a regular expression. */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toArray = (value) => {
  if (value === undefined || value === null || value === "") return [];
  return Array.isArray(value) ? value : [value];
};

/**
 * Builds the Mongo filter for the accounts list.
 *
 * `status` is derived rather than stored: an account is connected when it
 * still has a usable grant, which is the inverse of `needsReauth`.
 */
const buildQuery = (userId, { search, status, accessLevel, provider } = {}) => {
  const query = { userId };

  const keyword = (search || "").trim();
  if (keyword) {
    const pattern = new RegExp(escapeRegex(keyword), "i");
    query.$or = [{ email: pattern }, { displayName: pattern }];
  }

  const levels = toArray(accessLevel);
  if (levels.length) query.accessLevel = { $in: levels };

  const providers = toArray(provider);
  if (providers.length) query.provider = { $in: providers };

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
    default:
      break;
  }

  return query;
};

/**
 * One page of the user's accounts.
 *
 * Returns the page plus the total so a client can show "x of y" and know
 * whether another page exists without asking again.
 */
exports.listAccounts = async (userId, options = {}) => {
  const page = Math.max(0, Number(options.page) || 0);
  const requested = Number(options.limit) || DEFAULT_PAGE_SIZE;
  const limit = Math.min(Math.max(1, requested), MAX_PAGE_SIZE);

  const query = buildQuery(userId, options);
  const base = SORT_FIELDS[options.sortBy] || SORT_FIELDS.primaryFirst;
  const sort = String(options.descending) === "true" ? flipDirection(base) : base;

  const [accounts, total] = await Promise.all([
    GoogleAccount.find(query)
      .sort(sort)
      .skip(page * limit)
      .limit(limit)
      .exec(),
    GoogleAccount.countDocuments(query),
  ]);

  return {
    accounts,
    total,
    page,
    limit,
    hasMore: (page + 1) * limit < total,
  };
};

exports.getAccount = async (userId, accountId) => {
  const account = await GoogleAccount.findOne({ _id: accountId, userId });
  if (!account) throw new ApiError("Account not found", 404);
  return account;
};

/**
 * Starts a consent flow for this user.
 *
 * Passing an [accountId] re-authorises that account: its email becomes the
 * login hint so Google offers the right one first.
 */
exports.startConsent = async (
  userId,
  { accessLevel, platform, redirectUri, accountId },
) => {
  let loginHint = null;
  if (accountId) {
    const account = await exports.getAccount(userId, accountId);
    loginHint = account.email;
  }

  return googleOAuth.startConsent({
    accessLevel,
    platform,
    redirectUri,
    loginHint,
    userId,
    accountId: accountId || null,
    store: GoogleOAuthRequest,
  });
};

/**
 * Starts the desktop Google Picker.
 *
 * Google runs the picker in the system browser as part of consent and appends
 * the chosen file ids to the redirect, so this needs no page or API key of
 * our own. The scope is `drive.file`, which is non-sensitive — this is how
 * the user reaches files that already exist in their Drive while the app is
 * still unverified.
 */
exports.startPicker = async (
  userId,
  { platform, redirectUri, accountId, allowMultiple, allowFolderSelection, mimeTypes },
) => {
  if (accountId) {
    // Proves the account belongs to this user before its id is recorded.
    await exports.getAccount(userId, accountId);
  }

  return googleOAuth.startPickerConsent({
    platform,
    redirectUri,
    userId,
    accountId: accountId || null,
    allowMultiple,
    allowFolderSelection,
    mimeTypes,
    store: GoogleOAuthRequest,
  });
};

/**
 * Finishes a consent flow: trades the code for tokens and saves the account.
 *
 * The flow is looked up by its own `state`, which also proves it belongs to
 * this user — a code paired with someone else's state is refused rather than
 * silently attached to the caller.
 */
exports.completeConsent = async (userId, { state, code }) => {
  const request = await GoogleOAuthRequest.findOne({ state }).select(
    "+codeVerifier",
  );

  if (!request) {
    throw new ApiError("This sign-in request expired. Start again.", 400);
  }
  // A state issued by the public login endpoint must not be spendable here:
  // that one is obtainable without being signed in, and connecting an
  // account is not what the user consented to.
  if (request.purpose !== "drive") {
    throw new ApiError("This sign-in request is not for connecting an account", 400);
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

  if (!tokens.accessToken) {
    throw new ApiError("Google did not return an access token", 502);
  }

  const identity = await googleOAuth.emailFromIdToken(
    tokens.idToken,
    request.platform,
  );
  const profile = await googleOAuth.fetchDriveProfile(tokens.accessToken);

  const email = (identity?.email || profile.email || "").toLowerCase();
  if (!email) {
    throw new ApiError("Google did not return the account email", 502);
  }

  // Trust the granted scopes, not what was asked for: a user can untick a
  // permission on the consent screen.
  const grantedScopes = tokens.scopes.length ? tokens.scopes : request.scopes;
  const accessLevel = googleOAuth.levelFromScopes(grantedScopes);

  const account = await exports.saveConnectedAccount(userId, {
    email,
    displayName: profile.displayName || identity?.displayName || email,
    photoUrl: profile.photoUrl || identity?.photoUrl || null,
    externalId: profile.externalId,
    refreshToken: tokens.refreshToken,
    scopes: grantedScopes,
    accessLevel,
    quotaTotal: profile.quotaTotal,
    quotaUsed: profile.quotaUsed,
    quotaTrashed: profile.quotaTrashed,
  });

  return {
    account,
    // The client gets the short-lived token only; the refresh token stays here.
    accessToken: tokens.accessToken,
    tokenType: tokens.tokenType,
    expiresAt: tokens.expiresAt,
    expiresIn: tokens.expiresIn,
    accessLevel,
    scopes: grantedScopes,
  };
};

/**
 * Creates or updates the row for a freshly authorised account.
 *
 * Signing the same account in again keeps its place in the list, its primary
 * flag and its visibility; only the grant and the profile are replaced. A
 * missing refresh token leaves the stored one alone, because Google omits it
 * when the user had already consented.
 */
exports.saveConnectedAccount = async (userId, details) => {
  const existing = await GoogleAccount.findOne({
    userId,
    provider: "google",
    email: details.email,
  }).select("+refreshToken");

  if (existing) {
    existing.displayName = details.displayName || existing.displayName;
    existing.photoUrl = details.photoUrl ?? existing.photoUrl;
    existing.externalId = details.externalId ?? existing.externalId;
    if (details.refreshToken) existing.refreshToken = details.refreshToken;
    existing.scopes = details.scopes;
    existing.accessLevel = details.accessLevel;
    existing.quotaTotal = details.quotaTotal ?? existing.quotaTotal;
    existing.quotaUsed = details.quotaUsed ?? existing.quotaUsed;
    existing.quotaTrashed = details.quotaTrashed ?? existing.quotaTrashed;
    existing.needsReauth = false;
    existing.lastError = null;
    existing.isEnabled = true;
    existing.lastUsedAt = new Date();
    await existing.save();
    await exports.ensureOnePrimary(userId);
    return GoogleAccount.findById(existing._id);
  }

  const count = await GoogleAccount.countDocuments({ userId });
  const highest = await GoogleAccount.findOne({ userId })
    .sort({ sortIndex: -1 })
    .select("sortIndex");

  const created = await GoogleAccount.create({
    userId,
    provider: "google",
    email: details.email,
    displayName: details.displayName || details.email,
    photoUrl: details.photoUrl || null,
    externalId: details.externalId || null,
    refreshToken: details.refreshToken || null,
    scopes: details.scopes,
    accessLevel: details.accessLevel,
    // The first account has to be primary, otherwise uploads have nowhere
    // to go.
    isPrimary: count === 0,
    isEnabled: true,
    sortIndex: highest ? highest.sortIndex + 1 : 0,
    quotaTotal: details.quotaTotal,
    quotaUsed: details.quotaUsed,
    quotaTrashed: details.quotaTrashed,
    needsReauth: !details.refreshToken,
    lastUsedAt: new Date(),
  });

  await exports.ensureOnePrimary(userId);
  return GoogleAccount.findById(created._id);
};

/**
 * Hands out a fresh access token for an account.
 *
 * This is the endpoint that replaces the client holding a client secret: the
 * refresh token never leaves the server, and a grant Google has stopped
 * accepting marks the account for re-login rather than failing silently.
 */
exports.issueAccessToken = async (userId, accountId, platform) => {
  const account = await GoogleAccount.findOne({
    _id: accountId,
    userId,
  }).select("+refreshToken");

  if (!account) throw new ApiError("Account not found", 404);
  if (!account.refreshToken) {
    throw new ApiError(
      `${account.email} is signed out. Sign in again to use it.`,
      401,
    );
  }

  try {
    const tokens = await googleOAuth.refreshAccessToken({
      refreshToken: account.refreshToken,
      platform: platform || "web",
    });

    account.needsReauth = false;
    account.lastError = null;
    account.lastUsedAt = new Date();
    if (tokens.scopes.length) {
      account.scopes = tokens.scopes;
      account.accessLevel = googleOAuth.levelFromScopes(tokens.scopes);
    }
    await account.save();

    return {
      accountId: String(account._id),
      email: account.email,
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      expiresAt: tokens.expiresAt,
      expiresIn: tokens.expiresIn,
      accessLevel: account.accessLevel,
      scopes: account.scopes,
    };
  } catch (error) {
    account.needsReauth = true;
    account.lastError = error.message;
    await account.save();
    throw error;
  }
};

/**
 * Signs an account out without forgetting it: the grant is revoked and the
 * refresh token dropped, but the row, its permission level and its place in
 * the list stay, so logging back in is one step.
 */
exports.signOutAccount = async (userId, accountId) => {
  const account = await GoogleAccount.findOne({
    _id: accountId,
    userId,
  }).select("+refreshToken");
  if (!account) throw new ApiError("Account not found", 404);

  await googleOAuth.revokeToken(account.refreshToken);

  account.refreshToken = null;
  account.needsReauth = true;
  account.lastError = null;
  await account.save();

  return GoogleAccount.findById(account._id);
};

/** Forgets an account. Nothing is deleted from Google Drive. */
exports.removeAccount = async (userId, accountId) => {
  const account = await GoogleAccount.findOne({
    _id: accountId,
    userId,
  }).select("+refreshToken");
  if (!account) throw new ApiError("Account not found", 404);

  await googleOAuth.revokeToken(account.refreshToken);
  await GoogleAccount.deleteOne({ _id: account._id, userId });

  // Someone has to be primary while any account is left.
  await exports.ensureOnePrimary(userId);
  await exports.reindex(userId);

  return { id: String(account._id), email: account.email };
};

/**
 * Saves the fields a user may edit.
 *
 * The access level is not one of them: it is the OAuth scope, so changing it
 * means asking Google again. A caller that wants a different level starts a
 * new consent flow instead.
 */
exports.updateAccount = async (userId, accountId, changes) => {
  const account = await GoogleAccount.findOne({ _id: accountId, userId });
  if (!account) throw new ApiError("Account not found", 404);

  if (typeof changes.displayName === "string") {
    const trimmed = changes.displayName.trim();
    if (trimmed) account.displayName = trimmed;
  }

  if (typeof changes.rootFolderId === "string") {
    account.rootFolderId = changes.rootFolderId.trim() || null;
  } else if (changes.rootFolderId === null) {
    account.rootFolderId = null;
  }

  if (typeof changes.isEnabled === "boolean") {
    if (account.isPrimary && !changes.isEnabled) {
      throw new ApiError(
        "The upload account cannot be hidden. Make another account the " +
          "upload account first.",
        400,
      );
    }
    account.isEnabled = changes.isEnabled;
  }

  if (changes.isPrimary === true && !account.isPrimary) {
    // The upload account is always visible, or uploads would land somewhere
    // the user cannot see.
    account.isPrimary = true;
    account.isEnabled = true;
    account.sortIndex = -1;
    await account.save();
    await GoogleAccount.updateMany(
      { userId, _id: { $ne: account._id } },
      { $set: { isPrimary: false } },
    );
    await exports.reindex(userId);
    return GoogleAccount.findById(account._id);
  }

  await account.save();
  return GoogleAccount.findById(account._id);
};

exports.setPrimary = async (userId, accountId) =>
  exports.updateAccount(userId, accountId, { isPrimary: true });

/**
 * Makes sure exactly one of the user's accounts is primary.
 *
 * Called after anything that can disturb it — a delete, a new account, a
 * re-login — because every other operation assumes it holds.
 */
exports.ensureOnePrimary = async (userId) => {
  const primaries = await GoogleAccount.find({ userId, isPrimary: true }).sort({
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
    await GoogleAccount.updateMany(
      { userId, _id: { $ne: keep._id } },
      { $set: { isPrimary: false } },
    );
    return keep;
  }

  const first = await GoogleAccount.findOne({ userId }).sort({ sortIndex: 1 });
  if (!first) return null;
  first.isPrimary = true;
  first.isEnabled = true;
  await first.save();
  return first;
};

/** Keeps `sortIndex` dense, so the arranged order survives a deletion. */
exports.reindex = async (userId) => {
  const accounts = await GoogleAccount.find({ userId }).sort({
    isPrimary: -1,
    sortIndex: 1,
    email: 1,
  });

  await Promise.all(
    accounts.map((account, index) =>
      account.sortIndex === index
        ? Promise.resolve()
        : GoogleAccount.updateOne(
            { _id: account._id },
            { $set: { sortIndex: index } },
          ),
    ),
  );
};

exports.SORT_FIELDS = SORT_FIELDS;
exports.buildQuery = buildQuery;
exports.escapeRegex = escapeRegex;
exports.DEFAULT_PAGE_SIZE = DEFAULT_PAGE_SIZE;
exports.MAX_PAGE_SIZE = MAX_PAGE_SIZE;
