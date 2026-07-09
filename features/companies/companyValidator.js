const { body } = require("express-validator");

const validateCompanyCreate = [
  body("id").notEmpty().withMessage("id is required"),
  body("title").notEmpty().withMessage("title is required").isString(),
  body("description").optional().isString(),
  body("logo").optional().isObject(),
  body("isPrimary").optional().isBoolean(),
  body("index").notEmpty().withMessage("index is required").isNumeric(),
];

const validateCompanyUpdate = [
  body("title").optional().isString(),
  body("description").optional().isString(),
  body("logo").optional().isObject(),
  body("isPrimary").optional().isBoolean(),
  body("index").optional().isNumeric(),
];

module.exports = {
  validateCompanyCreate,
  validateCompanyUpdate,
};
