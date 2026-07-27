const { body } = require("express-validator");

const validateRegister = [
  body("email")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .toLowerCase(),
  body("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain uppercase, lowercase and number"),
  body("fullName")
    .trim()
    .notEmpty()
    .withMessage("Full name is required")
    .isLength({ min: 2 })
    .withMessage("Full name must be at least 2 characters"),
  body("invitationCode")
    .notEmpty()
    .withMessage("Invitation code is required"),
  body("phone")
    .optional()
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),
];

const validateLogin = [
  body("email")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .toLowerCase(),
  body("password").notEmpty().withMessage("Password is required"),
];

const validateChangePassword = [
  body("old_password").notEmpty().withMessage("Current password is required"),
  body("new_password")
    .notEmpty()
    .withMessage("New password is required")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain uppercase, lowercase and number")
    .custom((value, { req }) => {
      if (value === req.body.old_password) {
        throw new Error("New password cannot be the same as old password");
      }
      return true;
    }),
  body("confirm_password")
    .notEmpty()
    .withMessage("Confirm password is required")
    .custom((value, { req }) => {
      if (value !== req.body.new_password) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),
];

const validateForgotPassword = [
  body("email")
    .isEmail()
    .withMessage("Please provide a valid email address")
    .toLowerCase(),
];

const validateResetPassword = [
  body("reset_token").notEmpty().withMessage("Reset token is required"),
  body("new_password")
    .notEmpty()
    .withMessage("New password is required")
    .isLength({ min: 6 })
    .withMessage("New password must be at least 6 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain uppercase, lowercase and number"),
  body("confirm_password")
    .notEmpty()
    .withMessage("Confirm password is required")
    .custom((value, { req }) => {
      if (value !== req.body.new_password) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),
];

const validateRefreshToken = [
  body("refresh_token").notEmpty().withMessage("Refresh token is required"),
];

const validateGoogleAuth = [
  body("idToken").notEmpty().withMessage("Google idToken is required"),
  body("authType").optional().isString(),
  body("invitationCode").optional().isString(),
];

module.exports = {
  validateRegister,
  validateLogin,
  validateChangePassword,
  validateForgotPassword,
  validateResetPassword,
  validateRefreshToken,
  validateGoogleAuth,
};
