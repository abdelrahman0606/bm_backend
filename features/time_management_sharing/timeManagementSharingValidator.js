const { body, param, query } = require("express-validator");

const isValidDateString = (val) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const d = new Date(val);
  return !isNaN(d.getTime());
};

const SHARE_SCOPES = ["personal", "company", "person"];
const SHARE_MODES = ["manual", "automatic"];
const SCHEDULE_TYPES = ["hourly", "daily", "weekly", "monthly"];

const scheduleRules = (field) => [
  body(field).optional({ nullable: true }).isObject().withMessage(`${field} must be an object`),
  body(`${field}.type`)
    .optional()
    .isIn(SCHEDULE_TYPES)
    .withMessage(`${field}.type must be one of ${SCHEDULE_TYPES.join(", ")}`),
  body(`${field}.hour`)
    .optional()
    .isInt({ min: 0, max: 23 })
    .withMessage(`${field}.hour must be between 0 and 23`),
  body(`${field}.minute`)
    .optional()
    .isInt({ min: 0, max: 59 })
    .withMessage(`${field}.minute must be between 0 and 59`),
  body(`${field}.dayOfWeek`)
    .optional()
    .isInt({ min: 1, max: 7 })
    .withMessage(`${field}.dayOfWeek must be between 1 and 7`),
  body(`${field}.dayOfMonth`)
    .optional()
    .isInt({ min: 1, max: 31 })
    .withMessage(`${field}.dayOfMonth must be between 1 and 31`),
  body(`${field}.timezoneOffsetMinutes`)
    .optional()
    .isInt({ min: -840, max: 840 })
    .withMessage(`${field}.timezoneOffsetMinutes must be between -840 and 840`),
  body(`${field}.enabled`)
    .optional()
    .isBoolean()
    .withMessage(`${field}.enabled must be a boolean`),
];

const validateCreateShare = [
  body("shareScope")
    .optional()
    .isIn(SHARE_SCOPES)
    .withMessage(`shareScope must be one of ${SHARE_SCOPES.join(", ")}`),
  // Required for person-to-person sharing only; personal and company
  // configurations belong to the requesting user.
  body("recipientUserId")
    .if((value, { req }) => (req.body.shareScope || "person") === "person")
    .notEmpty()
    .withMessage("recipientUserId is required")
    .isMongoId()
    .withMessage("Invalid recipient ID"),
  body("companyId")
    .if((value, { req }) => req.body.shareScope === "company")
    .notEmpty()
    .withMessage("companyId is required for company sharing")
    .isString()
    .withMessage("companyId must be a string"),
  body("shareMode")
    .optional()
    .isIn(SHARE_MODES)
    .withMessage(`shareMode must be one of ${SHARE_MODES.join(", ")}`),
  ...scheduleRules("schedule"),
  body("filterId")
    .notEmpty()
    .withMessage("filterId is required")
    .isString()
    .withMessage("filterId must be a string"),
  body()
    .custom((val) => {
      const name = val.filterName || val.title;
      if (!name || typeof name !== "string" || !name.trim()) {
        throw new Error("filterName or title is required");
      }
      return true;
    }),
  body("filterDefinition")
    .notEmpty()
    .withMessage("filterDefinition is required")
    .isObject()
    .withMessage("filterDefinition must be an object"),
  body("schemaVersion").optional().isNumeric().withMessage("schemaVersion must be a number"),
  body("scops").optional().isObject().withMessage("scops must be an object"),
  body("metadata").optional().isObject().withMessage("metadata must be an object"),
  body("invitationLink").optional().isString().withMessage("invitationLink must be a string"),
];

const validateUpdateShare = [
  param("shareId")
    .notEmpty()
    .withMessage("shareId is required")
    .isMongoId()
    .withMessage("Invalid share ID"),
  body("filterName").optional().isString().withMessage("filterName must be a string"),
  body("title").optional().isString().withMessage("title must be a string"),
  body("filterDefinition").optional().isObject().withMessage("filterDefinition must be an object"),
  body("scops").optional().isObject().withMessage("scops must be an object"),
  body("schemaVersion").optional().isNumeric().withMessage("schemaVersion must be a number"),
  body("metadata").optional().isObject().withMessage("metadata must be an object"),
  body("shareMode")
    .optional()
    .isIn(SHARE_MODES)
    .withMessage(`shareMode must be one of ${SHARE_MODES.join(", ")}`),
  ...scheduleRules("schedule"),
];

const validateUpdateSchedule = [
  param("shareId")
    .notEmpty()
    .withMessage("shareId is required")
    .isMongoId()
    .withMessage("Invalid share ID"),
  body("shareMode")
    .optional()
    .isIn(SHARE_MODES)
    .withMessage(`shareMode must be one of ${SHARE_MODES.join(", ")}`),
  ...scheduleRules("schedule"),
];

