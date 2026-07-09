const express = require("express");
const CanvasActivityService = require("../services/CanvasActivityService");
const ApiError = require("../../../utils/apiError");

const router = express.Router();

// Get workspace activity
router.get("/workspace/:workspaceId", async (req, res) => {
  try {
    const { page = 0, limit = 50, days = 30 } = req.query;
    const result = await CanvasActivityService.getWorkspaceActivity(
      req.params.workspaceId,
      {
        page: parseInt(page),
        limit: parseInt(limit),
        days: parseInt(days),
      }
    );

    res.status(200).json({
      success: true,
      message: "Workspace activity fetched successfully",
      data: result.activities,
      pagination: result.pagination,
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

// Get project activity
router.get("/project/:projectId", async (req, res) => {
  try {
    const { page = 0, limit = 50, days = 30 } = req.query;
    const result = await CanvasActivityService.getProjectActivity(
      req.params.projectId,
      {
        page: parseInt(page),
        limit: parseInt(limit),
        days: parseInt(days),
      }
    );

    res.status(200).json({
      success: true,
      message: "Project activity fetched successfully",
      data: result.activities,
      pagination: result.pagination,
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

// Get page activity
router.get("/page/:pageId", async (req, res) => {
  try {
    const { page = 0, limit = 50, days = 30 } = req.query;
    const result = await CanvasActivityService.getPageActivity(
      req.params.pageId,
      {
        page: parseInt(page),
        limit: parseInt(limit),
        days: parseInt(days),
      }
    );

    res.status(200).json({
      success: true,
      message: "Page activity fetched successfully",
      data: result.activities,
      pagination: result.pagination,
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

// Get block activity
router.get("/block/:blockId", async (req, res) => {
  try {
    const { page = 0, limit = 50, days = 30 } = req.query;
    const result = await CanvasActivityService.getBlockActivity(
      req.params.blockId,
      {
        page: parseInt(page),
        limit: parseInt(limit),
        days: parseInt(days),
      }
    );

    res.status(200).json({
      success: true,
      message: "Block activity fetched successfully",
      data: result.activities,
      pagination: result.pagination,
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

// Get user activity
router.get("/user/:userId", async (req, res) => {
  try {
    const { page = 0, limit = 50, days = 30 } = req.query;
    const result = await CanvasActivityService.getUserActivity(
      req.params.userId,
      {
        page: parseInt(page),
        limit: parseInt(limit),
        days: parseInt(days),
      }
    );

    res.status(200).json({
      success: true,
      message: "User activity fetched successfully",
      data: result.activities,
      pagination: result.pagination,
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

// Get activity by action
router.get("/workspace/:workspaceId/action/:action", async (req, res) => {
  try {
    const { page = 0, limit = 50 } = req.query;
    const result = await CanvasActivityService.getActivityByAction(
      req.params.workspaceId,
      req.params.action,
      {
        page: parseInt(page),
        limit: parseInt(limit),
      }
    );

    res.status(200).json({
      success: true,
      message: "Activity fetched successfully",
      data: result.activities,
      pagination: result.pagination,
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

// Get activity stats
router.get("/workspace/:workspaceId/stats", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await CanvasActivityService.getActivityStats(
      req.params.workspaceId,
      parseInt(days)
    );

    res.status(200).json({
      success: true,
      message: "Activity stats fetched successfully",
      data: stats,
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

module.exports = router;
