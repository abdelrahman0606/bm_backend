const express = require("express");

const router = express.Router();
const googleAccountService = require("./googleAccountService");
const {
  validateStartConsent,
  validateStartPicker,
  validateCompleteConsent,
  validateIssueToken,
  validateAccountId,
  validateUpdateAccount,
  validateListAccounts,
} = require("./googleAccountValidator");
const {
  validatorMiddleware,
} = require("../../middlewares/validatorMiddleware");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");

// Every route here acts on the signed-in user's own accounts, so the token
// is required before anything else runs. `req.userId` is the only source of
// the owner; it is never taken from the body or the query.
router.use(verifyAuthToken);

/**
 * Starts a Google consent flow.
 *
 * POST /api/v1/auth/google/oauth/url
 * Body: { accessLevel, platform?, redirectUri, accountId? }
 *
 * The client opens the returned `url` and keeps the `state`. For a desktop
 * app, `redirectUri` is the loopback address the app is listening on.
 */
router.post(
  "/oauth/url",
  validateStartConsent,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const result = await googleAccountService.startConsent(req.userId, {
        accessLevel: req.body.accessLevel,
        platform: req.body.platform || "web",
        redirectUri: req.body.redirectUri,
        accountId: req.body.accountId,
      });
      res.status(200).json({
        success: true,
        data: result,
        message: "Consent URL created",
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Starts the desktop Google Picker.
 *
 * POST /api/v1/auth/google/picker/url
 * Body: { redirectUri, platform?, accountId?, allowMultiple?,
 *         allowFolderSelection?, mimeTypes? }
 *
 * The client opens the returned `url`; Google shows the picker in the system
 * browser and redirects back with `picked_file_ids` alongside `code`. The
 * code then goes to /oauth/exchange exactly as a normal connection would.
 */
router.post(
  "/picker/url",
  validateStartPicker,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const result = await googleAccountService.startPicker(req.userId, {
        platform: req.body.platform || "web",
        redirectUri: req.body.redirectUri,
        accountId: req.body.accountId,
        allowMultiple: req.body.allowMultiple,
        allowFolderSelection: req.body.allowFolderSelection,
        mimeTypes: req.body.mimeTypes,
      });
      res.status(200).json({
        success: true,
        data: result,
        message: "Picker URL created",
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Finishes a consent flow and saves the account.
 *
 * POST /api/v1/auth/google/oauth/exchange
 * Body: { state, code }
 *
 * Returns the saved account and a short-lived access token. The refresh
 * token stays on the server.
 */
router.post(
  "/oauth/exchange",
  validateCompleteConsent,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const result = await googleAccountService.completeConsent(req.userId, {
        state: req.body.state,
        code: req.body.code,
      });
      res.status(200).json({
        success: true,
        data: result,
        message: "Google account connected",
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Hands out a fresh access token for one account.
 *
 * POST /api/v1/auth/google/oauth/refresh/:id
 * Body: { platform? }
 */
router.post(
  "/oauth/refresh/:id",
  validateIssueToken,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const result = await googleAccountService.issueAccessToken(
        req.userId,
        req.params.id,
        req.body.platform,
      );
      res.status(200).json({
        success: true,
        data: result,
        message: "Access token issued",
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Revokes the grant and signs the account out, keeping the row.
 *
 * POST /api/v1/auth/google/oauth/revoke/:id
 */
router.post(
  "/oauth/revoke/:id",
  validateAccountId,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const account = await googleAccountService.signOutAccount(
        req.userId,
        req.params.id,
      );
      res.status(200).json({
        success: true,
        data: account,
        message: "Account signed out",
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * This user's connected accounts, paginated.
 *
 * GET /api/v1/auth/google/accounts
 *   ?page=0&limit=15&search=&status=&sortBy=&descending=
 *   &accessLevel=full&provider=google
 */
router.get(
  "/accounts",
  validateListAccounts,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const result = await googleAccountService.listAccounts(req.userId, {
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search,
        status: req.query.status,
        sortBy: req.query.sortBy,
        descending: req.query.descending,
        accessLevel: req.query.accessLevel,
        provider: req.query.provider,
      });
      res.status(200).json({
        success: true,
        data: result.accounts,
        meta: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          hasMore: result.hasMore,
        },
        message: "Accounts fetched successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/v1/auth/google/accounts/:id */
router.get(
  "/accounts/:id",
  validateAccountId,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const account = await googleAccountService.getAccount(
        req.userId,
        req.params.id,
      );
      res.status(200).json({
        success: true,
        data: account,
        message: "Account fetched successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Updates the editable fields.
 *
 * PATCH /api/v1/auth/google/accounts/:id
 * Body: { displayName?, isEnabled?, isPrimary?, rootFolderId? }
 */
router.patch(
  "/accounts/:id",
  validateUpdateAccount,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const account = await googleAccountService.updateAccount(
        req.userId,
        req.params.id,
        {
          displayName: req.body.displayName,
          isEnabled: req.body.isEnabled,
          isPrimary: req.body.isPrimary,
          rootFolderId: req.body.rootFolderId,
        },
      );
      res.status(200).json({
        success: true,
        data: account,
        message: "Account updated successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Forgets the account and revokes its grant.
 *
 * DELETE /api/v1/auth/google/accounts/:id
 * Nothing is deleted from Google Drive.
 */
router.delete(
  "/accounts/:id",
  validateAccountId,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const removed = await googleAccountService.removeAccount(
        req.userId,
        req.params.id,
      );
      res.status(200).json({
        success: true,
        data: removed,
        message: "Account removed successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
