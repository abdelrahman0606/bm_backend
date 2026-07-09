const { body, param, query } = require("express-validator");

const createComponentValidator = [
  body("projectId").isMongoId().withMessage("Invalid Project ID"),
  body("name")
    .notEmpty()
    .withMessage("Component name is required")
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 }),
  body("description").optional().isString().trim(),
];

const updateComponentValidator = [
  param("componentId").isMongoId().withMessage("Invalid Component ID"),
  body("name").optional().isString().trim().isLength({ min: 1, max: 100 }),
  body("description").optional().isString().trim(),
];

const getComponentValidator = [
  param("componentId").isMongoId().withMessage("Invalid Component ID"),
];

const deleteComponentValidator = [
  param("componentId").isMongoId().withMessage("Invalid Component ID"),
];

const listComponentValidator = [
  query("projectId").isMongoId().withMessage("Project ID is required"),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
];

module.exports = {
  createComponentValidator,
  updateComponentValidator,
  getComponentValidator,
  deleteComponentValidator,
  listComponentValidator,
};
