const { body, param, query } = require("express-validator");

const createVersionValidator = [
  body("projectId").isMongoId().withMessage("Invalid Project ID"),
  body("name")
    .notEmpty()
    .withMessage("Version name is required")
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 }),
  body("releaseDate").optional({ nullable: true }).isISO8601(),
  body("released").optional().isBoolean(),
];

const updateVersionValidator = [
  param("versionId").isMongoId().withMessage("Invalid Version ID"),
  body("name").optional().isString().trim().isLength({ min: 1, max: 100 }),
  body("releaseDate").optional({ nullable: true }).isISO8601(),
  body("released").optional().isBoolean(),
];

const getVersionValidator = [
  param("versionId").isMongoId().withMessage("Invalid Version ID"),
];

const deleteVersionValidator = [
  param("versionId").isMongoId().withMessage("Invalid Version ID"),
];

const listVersionValidator = [
  query("projectId").isMongoId().withMessage("Project ID is required"),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
];

module.exports = {
  createVersionValidator,
  updateVersionValidator,
  getVersionValidator,
  deleteVersionValidator,
  listVersionValidator,
};
