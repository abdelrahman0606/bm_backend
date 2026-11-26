const { body, param, query } = require("express-validator");
const { ACCESS_LEVELS } = require("./gmailScopes");
const { OPERATIONS, STATUSES } = require("./gmailOperationLogModel");

/**
 * Request validation for the Gmail API.
 *
 * What is checked here and what is not, on purpose:
 *
 * **Here:** shapes. Is `accountId` an id at all, is `to` a list of addresses,
 * is `limit` a number in range, is `accessLevel` one of the three. These
 * produce a 422 naming the field, which is what a client can act on.
 *
 * **Not here:** ownership and permission. Whether *this* account belongs to
 * *this* user is a database question, answered by
 * `gmailAccountService.requireAccount`, and whether the grant allows the
 * operation is answered by `gmailScopes.assertCan`. Both happen in the
 * service, where every path reaches them — a check in a validator protects
 * only the routes somebody remembered to attach it to.
 *
 * Two rejections are deliberate rather than permissive, because silently
 * ignoring them would leave a caller believing something took effect:
 * `accessLevel` on an account update (it is the OAuth scope, so it needs a
 * new consent flow), and `userId` anywhere in a body (the owner comes from
 * the verified token and nothing else).
 */

const SORT_FIELDS = [
  "primaryFirst",
  "email",
  "name",
  "lastUsed",
  "created",
  "lastSync",
];

const ACCOUNT_STATUSES = [
  "any",
  "connected",
  "needsLogin",
  "hidden",
  "syncFailed",
];

const PLATFORMS = [
  "web",
  "windows",
  "macos",
  "linux",
  "desktop",
  "android",
  "ios",
];

const LABEL_VISIBILITY = ["labelShow", "labelShowIfUnread", "labelHide"];
const MESSAGE_VISIBILITY = ["show", "hide"];

/** An address, as a string or as `{name, email}`. */
const isAddress = (value) => {
  const email = typeof value === "string" ? value : value?.email || null;
  if (!email) return false;
  // Deliberately loose: the strict check is in the send service, against the
  // assembled recipient list, so one rule governs every send path.
  return /@/.test(String(email));
};

const isAddressList = (value) => {
  if (value === undefined || value === null || value === "") return true;
  const list = Array.isArray(value) ? value : [value];
  return list.every(isAddress);
};

/** Gmail ids are opaque; the only real rule is "short and not a path". */
const isGmailId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

const gmailIdList = (value) => {
  const list = Array.isArray(value) ? value : [value];
  return list.length > 0 && list.every(isGmailId);
};

/** Never taken from a request: the owner is the verified token's subject. */
const rejectUserId = body("userId")
  .not()
  .exists()
  .withMessage("userId cannot be set: it comes from the signed-in user");

// ── Accounts ────────────────────────────────────────────────────────────────

const validateStartConsent = [
  body("accessLevel")
    .optional()
    .isIn(ACCESS_LEVELS)
    .withMessage(`accessLevel must be one of: ${ACCESS_LEVELS.join(", ")}`),
  body("platform")
    .optional()
    .isIn(PLATFORMS)
    .withMessage(`platform must be one of: ${PLATFORMS.join(", ")}`),
  body("redirectUri")
    .notEmpty()
    .withMessage("redirectUri is required")
    .isURL({ require_tld: false, protocols: ["http", "https"] })
    .withMessage("redirectUri must be a valid http(s) URL"),
  body("accountId")
    .optional()
    .isMongoId()
    .withMessage("accountId must be a valid id"),
  rejectUserId,
];

const validateCompleteConsent = [
  body("state").notEmpty().withMessage("state is required").isString(),
  body("code").notEmpty().withMessage("code is required").isString(),
  rejectUserId,
];

const validateListAccounts = [
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
  query("status")
    .optional()
    .isIn(ACCOUNT_STATUSES)
    .withMessage(`status must be one of: ${ACCOUNT_STATUSES.join(", ")}`),
  query("sortBy")
    .optional()
    .isIn(SORT_FIELDS)
    .withMessage(`sortBy must be one of: ${SORT_FIELDS.join(", ")}`),
  query("descending").optional().isBoolean(),
  query("accessLevel")
    .optional()
    .custom((value) =>
      (Array.isArray(value) ? value : [value]).every((level) =>
        ACCESS_LEVELS.includes(level),
      ),
    )
    .withMessage(`accessLevel must be one of: ${ACCESS_LEVELS.join(", ")}`),
];

const validateAccountId = [
  param("id").isMongoId().withMessage("Invalid account id"),
];

