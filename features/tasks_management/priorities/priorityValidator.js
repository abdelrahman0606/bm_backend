const { body, param, query } = require("express-validator");

const createPriorityValidator = [
  body("workspaceId").isMongoId().withMessage("Invalid Workspace ID"),
  body("name")
    .notEmpty()
    .withMessage("Priority name is required")
    .isString()
    .trim()
    .isLength({ min: 2, max: 50 }),
  body("color").optional().isString().trim(),
  body("order").optional().isInt(),
];

const updatePriorityValidator = [
  param("priorityId").isMongoId().withMessage("Invalid Priority ID"),
  body("name").optional().isString().trim().isLength({ min: 2, max: 50 }),
  body("color").optional().isString().trim(),
  body("order").optional().isInt(),
];

const getPriorityValidator = [
  param("priorityId").isMongoId().withMessage("Invalid Priority ID"),
];

const deletePriorityValidator = [
  param("priorityId").isMongoId().withMessage("Invalid Priority ID"),
];

const listPriorityValidator = [
  query("workspaceId").isMongoId().withMessage("Workspace ID is required"),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
];

module.exports = {
  createPriorityValidator,
  updatePriorityValidator,
  getPriorityValidator,
  deletePriorityValidator,
  listPriorityValidator,
};
