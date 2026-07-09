const express = require("express");
const { validationResult } = require("express-validator");
const WorkspaceService = require("../services/WorkspaceService");
const {
  checkWorkspacePermission,
  canManageWorkspace,
  requireRole,
} = require("../middleware/canvasPermission");
const {
  createWorkspaceValidator,
  updateWorkspaceValidator,
} = require("../validators/canvasValidator");
const ApiError = require("../../../utils/apiError");

const router = express.Router();

// Middleware to check validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Create workspace
router.post("/", createWorkspaceValidator, handleValidationErrors, async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const workspace = await WorkspaceService.createWorkspace(req.body, userId);

    res.status(201).json({
      success: true,
      message: "Workspace created successfully",
      data: workspace,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get user workspaces
router.get("/user/all", async (req, res) => {
  try {
    const userId = req.user?.id || req.query.userId;
    const workspaces = await WorkspaceService.getUserWorkspaces(userId);

    res.status(200).json({
      success: true,
      message: "Workspaces fetched successfully",
      data: workspaces,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get workspace
router.get(
  "/:workspaceId",
  checkWorkspacePermission,
  async (req, res) => {
    try {
      const workspace = await WorkspaceService.getWorkspace(req.params.workspaceId);

      res.status(200).json({
        success: true,
        message: "Workspace fetched successfully",
        data: workspace,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Update workspace
router.put(
  "/:workspaceId",
  checkWorkspacePermission,
  canManageWorkspace,
  updateWorkspaceValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const workspace = await WorkspaceService.updateWorkspace(
        req.params.workspaceId,
        req.body,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Workspace updated successfully",
        data: workspace,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Delete workspace
router.delete(
  "/:workspaceId",
  checkWorkspacePermission,
  canManageWorkspace,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const workspace = await WorkspaceService.deleteWorkspace(
        req.params.workspaceId,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Workspace deleted successfully",
        data: workspace,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get workspace members
router.get(
  "/:workspaceId/members",
  checkWorkspacePermission,
  async (req, res) => {
    try {
      const members = await WorkspaceService.getMembers(req.params.workspaceId);

      res.status(200).json({
        success: true,
        message: "Members fetched successfully",
        data: members,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Add member to workspace
router.post(
  "/:workspaceId/members",
  checkWorkspacePermission,
  canManageWorkspace,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const { memberId, role } = req.body;

      const workspace = await WorkspaceService.addMember(
        req.params.workspaceId,
        memberId,
        role,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Member added successfully",
        data: workspace,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Remove member from workspace
router.delete(
  "/:workspaceId/members/:memberId",
  checkWorkspacePermission,
  canManageWorkspace,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const workspace = await WorkspaceService.removeMember(
        req.params.workspaceId,
        req.params.memberId,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Member removed successfully",
        data: workspace,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

module.exports = router;
