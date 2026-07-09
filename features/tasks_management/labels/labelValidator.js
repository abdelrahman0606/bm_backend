const { body, param, query } = require("express-validator");

const createLabelValidator = [
  body("workspaceId").isMongoId().withMessage("Invalid Workspace ID"),
  body("name")
    .notEmpty()
    .withMessage("Label name is required")
    .isString()
    .trim()
    .isLength({ min: 2, max: 50 }),
  body("color").optional().isString().trim(),
];

const updateLabelValidator = [
  param("labelId").isMongoId().withMessage("Invalid Label ID"),
  body("name").optional().isString().trim().isLength({ min: 2, max: 50 }),
  body("color").optional().isString().trim(),
];

const getLabelValidator = [
  param("labelId").isMongoId().withMessage("Invalid Label ID"),
];

const deleteLabelValidator = [
  param("labelId").isMongoId().withMessage("Invalid Label ID"),
];

const listLabelValidator = [
  query("workspaceId").isMongoId().withMessage("Workspace ID is required"),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
];

module.exports = {
  createLabelValidator,
  updateLabelValidator,
  getLabelValidator,
  deleteLabelValidator,
  listLabelValidator,
};
