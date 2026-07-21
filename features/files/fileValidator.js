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

  check("entityType")
    .optional()
    .isString(),

  check("entityId")
    .optional()
    .isString(),
    
  validatorMiddleware,
];

exports.getFilesValidator = [
  query("companyId").optional().isString(),
  query("projectId").optional().isString(),
  query("issueId").optional().isString(),
  query("commentId").optional().isString(),
  query("sprintId").optional().isString(),
  query("milestoneId").optional().isString(),
  query("entityType").optional().isString(),
  query("entityId").optional().isString(),
  validatorMiddleware,
];
