const { body, param, query } = require("express-validator");

const createSprintValidator = [
  body("projectId").isMongoId().withMessage("Invalid Project ID"),
  body("boardId").isMongoId().withMessage("Invalid Board ID"),
  body("name")
    .notEmpty()
    .withMessage("Sprint name is required")
    .isString()
    .trim()
    .isLength({ min: 3, max: 100 }),
  body("goal").optional().isString().trim(),
  body("startDate").isISO8601().withMessage("Valid start date is required"),
  body("endDate").isISO8601().withMessage("Valid end date is required"),
  body("state").optional().isIn(["active", "completed", "planned"]),
];

const updateSprintValidator = [
  param("sprintId").isMongoId().withMessage("Invalid Sprint ID"),
  body("name").optional().isString().trim().isLength({ min: 3, max: 100 }),
  body("goal").optional().isString().trim(),
  body("startDate").optional().isISO8601(),
  body("endDate").optional().isISO8601(),
  body("state").optional().isIn(["active", "completed", "planned"]),
];

const getSprintValidator = [
  param("sprintId").isMongoId().withMessage("Invalid Sprint ID"),
];

const deleteSprintValidator = [
  param("sprintId").isMongoId().withMessage("Invalid Sprint ID"),
];

const listSprintValidator = [
  query("projectId").isMongoId().withMessage("Project ID is required"),
  query("boardId").optional().isMongoId(),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
];

module.exports = {
  createSprintValidator,
  updateSprintValidator,
  getSprintValidator,
  deleteSprintValidator,
  listSprintValidator,
};
