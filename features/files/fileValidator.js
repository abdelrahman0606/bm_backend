const { check, query } = require("express-validator");
// We can use the existing validator middleware from the project
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.uploadFileValidator = [
  check("id")
    .notEmpty()
    .withMessage("id is required (must be a valid UUID or unique string)")
    .isString(),
  
  check("withDatabase")
    .optional()
    .isBoolean()
    .withMessage("withDatabase must be a boolean (true or false)"),

  check("scope")
    .optional(),

  check("source")
    .optional()
    .isString()
    .isIn(["local", "telegram"])
    .withMessage("source must be either local or telegram"),
    
  validatorMiddleware,
];

exports.uploadMultipleFilesValidator = [
  check("ids")
    .notEmpty()
    .withMessage("ids is required (must be an array of UUIDs or a comma-separated string)"),
  
  check("withDatabase")
    .optional()
    .isBoolean()
    .withMessage("withDatabase must be a boolean (true or false)"),

  check("scope")
    .optional(),

  check("source")
    .optional()
    .isString()
    .isIn(["local", "telegram"])
    .withMessage("source must be either local or telegram"),
    
  validatorMiddleware,
];

exports.getFilesValidator = [
  query("scope").optional().isObject(),
  // We can validate that if scope is provided, its values are strings
  query("scope.*").optional().isString(),
  validatorMiddleware,
];
