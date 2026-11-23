const { body, param, query } = require("express-validator");

const {
  DEVICE_PLATFORMS,
  DEVICE_STATUSES,
  CONTROL_KEYS,
  ENFORCEMENT_STATUSES,
  REQUEST_CATEGORIES,
} = require("./deviceControlConstants");

/**
 * Input validation.
 *
 * Deliberately strict about the small set of values that cross the wire as
 * identifiers — platform, status, control key, category — because every one
 * of them is part of the agent contract, and an unrecognised value stored
 * today becomes an enforcement gap the day an agent reads it back.
 *
 * Note what is *not* validated: `companyId`, `employeeId` on a request, or
 * any other ownership claim. Those are never read from the body at all, so
 * there is nothing to validate.
 */

const objectId = (field, location = param) =>
  location(field).isMongoId().withMessage(`${field} must be a valid id`);

const validateDeviceId = [objectId("id")];

const validateCreateDevice = [
  body("employeeId").isMongoId().withMessage("employeeId must be a valid id"),
  body("name").isString().trim().isLength({ min: 1, max: 120 }),
  body("platform").isIn(DEVICE_PLATFORMS),
];

const validateUpdateDevice = [
  objectId("id"),
  body("name").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("employeeId").optional().isMongoId(),
];

const validateDeviceStatus = [
  objectId("id"),
  body("status").isIn(DEVICE_STATUSES),
];

const _applicationSection = [
  body("applicationControl.enabled").optional().isBoolean(),
  body("applicationControl.mode").optional().isIn(["whitelist", "blacklist"]),
  body("applicationControl.rules").optional().isArray({ max: 2000 }),
  body("applicationControl.rules.*.kind").optional().isIn(["path", "publisher", "hash"]),
  body("applicationControl.rules.*.value").optional().isString().trim().notEmpty(),
];

const _websiteSection = [
  body("websiteControl.enabled").optional().isBoolean(),
  body("websiteControl.mode").optional().isIn(["whitelist", "blacklist"]),
  // Chrome caps URLAllowlist at 1000 entries, so a larger list would be
  // silently truncated on the device rather than rejected here.
  body("websiteControl.rules").optional().isArray({ max: 1000 }),
  body("websiteControl.rules.*.domain").optional().isString().trim().notEmpty(),
  body("websiteControl.rules.*.includeSubdomains").optional().isBoolean(),
  body("websiteControl.disableSecureDns").optional().isBoolean(),
];

const _otherSections = [
  body("fileTransferControl.enabled").optional().isBoolean(),
  body("fileTransferControl.blockDownloads").optional().isBoolean(),
  body("fileTransferControl.blockUploads").optional().isBoolean(),
  body("fileTransferControl.domains").optional().isArray({ max: 1000 }),
  body("usbControl.enabled").optional().isBoolean(),
  body("usbControl.blockStorage").optional().isBoolean(),
  body("usbControl.denyRead").optional().isBoolean(),
  body("usbControl.denyWrite").optional().isBoolean(),
  body("usbControl.approvedDeviceIds").optional().isArray({ max: 500 }),
  body("systemRestrictions.enabled").optional().isBoolean(),
  body("systemRestrictions.blockInstallers").optional().isBoolean(),
  body("systemRestrictions.blockAdminTools").optional().isBoolean(),
  body("systemRestrictions.restrictedPaths").optional().isArray({ max: 500 }),
];

const validateCreatePolicy = [
  body("name").isString().trim().isLength({ min: 1, max: 120 }),
  body("description").optional().isString().trim().isLength({ max: 1000 }),
  ..._applicationSection,
  ..._websiteSection,
  ..._otherSections,
];

/**
 * An update is a patch, so `name` is optional here while it is required on
 * create. The section rules are already optional and are reused as they are.
 */
const validateUpdatePolicy = [
  objectId("id"),
  body("name").optional().isString().trim().isLength({ min: 1, max: 120 }),
  body("description").optional().isString().trim().isLength({ max: 1000 }),
  ..._applicationSection,
  ..._websiteSection,
  ..._otherSections,
];

const validateAssignPolicy = [
  objectId("id"),
  body("scope").isIn(["device", "employee", "company"]),
  body("scopeId")
    .if(body("scope").not().equals("company"))
    .isMongoId()
    .withMessage("scopeId must be a valid id for device and employee scopes"),
  body("priority").optional().isInt({ min: -1000, max: 1000 }),
];

const validateCreateRequest = [
  body("deviceId").isMongoId(),
  body("category").isIn(REQUEST_CATEGORIES),
  body("resource").isString().trim().isLength({ min: 1, max: 500 }),
  body("reason").isString().trim().isLength({ min: 1, max: 1000 }),
  body("requestedUntil").optional({ nullable: true }).isISO8601(),
];

const validateDecision = [
  objectId("id"),
  body("note").optional().isString().trim().isLength({ max: 1000 }),
  body("grantedUntil").optional({ nullable: true }).isISO8601(),
];

const validateListing = [
  query("limit").optional().isInt({ min: 1, max: 500 }),
  query("skip").optional().isInt({ min: 0 }),
];

// ───────────────────────────── Agent endpoints ─────────────────────────────

const validateEnroll = [
  body("token").isString().trim().isLength({ min: 20, max: 200 }),
  body("name").isString().trim().isLength({ min: 1, max: 120 }),
  body("platform").isIn(DEVICE_PLATFORMS),
  body("osVersion").optional().isString().trim().isLength({ max: 120 }),
  body("agentVersion").optional().isString().trim().isLength({ max: 60 }),
  body("timeManagementDeviceId").optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
];

const validateDeviceToken = [
  body("deviceId").isMongoId(),
  body("deviceSecret").isString().trim().isLength({ min: 20, max: 200 }),
];

const validateEnforcementReport = [
  body("policyVersion").isInt({ min: 0 }),
  body("policyId").optional({ nullable: true }).isMongoId(),
  body("controls").isArray({ min: 1, max: CONTROL_KEYS.length }),
  body("controls.*.key").isIn(CONTROL_KEYS),
  body("controls.*.status").isIn(ENFORCEMENT_STATUSES),
  body("controls.*.message").optional().isString().trim().isLength({ max: 1000 }),
];

const validateHeartbeat = [
  body("agentVersion").optional().isString().trim().isLength({ max: 60 }),
  body("osVersion").optional().isString().trim().isLength({ max: 120 }),
];

module.exports = {
  validateDeviceId,
  validateCreateDevice,
  validateUpdateDevice,
  validateDeviceStatus,
  validateCreatePolicy,
  validateUpdatePolicy,
  validateAssignPolicy,
  validateCreateRequest,
  validateDecision,
  validateListing,
  validateEnroll,
  validateDeviceToken,
  validateEnforcementReport,
  validateHeartbeat,
};
