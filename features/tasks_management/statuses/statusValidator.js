const { body, param, query } = require("express-validator");

const createStatusValidator = [
  body("workspaceId").isMongoId().withMessage("Invalid Workspace ID"),
  body("name")
    .notEmpty()
    .withMessage("Status name is required")
    .isString()
    .trim()
    .isLength({ min: 2, max: 50 }),
  body("category")
    .notEmpty()
    .withMessage("Category is required")
    .isIn(["TODO", "IN_PROGRESS", "DONE"]),
  body("color").optional().isString().trim(),
  body("order").optional().isInt(),
];

const updateStatusValidator = [
  param("statusId").isMongoId().withMessage("Invalid Status ID"),
  body("name").optional().isString().trim().isLength({ min: 2, max: 50 }),
  body("category").optional().isIn(["TODO", "IN_PROGRESS", "DONE"]),
  body("color").optional().isString().trim(),
  body("order").optional().isInt(),
];

const getStatusValidator = [
  param("statusId").isMongoId().withMessage("Invalid Status ID"),
];

const deleteStatusValidator = [
  param("statusId").isMongoId().withMessage("Invalid Status ID"),
];

const listStatusValidator = [
  query("workspaceId").isMongoId().withMessage("Workspace ID is required"),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
];

module.exports = {
  createStatusValidator,
  updateStatusValidator,
  getStatusValidator,
  deleteStatusValidator,
  listStatusValidator,
};
