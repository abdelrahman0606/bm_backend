const { body, param, query } = require("express-validator");
const { IssueType, IssuePriority, IssueVisibility } = require("./issueEnums");

// ── Reusable field validators ─────────────────────────────────────────────────

const typeValidator = (chain) =>
  chain.optional().isIn(Object.values(IssueType))
    .withMessage(`type must be one of: ${Object.values(IssueType).join(", ")}`);

const priorityValidator = (chain) =>
  chain.optional().isIn(Object.values(IssuePriority))
    .withMessage(`priority must be one of: ${Object.values(IssuePriority).join(", ")}`);

const visibilityValidator = (chain) =>
  chain.optional().isIn(Object.values(IssueVisibility))
    .withMessage(`visibility must be one of: ${Object.values(IssueVisibility).join(", ")}`);

// ── Create Issue ─────────────────────────────────────────────────────────────

const createIssueValidator = [
  body("companyId")
    .notEmpty().withMessage("companyId is required")
    .isString().trim(),

  body("projectId")
    .notEmpty().withMessage("projectId is required")
    .isMongoId().withMessage("projectId must be a valid ObjectId"),

  body("title")
    .notEmpty().withMessage("title is required")
    .isString().trim()
    .isLength({ min: 1, max: 300 }).withMessage("title must be between 1 and 300 characters"),

  body("description")
    .optional({ nullable: true })
    .isString().trim(),

  typeValidator(body("type")),
  priorityValidator(body("priority")),
  visibilityValidator(body("visibility")),

  body("statusId")
    .optional({ nullable: true })
    .isMongoId().withMessage("statusId must be a valid ObjectId"),

  body("sprintId")
    .optional({ nullable: true })
    .isMongoId().withMessage("sprintId must be a valid ObjectId"),

  body("milestoneId")
    .optional({ nullable: true })
    .isMongoId().withMessage("milestoneId must be a valid ObjectId"),

  body("parentId")
    .optional({ nullable: true })
    .isMongoId().withMessage("parentId must be a valid ObjectId"),

  body("assignedTo")
    .optional({ nullable: true })
    .isString().withMessage("assignedTo must be a string userId"),

  body("tags")
    .optional({ nullable: true })
    .isArray().withMessage("tags must be an array"),
  body("tags.*")
    .optional()
    .isString().trim().withMessage("each tag must be a string"),

  body("links")
    .optional({ nullable: true })
    .isArray().withMessage("links must be an array"),
  body("links.*.url")
    .optional()
    .isURL().withMessage("each link.url must be a valid URL"),
  body("links.*.title")
    .optional()
    .isString().trim(),

  body("storyPoints")
    .optional({ nullable: true })
    .isNumeric().withMessage("storyPoints must be a number"),

  body("progress")
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 100 }).withMessage("progress must be between 0 and 100"),

  body("startDate")
    .optional({ nullable: true })
    .isISO8601().withMessage("startDate must be a valid ISO 8601 date"),

  body("dueDate")
    .optional({ nullable: true })
    .isISO8601().withMessage("dueDate must be a valid ISO 8601 date"),

  body("timeTracking.estimate")
    .optional({ nullable: true })
    .isInt({ min: 0 }).withMessage("timeTracking.estimate must be a non-negative integer (minutes)"),

  body("order")
    .optional({ nullable: true })
    .isInt({ min: 0 }).withMessage("order must be a non-negative integer"),
];

// ── Update Issue ─────────────────────────────────────────────────────────────

const updateIssueValidator = [
  param("issueId")
    .notEmpty().withMessage("issueId param is required")
    .isMongoId().withMessage("issueId must be a valid ObjectId"),

  body("title")
    .optional()
    .isString().trim()
    .isLength({ min: 1, max: 300 }).withMessage("title must be between 1 and 300 characters"),

  body("description")
    .optional({ nullable: true })
    .isString().trim(),

  typeValidator(body("type")),
  priorityValidator(body("priority")),
  visibilityValidator(body("visibility")),

  body("statusId")
    .optional({ nullable: true })
    .isMongoId().withMessage("statusId must be a valid ObjectId"),

  body("sprintId")
    .optional({ nullable: true })
    .isMongoId().withMessage("sprintId must be a valid ObjectId"),

  body("milestoneId")
    .optional({ nullable: true })
    .isMongoId().withMessage("milestoneId must be a valid ObjectId"),

  body("parentId")
    .optional({ nullable: true })
    .isMongoId().withMessage("parentId must be a valid ObjectId"),

  body("assignedTo")
    .optional({ nullable: true })
    .isString().withMessage("assignedTo must be a string userId"),

  body("tags")
    .optional({ nullable: true })
    .isArray().withMessage("tags must be an array"),
  body("tags.*")
    .optional()
    .isString().trim().withMessage("each tag must be a string"),

  body("links")
    .optional({ nullable: true })
    .isArray().withMessage("links must be an array"),
  body("links.*.url")
    .optional()
    .isURL().withMessage("each link.url must be a valid URL"),
  body("links.*.title")
    .optional()
    .isString().trim(),

  body("storyPoints")
    .optional({ nullable: true })
    .isNumeric().withMessage("storyPoints must be a number"),

  body("progress")
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 100 }).withMessage("progress must be between 0 and 100"),

  body("startDate")
    .optional({ nullable: true })
    .isISO8601().withMessage("startDate must be a valid ISO 8601 date"),

  body("dueDate")
    .optional({ nullable: true })
    .isISO8601().withMessage("dueDate must be a valid ISO 8601 date"),

  body("timeTracking.estimate")
    .optional({ nullable: true })
    .isInt({ min: 0 }).withMessage("timeTracking.estimate must be a non-negative integer (minutes)"),

  body("timeTracking.logged")
    .optional({ nullable: true })
    .isInt({ min: 0 }).withMessage("timeTracking.logged must be a non-negative integer (minutes)"),

  body("timeTracking.remaining")
    .optional({ nullable: true })
    .isInt({ min: 0 }).withMessage("timeTracking.remaining must be a non-negative integer (minutes)"),

  body("order")
    .optional({ nullable: true })
    .isInt({ min: 0 }).withMessage("order must be a non-negative integer"),
];

