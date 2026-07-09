const express = require("express");

const router = express.Router();
const userService = require("./userService");
const {
  validateUserCreate,
  validateUserUpdate,
  validateUserEmail,
} = require("./userValidator");
const {
  validatorMiddleware,
} = require("../../middlewares/validatorMiddleware");

// Create a new user
router.post(
  "/",
  validateUserCreate,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const user = await userService.createUser(req.body);
      res.status(201).json({
        success: true,
        data: user,
        message: "User created successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Get all users
router.get("/", async (req, res, next) => {
  try {
    const result = await userService.getAllUsers(req.query);
    res.status(200).json({
      success: true,
      data: result.users,
      pagination: result.pagination,
      message: "Users fetched successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Get user by ID
router.get("/:id", async (req, res, next) => {
  try {
    const user = await userService.getUserById(req.params.id);
    res.status(200).json({
      success: true,
      data: user,
      message: "User fetched successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Get user by email
router.get("/email/:email", async (req, res, next) => {
  try {
    const user = await userService.getUserByEmail(req.params.email);
    res.status(200).json({
      success: true,
      data: user,
      message: "User fetched successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Update user
router.put(
  "/:id",
  validateUserUpdate,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const user = await userService.updateUser(req.params.id, req.body);
      res.status(200).json({
        success: true,
        data: user,
        message: "User updated successfully",
      });
    } catch (error) {
      next(error);
    }
  },
);

// Delete user
router.delete("/:id", async (req, res, next) => {
  try {
    await userService.deleteUser(req.params.id);
    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Verify email
router.patch("/:id/verify-email", async (req, res, next) => {
  try {
    const user = await userService.verifyUserEmail(req.params.id);
    res.status(200).json({
      success: true,
      data: user,
      message: "Email verified successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Update user status
router.patch("/:id/status", async (req, res, next) => {
  try {
    const { status } = req.body;
    const user = await userService.updateUserStatus(req.params.id, status);
    res.status(200).json({
      success: true,
      data: user,
      message: "User status updated successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Update user role
router.patch("/:id/role", async (req, res, next) => {
  try {
    const { role } = req.body;
    const user = await userService.updateUserRole(req.params.id, role);
    res.status(200).json({
      success: true,
      data: user,
      message: "User role updated successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Check if email exists
router.post(
  "/check/email",
  validateUserEmail,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const exists = await userService.checkEmailExists(req.body.email);
      res.status(200).json({
        success: true,
        exists,
        message: "Email check completed",
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
