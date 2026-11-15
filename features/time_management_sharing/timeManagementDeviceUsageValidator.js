const { body, param, query } = require("express-validator");
const { MAX_PAGE_SIZE } = require("./timeManagementDeviceUsageService");

/** Largest batch accepted in one request; the client pages beyond this. */
const MAX_BATCH_ITEMS = 200;

/** Most window titles accepted for one application and day. */
const MAX_WINDOWS_PER_ITEM = 500;

const PLATFORMS = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
  "web",
  "unknown",
];

const isValidDateString = (val) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const d = new Date(val);
  return !Number.isNaN(d.getTime());
};

const validateDeviceUsageSync = [
  body("batchId")
    .notEmpty()
    .withMessage("batchId is required")
    .isString()
    .isLength({ min: 8, max: 200 })
    .withMessage("batchId must be between 8 and 200 characters"),
  body("deviceId")
    .notEmpty()
    .withMessage("deviceId is required")
    .isString()
    .isLength({ min: 4, max: 128 })
    .withMessage("deviceId must be between 4 and 128 characters"),
  body("deviceName")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 200 })
    .withMessage("deviceName must be at most 200 characters"),
  body("platform")
    .optional({ nullable: true })
    .isIn(PLATFORMS)
    .withMessage(`platform must be one of ${PLATFORMS.join(", ")}`),
  body("timezoneOffsetMinutes")
    .optional()
    .isInt({ min: -840, max: 840 })
    .withMessage("timezoneOffsetMinutes must be between -840 and 840"),
  body("items")
    .isArray({ min: 1, max: MAX_BATCH_ITEMS })
    .withMessage(`items must contain between 1 and ${MAX_BATCH_ITEMS} entries`),
  body("items.*.appName")
    .notEmpty()
    .withMessage("items[].appName is required")
    .isString()
    .isLength({ max: 300 })
    .withMessage("items[].appName must be at most 300 characters"),
  // The client's own record id. Opaque to the backend and echoed back in the
  // acknowledgement, so the client can mark exactly the records that were
  // accepted without reproducing the application-id normalization.
  body("items.*.localId")
    .optional({ nullable: true })
    .customSanitizer((value) => (value === undefined || value === null ? value : String(value)))
    .isLength({ max: 64 })
    .withMessage("items[].localId must be at most 64 characters"),
  body("items.*.date")
    .custom(isValidDateString)
    .withMessage("items[].date must be a valid YYYY-MM-DD date"),
  // The device's local change sequence. Required: without it the backend
  // cannot tell a newer snapshot from a replayed one.
  body("items.*.revision")
    .isInt({ min: 0 })
    .withMessage("items[].revision must be a non-negative integer"),
  body("items.*.totalDuration")
    .isInt({ min: 0 })
    .withMessage("items[].totalDuration must be a non-negative integer"),
  body("items.*.timezoneOffsetMinutes")
    .optional()
    .isInt({ min: -840, max: 840 })
    .withMessage("items[].timezoneOffsetMinutes must be between -840 and 840"),
  body("items.*.windows")
    .optional()
    .isArray({ max: MAX_WINDOWS_PER_ITEM })
    .withMessage(
      `items[].windows must contain at most ${MAX_WINDOWS_PER_ITEM} entries`
    ),
  body("items.*.windows.*.title")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 500 }),
  // Set by the client when it had more window titles than one item may carry.
  body("items.*.windowsTruncated").optional().isBoolean(),
  body("items.*.windows.*.durationMs")
    .optional()
    .isInt({ min: 0 })
    .withMessage("items[].windows[].durationMs must be a non-negative integer"),
];

const validateBatchId = [
  param("batchId")
    .notEmpty()
    .withMessage("batchId is required")
    .isLength({ min: 8, max: 200 }),
];

const validateAggregatedUsageQuery = [
  // Another user's usage is only readable through an accepted share; the
  // service enforces that.
  query("userId").optional().isMongoId().withMessage("Invalid user ID"),
  query("date")
    .optional()
    .custom(isValidDateString)
    .withMessage("date must be a valid YYYY-MM-DD date"),
  query("dateFrom")
    .optional()
    .custom(isValidDateString)
    .withMessage("dateFrom must be a valid YYYY-MM-DD date"),
  query("dateTo")
    .optional()
    .custom(isValidDateString)
    .withMessage("dateTo must be a valid YYYY-MM-DD date"),
  query("appId").optional().isString().isLength({ max: 300 }),
  query("appName").optional().isString().isLength({ max: 300 }),
  query("deviceId").optional().isString().isLength({ max: 128 }),
  query("includeWindows").optional().isBoolean(),
  query("page").optional().isInt({ min: 1 }).withMessage("page must be >= 1"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: MAX_PAGE_SIZE })
    .withMessage(`limit must be between 1 and ${MAX_PAGE_SIZE}`),
];

module.exports = {
  validateDeviceUsageSync,
  validateBatchId,
  validateAggregatedUsageQuery,
  MAX_BATCH_ITEMS,
  MAX_WINDOWS_PER_ITEM,
};
