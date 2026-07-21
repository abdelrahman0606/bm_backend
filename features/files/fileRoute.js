const express = require("express");
const multer = require("multer");
const FileController = require("./fileController");
const { uploadFileValidator, getFilesValidator } = require("./fileValidator");

const router = express.Router();

// Configure multer for file uploads, storing in memory initially so we can calculate sha256
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit for generic files
  },
});

// GET /api/v1/files
router.get(
  "/",
  getFilesValidator,
  FileController.getFiles
);

// POST /api/v1/files/upload
router.post(
  "/upload",
  upload.single("file"),
  uploadFileValidator,
  FileController.uploadFile
);

module.exports = router;
