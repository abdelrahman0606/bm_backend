const { body, param, query } = require("express-validator");
const { ProjectVisibility, ProjectStatus, ProjectType } = require("./projectEnums");

// ── Reusable Helpers ─────────────────────────────────────────────────────────

const projectIdParam = param("projectId")
  .isMongoId()
  .withMessage("Invalid project ID");

const companyIdBody = body("companyId")
  .notEmpty()
  .withMessage("companyId is required")
  .isMongoId()
  .withMessage("companyId must be a valid MongoDB ObjectId");

// ── Create ────────────────────────────────────────────────────────────────────

const createProjectValidator = [
  body("id")
    .notEmpty()
    .withMessage("id is required")
    .isString()
    .withMessage("id must be a string"),

  companyIdBody,

  body("title")
    .notEmpty()
    .withMessage("title is required")
    .isString()
    .trim()
    .isLength({ min: 1, max: 128 })
    .withMessage("title must be between 1 and 128 characters"),

  body("description").optional().isString().trim(),

  body("logo")
    .optional({ nullable: true })
    .isObject()
    .withMessage("logo must be a FileModel object"),

  body("color")
    .optional({ nullable: true })
    .isInt()
    .withMessage("color must be an integer"),

  body("privacy")
    .notEmpty()
    .withMessage("privacy is required")
    .isIn(Object.values(ProjectVisibility))
    .withMessage(
      `privacy must be one of: ${Object.values(ProjectVisibility).join(", ")}`
    ),

  body("status")
    .notEmpty()
    .withMessage("status is required")
    .isIn(Object.values(ProjectStatus))
    .withMessage(
      `status must be one of: ${Object.values(ProjectStatus).join(", ")}`
    ),

  body("type")
    .notEmpty()
    .withMessage("type is required")
    .isIn(Object.values(ProjectType))
    .withMessage(
      `type must be one of: ${Object.values(ProjectType).join(", ")}`
    ),

  body("isFavorite").optional().isBoolean().withMessage("isFavorite must be a boolean"),

  body("startDate")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("startDate must be a valid ISO 8601 date"),

  body("dueDate")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("dueDate must be a valid ISO 8601 date"),
];

// ── Update ────────────────────────────────────────────────────────────────────

const updateProjectValidator = [
  projectIdParam,

  body("title")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 128 })
    .withMessage("title must be between 1 and 128 characters"),

  body("description").optional().isString().trim(),

  body("logo")
    .optional({ nullable: true })
    .isObject()
    .withMessage("logo must be a FileModel object"),

  body("color")
    .optional({ nullable: true })
    .isInt()
    .withMessage("color must be an integer"),

  body("privacy")
    .optional()
    .isIn(Object.values(ProjectVisibility))
    .withMessage(
      `privacy must be one of: ${Object.values(ProjectVisibility).join(", ")}`
    ),

  body("status")
    .optional()
    .isIn(Object.values(ProjectStatus))
    .withMessage(
      `status must be one of: ${Object.values(ProjectStatus).join(", ")}`
    ),

  body("type")
    .optional()
    .isIn(Object.values(ProjectType))
    .withMessage(
      `type must be one of: ${Object.values(ProjectType).join(", ")}`
    ),

  body("isFavorite").optional().isBoolean().withMessage("isFavorite must be a boolean"),

  body("startDate")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("startDate must be a valid ISO 8601 date"),

  body("dueDate")
    .optional({ nullable: true })
    .isISO8601()
    .withMessage("dueDate must be a valid ISO 8601 date"),
];

// ── Get / Delete / Archive / Restore ─────────────────────────────────────────

const getProjectValidator = [projectIdParam];

const deleteProjectValidator = [projectIdParam];

const archiveProjectValidator = [projectIdParam];

const restoreProjectValidator = [projectIdParam];

// ── List / Search ─────────────────────────────────────────────────────────────

const listProjectValidator = [
  query("page")
    .optional()
    .isInt({ min: 0 })
    .withMessage("page must be a non-negative integer"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100"),

  query("search").optional().isString().trim(),

  query("companyId")
    .optional()
    .isMongoId()
    .withMessage("companyId must be a valid MongoDB ObjectId"),

  query("status")
    .optional()
    .custom((v) => {
      // Allow pipe-separated values: active|planned
      const values = String(v).split("|").map((s) => s.trim());
      return values.every((s) => Object.values(ProjectStatus).includes(s));
    })
    .withMessage(
      `status must be one or more of: ${Object.values(ProjectStatus).join(", ")}`
    ),

  query("privacy")
    .optional()
    .isIn(Object.values(ProjectVisibility))
    .withMessage(
      `privacy must be one of: ${Object.values(ProjectVisibility).join(", ")}`
    ),

  query("isFavorite")
    .optional()
    .isBoolean()
    .withMessage("isFavorite must be true or false"),

  query("isArchived")
    .optional()
    .isBoolean()
    .withMessage("isArchived must be true or false"),

  query("sort")
    .optional()
    .isString()
    .matches(/^[a-zA-Z_]+(:(asc|desc))?$/)
    .withMessage("sort must be in format: field or field:asc or field:desc"),
];

// ── Configuration ─────────────────────────────────────────────────────────────

const updateProjectConfigValidator = [
  projectIdParam,

  body("settings")
    .notEmpty()
    .withMessage("settings is required")
    .isObject()
    .withMessage("settings must be an object"),

  // Validate each known feature flag key is an object with an `enabled` boolean
  body("settings.*")
    .optional()
    .isObject()
    .withMessage("Each settings entry must be an object"),

  body("settings.*.enabled")
    .optional()
    .isBoolean()
    .withMessage("settings.*.enabled must be a boolean"),
];

// ── Stats ─────────────────────────────────────────────────────────────────────

const getProjectStatsValidator = [
  query("companyId")
    .optional()
    .isMongoId()
    .withMessage("companyId must be a valid MongoDB ObjectId"),
];

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createProjectValidator,
  updateProjectValidator,
  getProjectValidator,
  deleteProjectValidator,
  archiveProjectValidator,
  restoreProjectValidator,
  listProjectValidator,
  updateProjectConfigValidator,
  getProjectStatsValidator,
};
