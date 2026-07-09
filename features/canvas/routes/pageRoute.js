const express = require("express");
const { validationResult } = require("express-validator");
const CanvasPageService = require("../services/CanvasPageService");
const {
  checkPagePermission,
  canEdit,
  canDelete,
} = require("../middleware/canvasPermission");
const {
  createPageValidator,
  updatePageValidator,
  pageQueryValidator,
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

// Create page
router.post("/", createPageValidator, handleValidationErrors, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.body.userId;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required to create a page",
      });
    }

    const page = await CanvasPageService.createPage(req.body, userId);

    res.status(201).json({
      success: true,
      message: "Page created successfully",
      data: page,
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

// Get pages for project
router.get(
  "/project/:projectId",
  pageQueryValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { workspaceId } = req.query;

      const pages = await CanvasPageService.getProjectPages(projectId, workspaceId);

      res.status(200).json({
        success: true,
        message: "Pages fetched successfully",
        data: pages,
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

// Get page
router.get("/:pageId", checkPagePermission, async (req, res) => {
  try {
    const page = await CanvasPageService.getPage(req.params.pageId);

    res.status(200).json({
      success: true,
      message: "Page fetched successfully",
      data: page,
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

// Update page
router.put(
  "/:pageId",
  checkPagePermission,
  canEdit,
  updatePageValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const page = await CanvasPageService.updatePage(
        req.params.pageId,
        req.body,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Page updated successfully",
        data: page,
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

// Delete page
router.delete(
  "/:pageId",
  checkPagePermission,
  canDelete,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const page = await CanvasPageService.deletePage(req.params.pageId, userId);

      res.status(200).json({
        success: true,
        message: "Page deleted successfully",
        data: page,
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

// Archive page
router.post("/:pageId/archive", checkPagePermission, canEdit, async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const page = await CanvasPageService.archivePage(req.params.pageId, userId);

    res.status(200).json({
      success: true,
      message: "Page archived successfully",
      data: page,
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

// Toggle favorite
router.post("/:pageId/favorite", checkPagePermission, async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const page = await CanvasPageService.toggleFavorite(req.params.pageId, userId);

    res.status(200).json({
      success: true,
      message: "Favorite toggled successfully",
      data: page,
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

// Reorder pages
router.post("/project/:projectId/reorder", async (req, res) => {
  try {
    const { pageOrder } = req.body;
    await CanvasPageService.reorderPages(req.params.projectId, pageOrder);

    res.status(200).json({
      success: true,
      message: "Pages reordered successfully",
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
