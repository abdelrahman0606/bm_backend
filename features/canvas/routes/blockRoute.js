const express = require("express");
const { validationResult } = require("express-validator");
const CanvasBlockService = require("../services/CanvasBlockService");
const {
  checkBlockPermission,
  canEdit,
  canDelete,
} = require("../middleware/canvasPermission");
const {
  createBlockValidator,
  updateBlockValidator,
  moveBlockValidator,
  resizeBlockValidator,
  convertBlockValidator,
  blockQueryValidator,
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

// Create block
router.post("/", createBlockValidator, handleValidationErrors, async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const result = await CanvasBlockService.createBlock(req.body, userId);

    res.status(201).json({
      success: true,
      message: "Block created successfully",
      data: result.block,
      metadata: result.metadata,
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

// Get blocks for page
router.get(
  "/page/:pageId",
  blockQueryValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { pageId } = req.params;
      const filters = {
        type: req.query.type,
        search: req.query.search,
        page: parseInt(req.query.page) || 0,
        limit: parseInt(req.query.limit) || 50,
      };

      const result = await CanvasBlockService.getPageBlocks(pageId, filters);

      res.status(200).json({
        success: true,
        message: "Blocks fetched successfully",
        data: result.blocks,
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
  }
);

// Get block
router.get("/:blockId", checkBlockPermission, async (req, res) => {
  try {
    const result = await CanvasBlockService.getBlock(req.params.blockId);

    res.status(200).json({
      success: true,
      message: "Block fetched successfully",
      data: result.block,
      metadata: result.metadata,
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

// Update block
router.put(
  "/:blockId",
  checkBlockPermission,
  canEdit,
  updateBlockValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const block = await CanvasBlockService.updateBlock(
        req.params.blockId,
        req.body,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Block updated successfully",
        data: block,
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

// Delete block
router.delete(
  "/:blockId",
  checkBlockPermission,
  canDelete,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const block = await CanvasBlockService.deleteBlock(req.params.blockId, userId);

      res.status(200).json({
        success: true,
        message: "Block deleted successfully",
        data: block,
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

// Move block
router.post(
  "/:blockId/move",
  checkBlockPermission,
  canEdit,
  moveBlockValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const { x, y } = req.body;
      const block = await CanvasBlockService.moveBlock(
        req.params.blockId,
        x,
        y,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Block moved successfully",
        data: block,
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

// Resize block
router.post(
  "/:blockId/resize",
  checkBlockPermission,
  canEdit,
  resizeBlockValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const { width, height } = req.body;
      const block = await CanvasBlockService.resizeBlock(
        req.params.blockId,
        width,
        height,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Block resized successfully",
        data: block,
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

// Convert block
router.post(
  "/:blockId/convert",
  checkBlockPermission,
  canEdit,
  convertBlockValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const { targetType } = req.body;
      const block = await CanvasBlockService.convertBlock(
        req.params.blockId,
        targetType,
        userId
      );

      res.status(200).json({
        success: true,
        message: "Block converted successfully",
        data: block,
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

// Archive block
router.post(
  "/:blockId/archive",
  checkBlockPermission,
  canEdit,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const block = await CanvasBlockService.archiveBlock(req.params.blockId, userId);

      res.status(200).json({
        success: true,
        message: "Block archived successfully",
        data: block,
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

// Duplicate block
router.post(
  "/:blockId/duplicate",
  checkBlockPermission,
  canEdit,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const block = await CanvasBlockService.duplicateBlock(req.params.blockId, userId);

      res.status(201).json({
        success: true,
        message: "Block duplicated successfully",
        data: block,
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

// Search blocks
router.get("/search/:workspaceId", async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const blocks = await CanvasBlockService.searchBlocks(workspaceId, q);

    res.status(200).json({
      success: true,
      message: "Blocks searched successfully",
      data: blocks,
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
