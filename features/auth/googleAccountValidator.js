const { body, param, query } = require("express-validator");
const { ACCESS_LEVELS, PROVIDERS } = require("./googleAccountModel");

const STATUSES = ["any", "connected", "needsLogin", "hidden"];
const SORT_FIELDS = [
  "primaryFirst",
  "email",
  "name",
  "lastUsed",
  "created",
  "accessLevel",
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

/// Starting a consent flow. `redirectUri` is checked again in the service
/// against the loopback rule or the configured allow list; this only rejects
/// what is obviously malformed so the error is a 422 with a field name.
const validateStartConsent = [
  body("accessLevel")
    .notEmpty()
    .withMessage("accessLevel is required")
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
];

const validateStartPicker = [
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
  body("allowMultiple").optional().isBoolean().toBoolean(),
  body("allowFolderSelection").optional().isBoolean().toBoolean(),
  body("mimeTypes")
    .optional()
    .isArray()
    .withMessage("mimeTypes must be an array of strings"),
  // The Picker flow fixes its own scope, so an access level here would be
  // ignored. Rejecting it beats letting a caller think it took effect.
  body("accessLevel")
    .not()
    .exists()
    .withMessage(
      "accessLevel cannot be set for the picker: it always uses drive.file.",
    ),
];

const validateCompleteConsent = [
  body("state").notEmpty().withMessage("state is required").isString(),
  body("code")
    .notEmpty()
    .withMessage("code is required")
    .isString()
    .withMessage("code must be a string"),
];

const validateIssueToken = [
  param("id").isMongoId().withMessage("Invalid account id"),
  body("platform")
    .optional()
    .isIn(PLATFORMS)
    .withMessage(`platform must be one of: ${PLATFORMS.join(", ")}`),
];

const validateAccountId = [
  param("id").isMongoId().withMessage("Invalid account id"),
];

const validateUpdateAccount = [
  param("id").isMongoId().withMessage("Invalid account id"),
  body("displayName")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage("displayName must be between 1 and 120 characters"),
  body("isEnabled")
    .optional()
    .isBoolean()
    .withMessage("isEnabled must be a boolean")
    .toBoolean(),
  body("isPrimary")
    .optional()
    .isBoolean()
    .withMessage("isPrimary must be a boolean")
    .toBoolean(),
  body("rootFolderId")
    .optional({ nullable: true })
    .isString()
    .withMessage("rootFolderId must be a string or null"),
  // The permission level is the OAuth scope, so it cannot be set here.
  // Rejecting it loudly beats ignoring it and leaving the caller thinking
  // the account gained access it never got.
  body("accessLevel")
    .not()
    .exists()
    .withMessage(
      "accessLevel cannot be edited. Start a new sign-in with the level you " +
        "want instead.",
    ),
];

const validateListAccounts = [
  query("page")
    .optional()
    .isInt({ min: 0 })
    .withMessage("page must be 0 or more"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100"),
  query("search").optional().isString().trim(),
  query("status")
    .optional()
    .isIn(STATUSES)
    .withMessage(`status must be one of: ${STATUSES.join(", ")}`),
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
  query("provider")
    .optional()
    .custom((value) =>
      (Array.isArray(value) ? value : [value]).every((provider) =>
        PROVIDERS.includes(provider),
      ),
    )
    .withMessage(`provider must be one of: ${PROVIDERS.join(", ")}`),
];

module.exports = {
  STATUSES,
  SORT_FIELDS,
  PLATFORMS,
  validateStartConsent,
  validateStartPicker,
  validateCompleteConsent,
  validateIssueToken,
  validateAccountId,
  validateUpdateAccount,
  validateListAccounts,
};
