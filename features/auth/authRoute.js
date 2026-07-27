const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();
const authService = require("./authService");
const {
  validateRegister,
  validateLogin,
  validateChangePassword,
  validateForgotPassword,
  validateResetPassword,
  validateRefreshToken,
  validateGoogleAuth,
} = require("./authValidator");
const {
  validatorMiddleware,
} = require("../../middlewares/validatorMiddleware");

const { verifyAuthToken } = require("../../middlewares/authMiddleware");
// Register
router.post(
  "/register",
  validateRegister,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const result = await authService.register(req.body);
      res.status(201).json({
        success: true,
        data: result,
        message: "User registered successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Login
router.post(
  "/login",
  validateLogin,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const result = await authService.login(email, password);
      res.status(200).json({
        success: true,
        data: result,
        message: "Logged in successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Google Auth
router.post(
  "/google",
  validateGoogleAuth,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const { idToken, authType, invitationCode } = req.body;
      const result = await authService.googleAuth(idToken, authType, invitationCode);
      res.status(200).json({
        success: true,
        data: result,
        message: "Google authentication successful",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Verify Token and Get User By Token
// Postman: POST /auth/verify
// Header: Authorization: Bearer <access_token>
router.post("/verify", async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const result = await authService.getUserByToken(token);
    res.status(200).json({
      success: true,
      data: result,
      message: "Token is valid",
    });
  } catch (error) {
    next(error);
  }
});

// Refresh Token
router.post(
  "/refresh",
  validateRefreshToken,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const { refresh_token: refreshToken } = req.body;
      const result = await authService.refreshToken(refreshToken);
      res.status(200).json({
        success: true,
        data: result,
        message: "Token refreshed successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Change Password
router.post(
  "/change-password",
  verifyAuthToken,
  validateChangePassword,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const { old_password: oldPassword, new_password: newPassword } = req.body;
      const result = await authService.changePassword(
        req.userId,
        oldPassword,
        newPassword,
      );
      res.status(200).json({
        success: true,
        data: result,
        message: "Password changed successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Forgot Password
router.post(
  "/forgot-password",
  validateForgotPassword,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const { email } = req.body;
      const result = await authService.forgotPassword(email);
      res.status(200).json({
        success: true,
        data: result,
        message: "Password reset link sent to email",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Reset Password
router.post(
  "/reset-password",
  validateResetPassword,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const { reset_token: resetToken, new_password: newPassword } = req.body;
      const result = await authService.resetPassword(resetToken, newPassword);
      res.status(200).json({
        success: true,
        data: result,
        message: "Password reset successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get Current User
router.get("/me", verifyAuthToken, async (req, res, next) => {
  try {
    const result = await authService.getCurrentUser(req.userId);
    res.status(200).json({
      success: true,
      data: result,
      message: "User fetched successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Logout
router.post("/logout", verifyAuthToken, async (req, res, next) => {
  try {
    const result = await authService.logout(req.userId);
    res.status(200).json({
      success: true,
      data: result,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
