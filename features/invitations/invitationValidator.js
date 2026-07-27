const { body } = require("express-validator");

const validateCreateInvitation = [
  body("companyId").notEmpty().withMessage("companyId is required").isString(),
  body("type").notEmpty().withMessage("type is required").isString(),
  body("status").optional().isString(),
  body("role").notEmpty().withMessage("role is required").isString(),
  body("employeeType")
    .notEmpty()
    .withMessage("employeeType is required")
    .isIn([
      "internalEmployee",
      "remotelyPartTime",
      "remotelyFullTime",
      "freelancer",
      "visitor",
    ])
    .withMessage("Invalid employee type"),
  body("jobs").optional().isArray(),
  body("permissions").optional().isArray(),
  body("expiredAt")
    .notEmpty()
    .withMessage("expiredAt is required")
    .isISO8601()
    .toDate(),
];

const validateUpdateInvitation = [
  body("companyId").optional().isString(),
  body("type").optional().isString(),
  body("status").optional().isString(),
  body("role").optional().isString(),
  body("employeeType")
    .optional()
    .isIn([
      "internalEmployee",
      "remotelyPartTime",
      "remotelyFullTime",
      "freelancer",
      "visitor",
    ])
    .withMessage("Invalid employee type"),
  body("jobs").optional().isArray(),
  body("permissions").optional().isArray(),
  body("expiredAt").optional().isISO8601().toDate(),
];

const validateRegiCode = [
  body("registrationCode")
    .notEmpty()
    .withMessage("registrationCode is required")
    .isString(),
];

module.exports = {
  validateCreateInvitation,
  validateUpdateInvitation,
  validateRegiCode,
};
