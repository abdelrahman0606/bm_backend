const express = require("express");
const { validationResult } = require("express-validator");
const CanvasCommentService = require("../services/CanvasCommentService");
const {
  createCommentValidator,
  updateCommentValidator,
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

// Create comment
router.post(
  "/block/:blockId",
  createCommentValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const comment = await CanvasCommentService.createComment(
        req.params.blockId,
        req.body,
        userId
      );

      res.status(201).json({
        success: true,
        message: "Comment created successfully",
        data: comment,
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

// Get block comments
router.get("/block/:blockId", async (req, res) => {
  try {
    const comments = await CanvasCommentService.getBlockComments(
      req.params.blockId
    );

    res.status(200).json({
      success: true,
      message: "Comments fetched successfully",
      data: comments,
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

// Update comment
router.put(
  "/:commentId",
  updateCommentValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { message } = req.body;
      const comment = await CanvasCommentService.updateComment(
        req.params.commentId,
        message
      );

      res.status(200).json({
        success: true,
        message: "Comment updated successfully",
        data: comment,
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

// Delete comment
router.delete("/:commentId", async (req, res) => {
  try {
    const comment = await CanvasCommentService.deleteComment(req.params.commentId);

    res.status(200).json({
      success: true,
      message: "Comment deleted successfully",
      data: comment,
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

// Add reply
router.post("/:commentId/reply", async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const { message } = req.body;

    const comment = await CanvasCommentService.addReply(
      req.params.commentId,
      userId,
      message
    );

    res.status(200).json({
      success: true,
      message: "Reply added successfully",
      data: comment,
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

// Pin comment
router.post("/:commentId/pin", async (req, res) => {
  try {
    const comment = await CanvasCommentService.pinComment(req.params.commentId);

    res.status(200).json({
      success: true,
      message: "Comment pinned successfully",
      data: comment,
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

// Resolve comment
router.post("/:commentId/resolve", async (req, res) => {
  try {
    const comment = await CanvasCommentService.resolveComment(
      req.params.commentId
    );

    res.status(200).json({
      success: true,
      message: "Comment resolved successfully",
      data: comment,
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

// Add reaction
router.post("/:commentId/reaction", async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const { emoji } = req.body;

    const comment = await CanvasCommentService.addReaction(
      req.params.commentId,
      emoji,
      userId
    );

    res.status(200).json({
      success: true,
      message: "Reaction added successfully",
      data: comment,
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

// Remove reaction
router.delete("/:commentId/reaction/:emoji", async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const comment = await CanvasCommentService.removeReaction(
      req.params.commentId,
      req.params.emoji,
      userId
    );

    res.status(200).json({
      success: true,
      message: "Reaction removed successfully",
      data: comment,
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
