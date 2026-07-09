const express = require("express");
const { validationResult } = require("express-validator");
const CanvasConnectionService = require("../services/CanvasConnectionService");
const { createConnectionValidator } = require("../validators/canvasValidator");
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

// Create connection
router.post(
  "/",
  createConnectionValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const connection = await CanvasConnectionService.createConnection(
        req.body,
        userId
      );

      res.status(201).json({
        success: true,
        message: "Connection created successfully",
        data: connection,
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

// Get page connections
router.get("/page/:pageId", async (req, res) => {
  try {
    const connections = await CanvasConnectionService.getPageConnections(
      req.params.pageId
    );

    res.status(200).json({
      success: true,
      message: "Connections fetched successfully",
      data: connections,
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

// Delete connection
router.delete("/:connectionId", async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const connection = await CanvasConnectionService.deleteConnection(
      req.params.connectionId,
      userId
    );

    res.status(200).json({
      success: true,
      message: "Connection deleted successfully",
      data: connection,
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