// ── Move Status ───────────────────────────────────────────────────────────────

const moveStatusValidator = [
  param("issueId")
    .notEmpty().withMessage("issueId param is required")
    .isMongoId().withMessage("issueId must be a valid ObjectId"),
  body("statusId")
    .notEmpty().withMessage("statusId is required")
    .isMongoId().withMessage("statusId must be a valid ObjectId"),
];

// ── Move Sprint ───────────────────────────────────────────────────────────────

const moveSprintValidator = [
  param("issueId")
    .notEmpty().withMessage("issueId param is required")
    .isMongoId().withMessage("issueId must be a valid ObjectId"),
  body("sprintId")
    .optional({ nullable: true })
    .isMongoId().withMessage("sprintId must be a valid ObjectId"),
];

// ── Assign Issue ──────────────────────────────────────────────────────────────

const assignIssueValidator = [
  param("issueId")
    .notEmpty().withMessage("issueId param is required")
    .isMongoId().withMessage("issueId must be a valid ObjectId"),
  body("assignedTo")
    .optional({ nullable: true })
    .isString().withMessage("assignedTo must be a string userId"),
];

// ── Reorder Issues ────────────────────────────────────────────────────────────

const reorderIssuesValidator = [
  body("items")
    .isArray({ min: 1 }).withMessage("items must be a non-empty array"),
  body("items.*.id")
    .notEmpty().withMessage("each item.id is required")
    .isMongoId().withMessage("each item.id must be a valid ObjectId"),
  body("items.*.order")
    .notEmpty().withMessage("each item.order is required")
    .isInt({ min: 0 }).withMessage("each item.order must be a non-negative integer"),
];

// ── Checklist Item ────────────────────────────────────────────────────────────

const checklistItemValidator = [
  param("issueId")
    .notEmpty().withMessage("issueId param is required")
    .isMongoId().withMessage("issueId must be a valid ObjectId"),
  body("title")
    .notEmpty().withMessage("title is required")
    .isString().trim()
    .isLength({ min: 1, max: 500 }),
  body("order")
    .optional()
    .isInt({ min: 0 }),
];

const updateChecklistItemValidator = [
  param("issueId")
    .notEmpty().withMessage("issueId param is required")
    .isMongoId().withMessage("issueId must be a valid ObjectId"),
  param("itemId")
    .notEmpty().withMessage("itemId param is required")
    .isMongoId().withMessage("itemId must be a valid ObjectId"),
  body("title")
    .optional()
    .isString().trim()
    .isLength({ min: 1, max: 500 }),
  body("completed")
    .optional()
    .isBoolean(),
  body("order")
    .optional()
    .isInt({ min: 0 }),
];

// ── Issue ID Param ────────────────────────────────────────────────────────────

const issueIdValidator = [
  param("issueId")
    .notEmpty().withMessage("issueId param is required")
    .isMongoId().withMessage("issueId must be a valid ObjectId"),
];

// ── Project Stats Param ───────────────────────────────────────────────────────

const projectStatsValidator = [
  param("projectId")
    .notEmpty().withMessage("projectId param is required")
    .isMongoId().withMessage("projectId must be a valid ObjectId"),
];

// ── Query / Filter ────────────────────────────────────────────────────────────

const issueQueryValidator = [
  query("companyId").optional().isString().trim(),
  query("projectId").optional().isMongoId(),
  query("sprintId").optional().isMongoId(),
  query("milestoneId").optional().isMongoId(),
  query("statusId").optional().isMongoId(),
  query("assignedTo").optional().isString(),
  query("createdBy").optional().isString(),
  query("watcher").optional().isString(),
  query("parentId")
    .optional()
    .custom((val) => val === "null" || /^[0-9a-fA-F]{24}$/.test(val))
    .withMessage("parentId must be 'null' or a valid ObjectId"),
  typeValidator(query("type")),
  priorityValidator(query("priority")),
  query("tags").optional().isString(),            // comma-separated
  query("archived").optional().isIn(["true", "false", "only"]),
  query("deleted").optional().isIn(["true", "false", "only"]),
  query("search").optional().isString().trim(),
  query("sortBy").optional().isString().trim(),
  query("sortOrder").optional().isIn(["asc", "desc"]),
  query("page").optional().isInt({ min: 1 }).toInt(),
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
];

module.exports = {
  createIssueValidator,
  updateIssueValidator,
  moveStatusValidator,
  moveSprintValidator,
  reorderIssuesValidator,
  checklistItemValidator,
  updateChecklistItemValidator,
  issueIdValidator,
  issueQueryValidator,
  projectStatsValidator,
  assignIssueValidator,
};
