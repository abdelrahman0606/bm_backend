const { body, validationResult } = require("express-validator");

const validateUserCreate = [
  body("id").notEmpty().withMessage("id is required"),
  body("email").isEmail().withMessage("Please provide a valid email address"),
  body("fullName")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 2 })
    .withMessage("Full name must be at least 2 characters"),
  body("phone")
    .notEmpty()
    .withMessage("Phone is required")
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
  body("type")
    .notEmpty()
    .withMessage("Type is required")
    .isIn(["guest", "personal", "business"])
    .withMessage("Invalid type"),
  body("role")
    .notEmpty()
    .withMessage("Role is required")
    .isIn([
      "master",
      "admin",
      "manager",
      "supervisor",
      "departmentHead",
      "senior",
      "midLevel",
      "junior",
      "trainer",
    ])
    .withMessage("Invalid role"),
  body("status")
    .optional()
    .isIn(["active", "inactive", "blocked", "pending"])
    .withMessage("Invalid status"),
  body("isMale").optional().isBoolean().withMessage("isMale must be a boolean"),
  body("birthday")
    .notEmpty()
    .withMessage("Birthday is required")
    .isISO8601()
    .withMessage("birthday must be a valid date"),
  body("relation").notEmpty().withMessage("Relation is required").isString(),
  body("address").optional().isString().withMessage("address must be a string"),
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
  body("jobs")
    .optional()
    .isArray()
    .withMessage("jobs must be an array"),
  body("rate").optional().isNumeric().withMessage("rate must be a number"),
];

const validateUserUpdate = [
  body("fullName")
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage("Full name must be at least 2 characters"),
  body("phone")
    .optional()
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),
  body("bio")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Bio must be less than 500 characters"),
  body("type")
    .optional()
    .isIn(["guest", "personal", "business"])
    .withMessage("Invalid type"),
  body("role")
    .optional()
    .isIn([
      "master",
      "admin",
      "manager",
      "supervisor",
      "departmentHead",
      "senior",
      "midLevel",
      "junior",
      "trainer",
    ])
    .withMessage("Invalid role"),
  body("status")
    .optional()
    .isIn(["active", "inactive", "blocked", "pending"])
    .withMessage("Invalid status"),
  body("isMale").optional().isBoolean().withMessage("isMale must be a boolean"),
  body("birthday")
    .optional()
    .isISO8601()
    .withMessage("birthday must be a valid date"),
  body("address").optional().isString().withMessage("address must be a string"),
  body("relation").optional().isString(),
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
  body("jobs")
    .optional()
    .isArray()
    .withMessage("jobs must be an array"),
  body("rate").optional().isNumeric().withMessage("rate must be a number"),
];

const validateUserEmail = [
  body("email").isEmail().withMessage("Please provide a valid email address"),
];

module.exports = {
  validateUserCreate,
  validateUserUpdate,
  validateUserEmail,
};
