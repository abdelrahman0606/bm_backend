const { check, param, query } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");
const { NotificationTypes, NotificationPriorities } = require("./notificationEnums");

exports.sendNotificationValidator = [
  check("userId").isMongoId().withMessage("Invalid target user ID format"),
  check("type")
    .isIn(NotificationTypes)
    .withMessage(`Type must be one of: ${NotificationTypes.join(", ")}`),
  check("priority")
    .optional()
    .isIn(NotificationPriorities)
    .withMessage(`Priority must be one of: ${NotificationPriorities.join(", ")}`),
  check("title").notEmpty().withMessage("Title is required"),
  check("body").notEmpty().withMessage("Body is required"),
  check("action").isObject().withMessage("Action object is required"),
  check("action.type").notEmpty().withMessage("Action type is required"),
  check("action.entityId").notEmpty().withMessage("Action entityId is required"),
  check("action.route").notEmpty().withMessage("Action route is required"),
  check("metadata").optional().isObject().withMessage("Metadata must be an object"),
  check("withDatabase").optional().isBoolean().withMessage("withDatabase must be a boolean"),
  // Note: companyId could be checked if required via the request body, assuming the caller sends it. 
  // It should be handled securely in the service layer or by auth middleware.
  validatorMiddleware,
];

exports.getNotificationsValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be a positive integer up to 100"),
  query("isRead").optional().isBoolean().withMessage("isRead must be a boolean"),
  query("type").optional().isIn(NotificationTypes).withMessage("Invalid type filter"),
  query("priority").optional().isIn(NotificationPriorities).withMessage("Invalid priority filter"),
  query("companyId").optional().isMongoId().withMessage("Invalid company ID format"),
  validatorMiddleware,
];

exports.notificationIdValidator = [
  param("id").isMongoId().withMessage("Invalid notification ID format"),
  validatorMiddleware,
];

exports.companyIdQueryValidator = [
  query("companyId").optional().isMongoId().withMessage("Invalid company ID format"),
  validatorMiddleware,
];
