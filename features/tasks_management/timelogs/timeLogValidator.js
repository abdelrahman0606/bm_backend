const { body, param, query } = require("express-validator");

const createTimeLogValidator = [
  body("issueId").isMongoId().withMessage("Invalid Issue ID"),
  body("minutes")
    .notEmpty()
    .withMessage("Minutes are required")
    .isInt({ min: 1 })
    .withMessage("Minutes must be at least 1"),
  body("description").optional().isString().trim(),
];

const updateTimeLogValidator = [
  param("timeLogId").isMongoId().withMessage("Invalid TimeLog ID"),
  body("minutes").optional().isInt({ min: 1 }),
  body("description").optional().isString().trim(),
];

const getTimeLogValidator = [
  param("timeLogId").isMongoId().withMessage("Invalid TimeLog ID"),
];

const deleteTimeLogValidator = [
  param("timeLogId").isMongoId().withMessage("Invalid TimeLog ID"),
];

const listTimeLogValidator = [
  query("issueId").isMongoId().withMessage("Issue ID is required"),
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
];

module.exports = {
  createTimeLogValidator,
  updateTimeLogValidator,
  getTimeLogValidator,
  deleteTimeLogValidator,
  listTimeLogValidator,
};
