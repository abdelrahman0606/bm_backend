const { query } = require("express-validator");

const validateGetMyDay = [
  query("day")
    .optional()
    .isString()
    .withMessage("day must be a valid date or ISO string"),
  query("fields")
    .optional()
    .isString()
    .withMessage("fields must be a comma-separated string"),
];

module.exports = {
  validateGetMyDay,
};
