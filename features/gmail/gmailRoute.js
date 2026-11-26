const express = require("express");
const multer = require("multer");
const controller = require("./gmailController");
const validator = require("./gmailValidator");
const {
  validatorMiddleware,
} = require("../../middlewares/validatorMiddleware");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");

const router = express.Router();

/**
 * The Gmail API, for signed-in users.
 *
 * Every route here acts on the caller's own mailboxes, so the token is
 * required before anything else runs and `req.userId` is the only source of
 * the owner — it is never read from a body or a query. The services check
 * ownership again on the row itself, so a guessed account id gets a 404
 * rather than somebody else's mail.
 *
 * The Pub/Sub push endpoint is deliberately **not** in this file: it
 * authenticates a Google service account rather than a user and must never
 * sit behind the user-token middleware. It lives in `gmailPushRoute` and is
 * mounted separately, the same split Device Control uses for its agent API.
 *
 * Route order matters in two places, and both are arranged rather than
 * lucky: the literal `/messages/...` verbs are declared before
 * `/messages/:accountId/:gmailId`, and `/contacts/suggest` before any
 * `/contacts/:something`. Express matches in order, so a parameterized route
 * declared first would swallow them.
 */

/**
 * Attachments arrive in memory because they are forwarded straight to Gmail
 * and never stored. 25MB is Gmail's own per-message ceiling; a larger upload
 * would be accepted here only to be refused there.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 20,
  },
});

router.use(verifyAuthToken);

// ──────────────────────────────── Accounts ─────────────────────────────────

router.post(
  "/accounts/oauth/url",
  validator.validateStartConsent,
  validatorMiddleware,
  controller.startConsent,
);

router.post(
  "/accounts/oauth/exchange",
  validator.validateCompleteConsent,
  validatorMiddleware,
  controller.completeConsent,
);

router.get(
  "/accounts",
  validator.validateListAccounts,
  validatorMiddleware,
  controller.listAccounts,
);

router.get(
  "/accounts/:id",
  validator.validateAccountId,
  validatorMiddleware,
  controller.getAccount,
);

router.patch(
  "/accounts/:id",
  validator.validateUpdateAccount,
  validatorMiddleware,
  controller.updateAccount,
);

router.delete(
  "/accounts/:id",
  validator.validateAccountId,
  validatorMiddleware,
  controller.removeAccount,
);

router.post(
  "/accounts/:id/signout",
  validator.validateAccountId,
  validatorMiddleware,
  controller.signOutAccount,
);

router.post(
  "/accounts/:id/sync",
  validator.validateSyncRequest,
  validatorMiddleware,
  controller.syncNow,
);

router.post(
  "/accounts/:id/watch",
  validator.validateAccountId,
  validatorMiddleware,
  controller.startWatch,
);

router.delete(
  "/accounts/:id/watch",
  validator.validateAccountId,
  validatorMiddleware,
  controller.stopWatch,
);

// ───────────────────────────────── Sending ─────────────────────────────────
// Declared before the `/messages/:accountId/:gmailId` reads below, so these
// literal paths are not captured as ids.

router.post(
  "/messages/send",
  upload.array("attachments", 20),
  validator.validateSend,
  validatorMiddleware,
  controller.sendMessage,
);

router.post(
  "/messages/reply",
  upload.array("attachments", 20),
  validator.validateReply,
  validatorMiddleware,
  controller.replyToMessage,
);

router.post(
  "/messages/reply-all",
  upload.array("attachments", 20),
  validator.validateReply,
  validatorMiddleware,
  controller.replyAllToMessage,
);

router.post(
  "/messages/forward",
  upload.array("attachments", 20),
  validator.validateForward,
  validatorMiddleware,
  controller.forwardMessage,
);

// ──────────────────────────────── Organizing ───────────────────────────────

router.post(
  "/messages/modify-labels",
  validator.validateModifyLabels,
  validatorMiddleware,
  controller.modifyLabels,
);

/**
 * The simple verbs. Each takes `{accountId, gmailIds}` and is a named label
 * change; declaring them from one table keeps the route list honest about
 * that rather than hiding ten copies of the same handler.
 */
