const { body, param, query } = require("express-validator");
const { SprintStatus } = require("../models/sprintModel");

const sprintIdParam = param("sprintId")
  .isMongoId()
  .withMessage("Invalid Sprint ID");

// ── Create ─────────────────────────────────────────────────────────────────────

const createSprintValidator = [
  body("projectId")
    .notEmpty().withMessage("projectId is required")
    .isMongoId().withMessage("projectId must be a valid MongoDB ObjectId"),

  body("companyId")
    .optional()
    .isString().withMessage("companyId must be a string"),

  body("title")
    .notEmpty().withMessage("title is required")
    .isString()
    .trim()
    .isLength({ min: 1, max: 128 })
    .withMessage("title must be between 1 and 128 characters"),

  body("goal")
    .optional({ nullable: true })
    .isString()
    .trim(),

  body("startDate")
    .optional({ nullable: true })
    .isISO8601().withMessage("startDate must be a valid ISO 8601 date"),

  body("endDate")
    .optional({ nullable: true })
    .isISO8601().withMessage("endDate must be a valid ISO 8601 date"),

  body("boardId")
    .optional({ nullable: true })
    .isMongoId().withMessage("boardId must be a valid MongoDB ObjectId"),
];

// ── Update ─────────────────────────────────────────────────────────────────────

const updateSprintValidator = [
  sprintIdParam,

  body("title")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 128 })
    .withMessage("title must be between 1 and 128 characters"),

  body("goal")
    .optional({ nullable: true })
    .isString()
    .trim(),

  body("startDate")
    .optional({ nullable: true })
    .isISO8601().withMessage("startDate must be a valid ISO 8601 date"),

  body("endDate")
    .optional({ nullable: true })
    .isISO8601().withMessage("endDate must be a valid ISO 8601 date"),

  body("isArchived")
    .optional()
    .isBoolean().withMessage("isArchived must be a boolean"),

  body("boardId")
    .optional({ nullable: true })
    .isMongoId().withMessage("boardId must be a valid MongoDB ObjectId"),
];

// ── Get Single ─────────────────────────────────────────────────────────────────

const getSprintValidator = [sprintIdParam];

// ── Delete ─────────────────────────────────────────────────────────────────────

const deleteSprintValidator = [sprintIdParam];

// ── Start / Complete ───────────────────────────────────────────────────────────

const startSprintValidator = [sprintIdParam];
const completeSprintValidator = [sprintIdParam];

// ── List ───────────────────────────────────────────────────────────────────────

const listSprintValidator = [
  query("projectId")
    .optional()
    .isMongoId().withMessage("projectId must be a valid MongoDB ObjectId"),

  query("companyId")
    .optional()
    .isString(),

  query("status")
    .optional()
    .isIn(Object.values(SprintStatus))
    .withMessage(`status must be one of: ${Object.values(SprintStatus).join(", ")}`),

  query("createdBy")
    .optional()
    .isString(),

  query("search")
    .optional()
    .isString()
    .trim(),

  query("page")
    .optional()
    .isInt({ min: 0 }).withMessage("page must be a non-negative integer"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage("limit must be between 1 and 100"),

  query("sort")
    .optional()
    .isString()
    .matches(/^[a-zA-Z_]+(:(asc|desc))?$/)
    .withMessage("sort must be in format: field or field:asc or field:desc"),
];

// ── Reorder ────────────────────────────────────────────────────────────────────

const reorderSprintsValidator = [
  body("projectId")
    .notEmpty().withMessage("projectId is required")
    .isMongoId().withMessage("projectId must be a valid MongoDB ObjectId"),

  body("orderedItems")
    .isArray({ min: 1 }).withMessage("orderedItems must be a non-empty array"),

  body("orderedItems.*.id")
    .isMongoId().withMessage("Each orderedItems entry must have a valid id"),

  body("orderedItems.*.order")
    .isInt({ min: 0 }).withMessage("Each orderedItems entry must have a non-negative order"),
];

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  createSprintValidator,
  updateSprintValidator,
  getSprintValidator,
  deleteSprintValidator,
  startSprintValidator,
  completeSprintValidator,
  listSprintValidator,
  reorderSprintsValidator,
};
