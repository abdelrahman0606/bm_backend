const { query, param } = require("express-validator");
const { ActivityEntityType, ActivityAction } = require("./activityEnums");

const getActivitiesValidator = [
  query("companyId")
    .notEmpty()
    .withMessage("companyId is required")
    .isString()
    .withMessage("companyId must be a string"),

  query("projectId")
    .optional()
    .isString()
    .withMessage("projectId must be a string"),

  query("issueId")
    .optional()
    .isString()
    .withMessage("issueId must be a string"),

  query("userId")
    .optional()
    .isString()
    .withMessage("userId must be a string"),

  query("entityType")
    .optional()
    .isIn(Object.values(ActivityEntityType))
    .withMessage(`entityType must be one of: ${Object.values(ActivityEntityType).join(", ")}`),

  query("action")
    .optional()
    .isIn(Object.values(ActivityAction))
    .withMessage(`action must be one of: ${Object.values(ActivityAction).join(", ")}`),

  query("startDate")
    .optional()
    .isISO8601()
    .withMessage("startDate must be a valid ISO 8601 date"),

  query("endDate")
    .optional()
    .isISO8601()
    .withMessage("endDate must be a valid ISO 8601 date"),

  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page must be an integer greater than 0"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be an integer between 1 and 100"),

  query("sort")
    .optional()
    .isString()
    .withMessage("sort must be a string"),
];

const getActivityByIdValidator = [
  param("id")
    .isMongoId()
    .withMessage("id must be a valid MongoDB ObjectId"),
];

module.exports = {
  getActivitiesValidator,
  getActivityByIdValidator,
};