const simpleVerbs = [
  ["read", controller.markRead],
  ["unread", controller.markUnread],
  ["star", controller.star],
  ["unstar", controller.unstar],
  ["archive", controller.archive],
  ["inbox", controller.moveToInbox],
  ["spam", controller.markSpam],
  ["not-spam", controller.markNotSpam],
  ["trash", controller.trash],
  ["untrash", controller.untrash],
];

simpleVerbs.forEach(([path, handler]) => {
  router.post(
    `/messages/${path}`,
    validator.validateMessageSelection,
    validatorMiddleware,
    handler,
  );
});

/** Irreversible, and gated by `confirmPermanent` as well as by scope. */
router.post(
  "/messages/delete-forever",
  validator.validateDeleteForever,
  validatorMiddleware,
  controller.deleteForever,
);

// ───────────────────────────────── Reading ─────────────────────────────────

router.get(
  "/messages",
  validator.validateListMessages,
  validatorMiddleware,
  controller.listMessages,
);

router.get(
  "/messages/:accountId/:gmailId",
  validator.validateMessageRef,
  validatorMiddleware,
  controller.getMessage,
);

router.get(
  "/messages/:accountId/:gmailId/attachments/:attachmentId",
  validator.validateAttachmentRef,
  validatorMiddleware,
  controller.getAttachment,
);

// ───────────────────────────────── Threads ─────────────────────────────────

router.get(
  "/threads",
  validator.validateListMessages,
  validatorMiddleware,
  controller.listThreads,
);

router.get(
  "/threads/:accountId/:threadId",
  validator.validateThreadRef,
  validatorMiddleware,
  controller.getThread,
);

router.post(
  "/threads/:accountId/:threadId/modify-labels",
  validator.validateThreadLabels,
  validatorMiddleware,
  controller.modifyThreadLabels,
);

router.post(
  "/threads/:accountId/:threadId/trash",
  validator.validateThreadRef,
  validatorMiddleware,
  controller.trashThread,
);

router.delete(
  "/threads/:accountId/:threadId",
  validator.validateThreadRef,
  validatorMiddleware,
  controller.deleteThreadForever,
);

// ────────────────────────────────── Drafts ─────────────────────────────────

router.get(
  "/drafts",
  validator.validateListDrafts,
  validatorMiddleware,
  controller.listDrafts,
);

router.post(
  "/drafts",
  upload.array("attachments", 20),
  validator.validateDraft,
  validatorMiddleware,
  controller.createDraft,
);

router.patch(
  "/drafts/:draftId",
  upload.array("attachments", 20),
  validator.validateDraftRef,
  validatorMiddleware,
  controller.updateDraft,
);

router.post(
  "/drafts/:draftId/send",
  validator.validateDraftRef,
  validatorMiddleware,
  controller.sendDraft,
);

router.delete(
  "/drafts/:draftId",
  validator.validateDraftRef,
  validatorMiddleware,
  controller.deleteDraft,
);

// ────────────────────────────────── Labels ─────────────────────────────────

router.get(
  "/labels/:accountId",
  validator.validateAccountIdParam,
  validatorMiddleware,
  controller.listLabels,
);

router.post(
  "/labels/:accountId",
  validator.validateCreateLabel,
  validatorMiddleware,
  controller.createLabel,
);

router.patch(
  "/labels/:accountId/:labelId",
  validator.validateUpdateLabel,
  validatorMiddleware,
  controller.updateLabel,
);

router.delete(
  "/labels/:accountId/:labelId",
  validator.validateLabelRef,
  validatorMiddleware,
  controller.deleteLabel,
);

// ─────────────────────── Contacts, history, diagnostics ────────────────────
// `/contacts/suggest` first: a parameterized contacts route declared before
// it would capture "suggest" as an id.

router.get(
  "/contacts/suggest",
  validator.validateSuggest,
  validatorMiddleware,
  controller.suggestRecipients,
);

router.get(
  "/contacts/google/:accountId",
  validator.validateAccountIdParam,
  validatorMiddleware,
  controller.listGoogleContacts,
);

router.get(
  "/contacts",
  validator.validateContacts,
  validatorMiddleware,
  controller.listContacts,
);

router.get(
  "/operations",
  validator.validateOperations,
  validatorMiddleware,
  controller.listOperations,
);

router.get("/unread-counts", controller.unreadCounts);

router.get("/health", controller.health);

module.exports = router;