const validateShareNow = [
  param("shareId")
    .notEmpty()
    .withMessage("shareId is required")
    .isMongoId()
    .withMessage("Invalid share ID"),
  body("dateFrom")
    .optional()
    .custom((val) => {
      if (!isValidDateString(val)) throw new Error("dateFrom must be in YYYY-MM-DD format");
      return true;
    }),
  body("dateTo")
    .optional()
    .custom((val) => {
      if (!isValidDateString(val)) throw new Error("dateTo must be in YYYY-MM-DD format");
      return true;
    }),
];

const validateShareId = [
  param("shareId")
    .notEmpty()
    .withMessage("shareId is required")
    .isMongoId()
    .withMessage("Invalid share ID"),
];

const validateSyncUsage = [
  body("batchId")
    .notEmpty()
    .withMessage("batchId is required")
    .isString()
    .withMessage("batchId must be a string"),
  body("filterId")
    .notEmpty()
    .withMessage("filterId is required")
    .isString()
    .withMessage("filterId must be a string"),
  body("recipientId")
    .notEmpty()
    .withMessage("recipientId is required")
    .isMongoId()
    .withMessage("Invalid recipient ID"),
  body("date")
    .notEmpty()
    .withMessage("date is required")
    .custom((val) => {
      if (!isValidDateString(val)) {
        throw new Error("date must be in YYYY-MM-DD format");
      }
      return true;
    }),
  body("syncType")
    .optional()
    .isIn(["delta", "absolute"])
    .withMessage("syncType must be 'delta' or 'absolute'"),
  body("totalDuration")
    .notEmpty()
    .withMessage("totalDuration is required")
    .isInt({ min: 0 })
    .withMessage("totalDuration must be a non-negative integer"),
  body("apps")
    .isArray()
    .withMessage("apps must be an array")
    .custom((apps) => {
      for (let i = 0; i < apps.length; i += 1) {
        const app = apps[i];
        if (!app || typeof app !== "object") {
          throw new Error(`apps[${i}] must be an object`);
        }
        if (!app.appName || typeof app.appName !== "string" || !app.appName.trim()) {
          throw new Error(`apps[${i}].appName is required and must be a non-empty string`);
        }
        if (typeof app.totalDuration !== "number" || app.totalDuration < 0) {
          throw new Error(`apps[${i}].totalDuration must be a non-negative number`);
        }
        if (app.windows !== undefined) {
          if (!Array.isArray(app.windows)) {
            throw new Error(`apps[${i}].windows must be an array`);
          }
          for (let j = 0; j < app.windows.length; j += 1) {
            const win = app.windows[j];
            if (!win || typeof win !== "object") {
              throw new Error(`apps[${i}].windows[${j}] must be an object`);
            }
            if (typeof win.title !== "string" || !win.title.trim()) {
              throw new Error(`apps[${i}].windows[${j}].title must be a non-empty string`);
            }
            if (typeof win.durationMs !== "number" || win.durationMs < 0) {
              throw new Error(`apps[${i}].windows[${j}].durationMs must be a non-negative number`);
            }
          }
        }
      }
      return true;
    }),
];

const validateBatchId = [
  param("batchId")
    .notEmpty()
    .withMessage("batchId is required")
    .isString()
    .withMessage("batchId must be a string"),
];

const validateReportQuery = [
  query("role")
    .optional()
    .isIn(["recipient", "sender"])
    .withMessage("role must be 'recipient' or 'sender'"),
  query("startDate")
    .optional()
    .custom((val) => {
      if (!isValidDateString(val)) throw new Error("startDate must be in YYYY-MM-DD format");
      return true;
    }),
  query("dateFrom")
    .optional()
    .custom((val) => {
      if (!isValidDateString(val)) throw new Error("dateFrom must be in YYYY-MM-DD format");
      return true;
    }),
  query("endDate")
    .optional()
    .custom((val) => {
      if (!isValidDateString(val)) throw new Error("endDate must be in YYYY-MM-DD format");
      return true;
    }),
  query("dateTo")
    .optional()
    .custom((val) => {
      if (!isValidDateString(val)) throw new Error("dateTo must be in YYYY-MM-DD format");
      return true;
    }),
  query("filterId").optional().isString().withMessage("filterId must be a string"),
  query("employeeId").optional().isMongoId().withMessage("Invalid employeeId format"),
  query("userId").optional().isMongoId().withMessage("Invalid userId format"),
  query("companyId").optional().isString().withMessage("companyId must be a string"),
];

module.exports = {
  validateCreateShare,
  validateUpdateShare,
  validateUpdateSchedule,
  validateShareNow,
  validateShareId,
  validateSyncUsage,
  validateBatchId,
  validateReportQuery,
};
