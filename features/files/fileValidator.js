const { check } = require("express-validator");
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

  check("category")
    .optional()
    .isString(),

  check("entityId")
    .optional()
    .isString(),
    
  validatorMiddleware,
];