/** For the routes that name the mailbox `accountId` rather than `id`. */
const validateAccountIdParam = [
  param("accountId").isMongoId().withMessage("Invalid account id"),
];

const validateUpdateAccount = [
  param("id").isMongoId().withMessage("Invalid account id"),
  body("displayName").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("sendAsName").optional().isString().trim().isLength({ max: 120 }),
  body("signature").optional().isString().isLength({ max: 10000 }),
  body("isEnabled").optional().isBoolean().toBoolean(),
  body("isPrimary").optional().isBoolean().toBoolean(),
  // The permission level is the OAuth scope, so it cannot be edited. Saying
  // so beats ignoring it and leaving the caller thinking the mailbox gained
  // access it never got.
  body("accessLevel")
    .not()
    .exists()
    .withMessage(
      "accessLevel cannot be edited. Connect the mailbox again with the " +
        "level you want instead.",
    ),
  rejectUserId,
];

const validateSyncRequest = [
  param("id").isMongoId().withMessage("Invalid account id"),
  body("mode")
    .optional()
    .isIn(["auto", "full", "incremental"])
    .withMessage("mode must be auto, full or incremental"),
];

// ── Reading ─────────────────────────────────────────────────────────────────

const validateListMessages = [
  query("accountId")
    .optional()
    .custom((value) =>
      (Array.isArray(value) ? value : [value]).every((id) =>
        /^[0-9a-fA-F]{24}$/.test(String(id)),
      ),
    )
    .withMessage("accountId must be a valid id"),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("labelIds").optional(),
  query("threadId").optional().isString(),
  query("from").optional().isString().trim(),
  query("to").optional().isString().trim(),
  query("subject").optional().isString().trim(),
  query("search").optional().isString().trim(),
  // Gmail's own query language, passed through untouched. Length-capped
  // only: validating it here would mean reimplementing it.
  query("q").optional().isString().isLength({ max: 2048 }),
  query("pageToken").optional().isString(),
  query("isUnread").optional().isBoolean().toBoolean(),
  query("isStarred").optional().isBoolean().toBoolean(),
  query("hasAttachments").optional().isBoolean().toBoolean(),
  query("includeTrash").optional().isBoolean().toBoolean(),
  query("includeSpam").optional().isBoolean().toBoolean(),
  query("after").optional().isISO8601().withMessage("after must be a date"),
  query("before").optional().isISO8601().withMessage("before must be a date"),
  query("descending").optional().isBoolean(),
];

const validateMessageRef = [
  param("accountId").isMongoId().withMessage("Invalid account id"),
  param("gmailId").custom(isGmailId).withMessage("Invalid message id"),
];

const validateAttachmentRef = [
  ...validateMessageRef,
  param("attachmentId")
    .isString()
    .isLength({ min: 1, max: 2048 })
    .withMessage("Invalid attachment id"),
];

const validateThreadRef = [
  param("accountId").isMongoId().withMessage("Invalid account id"),
  param("threadId").custom(isGmailId).withMessage("Invalid thread id"),
];

// ── Sending ─────────────────────────────────────────────────────────────────

/** Shared by send, reply, reply-all and forward. */
const compositionRules = [
  body("accountId").optional().isMongoId().withMessage("Invalid account id"),
  body("to").optional().custom(isAddressList).withMessage("to must be addresses"),
  body("cc").optional().custom(isAddressList).withMessage("cc must be addresses"),
  body("bcc")
    .optional()
    .custom(isAddressList)
    .withMessage("bcc must be addresses"),
  body("subject").optional().isString().isLength({ max: 998 }),
  body("text").optional().isString(),
  body("html").optional().isString(),
  body("useSignature").optional().isBoolean().toBoolean(),
  // Opaque to the server and unique to the caller. The unique index enforces
  // it; this only keeps it a sane size.
  body("idempotencyKey")
    .optional()
    .isString()
    .isLength({ min: 8, max: 128 })
    .withMessage("idempotencyKey must be 8 to 128 characters"),
  rejectUserId,
];

const validateSend = [
  ...compositionRules,
  body("to")
    .exists()
    .withMessage("to is required")
    .custom((value) => (Array.isArray(value) ? value.length > 0 : isAddress(value)))
    .withMessage("to must name at least one recipient"),
];

const validateReply = [
  ...compositionRules,
  body("gmailId")
    .custom(isGmailId)
    .withMessage("gmailId must name the message being replied to"),
  body("quoteOriginal").optional().isBoolean().toBoolean(),
];

