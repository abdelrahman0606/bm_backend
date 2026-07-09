const { body, param, query } = require("express-validator");

const createIssueValidator = [
  body("projectId").notEmpty().withMessage("Project ID is required").isMongoId(),
  body("sprintId").optional({ nullable: true }).isMongoId(),
  body("statusId").optional({ nullable: true }).isMongoId(),
  body("priorityId").optional({ nullable: true }).isMongoId(),
  body("assigneeId").optional({ nullable: true }).isMongoId(),
  body("reporterId").notEmpty().withMessage("Reporter ID is required").isMongoId(),
  body("title").notEmpty().withMessage("Title is required").isString().trim().isLength({ min: 3, max: 200 }),
  body("description").notEmpty().withMessage("Description is required").isString().trim(),
  body("estimate").optional().isNumeric(),
  body("storyPoints").optional().isNumeric(),
  body("dueDate").optional().isISO8601(),
];

const updateIssueValidator = [
  param("issueId").notEmpty().withMessage("Issue ID is required").isMongoId(),
  body("projectId").optional().isMongoId(),
  body("sprintId").optional({ nullable: true }).isMongoId(),
  body("statusId").optional({ nullable: true }).isMongoId(),
  body("priorityId").optional({ nullable: true }).isMongoId(),
  body("assigneeId").optional({ nullable: true }).isMongoId(),
  body("title").optional().isString().trim().isLength({ min: 3, max: 200 }),
  body("description").optional().isString().trim(),
  body("estimate").optional().isNumeric(),
  body("storyPoints").optional().isNumeric(),
  body("dueDate").optional().isISO8601(),
];

const issueIdValidator = [
  param("issueId").notEmpty().withMessage("Issue ID is required").isMongoId(),
];

const issueQueryValidator = [
  query("projectId").optional().isMongoId(),
  query("sprintId").optional().isMongoId(),
  query("statusId").optional().isMongoId(),
  query("priorityId").optional().isMongoId(),
  query("assigneeId").optional().isMongoId(),
  query("reporterId").optional().isMongoId(),
  query("search").optional().isString().trim(),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
];

module.exports = {
  createIssueValidator,
  updateIssueValidator,
  issueIdValidator,
  issueQueryValidator,
};