const validateForward = [
  ...compositionRules,
  body("gmailId")
    .custom(isGmailId)
    .withMessage("gmailId must name the message being forwarded"),
  body("to")
    .exists()
    .withMessage("to is required")
    .custom((value) => (Array.isArray(value) ? value.length > 0 : isAddress(value)))
    .withMessage("to must name at least one recipient"),
  body("includeAttachments").optional().isBoolean().toBoolean(),
];

const validateDraft = [
  ...compositionRules,
  body("replyToGmailId").optional().custom(isGmailId),
];

const validateDraftRef = [
  param("draftId")
    .isString()
    .isLength({ min: 1, max: 128 })
    .withMessage("Invalid draft id"),
];

const validateListDrafts = [
  query("accountId").optional().isMongoId(),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
];

// ── Organizing ──────────────────────────────────────────────────────────────

/** The message-selection shape every organize endpoint takes. */
const validateMessageSelection = [
  body("accountId").isMongoId().withMessage("accountId is required"),
  body("gmailIds")
    .exists()
    .withMessage("gmailIds is required")
    .custom(gmailIdList)
    .withMessage("gmailIds must be one or more message ids"),
  rejectUserId,
];

const validateModifyLabels = [
  ...validateMessageSelection,
  body("addLabelIds").optional().isArray(),
  body("removeLabelIds").optional().isArray(),
];

const validateDeleteForever = [
  ...validateMessageSelection,
  // An irreversible operation is not reachable by a typo'd route.
  body("confirmPermanent")
    .equals("true")
    .withMessage(
      "Permanent deletion needs confirmPermanent: true. It cannot be undone.",
    )
    .customSanitizer(() => true),
];

const validateThreadLabels = [
  ...validateThreadRef,
  body("addLabelIds").optional().isArray(),
  body("removeLabelIds").optional().isArray(),
];

const validateCreateLabel = [
  param("accountId").isMongoId().withMessage("Invalid account id"),
  body("name")
    .notEmpty()
    .withMessage("A label needs a name")
    .isString()
    .trim()
    .isLength({ min: 1, max: 225 }),
  body("labelListVisibility").optional().isIn(LABEL_VISIBILITY),
  body("messageListVisibility").optional().isIn(MESSAGE_VISIBILITY),
  rejectUserId,
];

const validateLabelRef = [
  param("accountId").isMongoId().withMessage("Invalid account id"),
  param("labelId").isString().isLength({ min: 1, max: 128 }),
];

const validateUpdateLabel = [
  ...validateLabelRef,
  body("name").optional().isString().trim().isLength({ min: 1, max: 225 }),
  body("labelListVisibility").optional().isIn(LABEL_VISIBILITY),
  body("messageListVisibility").optional().isIn(MESSAGE_VISIBILITY),
];

// ── Contacts and history ────────────────────────────────────────────────────

const validateContacts = [
  query("accountId").optional(),
  query("search").optional().isString().trim().isLength({ max: 200 }),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 200 }),
];

const validateSuggest = [
  query("accountId").optional(),
  query("query").optional().isString().trim().isLength({ max: 200 }),
  query("limit").optional().isInt({ min: 1, max: 25 }),
];

const validateOperations = [
  query("accountId").optional().isMongoId(),
  query("operation")
    .optional()
    .custom((value) =>
      (Array.isArray(value) ? value : [value]).every((operation) =>
        OPERATIONS.includes(operation),
      ),
    )
    .withMessage("operation is not one this feature records"),
  query("status")
    .optional()
    .custom((value) =>
      (Array.isArray(value) ? value : [value]).every((status) =>
        STATUSES.includes(status),
      ),
    )
    .withMessage(`status must be one of: ${STATUSES.join(", ")}`),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
];

module.exports = {
  SORT_FIELDS,
  ACCOUNT_STATUSES,
  PLATFORMS,
  isAddress,
  isAddressList,
  isGmailId,
  validateStartConsent,
  validateCompleteConsent,
  validateListAccounts,
  validateAccountId,
  validateAccountIdParam,
  validateUpdateAccount,
  validateSyncRequest,
  validateListMessages,
  validateMessageRef,
  validateAttachmentRef,
  validateThreadRef,
  validateSend,
  validateReply,
  validateForward,
  validateDraft,
  validateDraftRef,
  validateListDrafts,
  validateMessageSelection,
  validateModifyLabels,
  validateDeleteForever,
  validateThreadLabels,
  validateCreateLabel,
  validateLabelRef,
  validateUpdateLabel,
  validateContacts,
  validateSuggest,
  validateOperations,
};
