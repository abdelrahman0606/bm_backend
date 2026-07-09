const express = require("express");
const multer = require("multer");
const {
  uploadPhoto,
  downloadPhoto,
  fetchImage,
  fetchVideo,
  getVideoInfo,
  downloadVideo,
  getUpdates,
  sendMessage,
  downloadFile,
  getChatImage,
  uploadVideo,
  uploadDocument,
} = require("./filesTelegramService");
const {
  uploadPhotoValidator,
  fetchImageValidator,
  fetchVideoValidator,
  getVideoInfoValidator,
  getUpdatesValidator,
  sendMessageValidator,
  downloadFileValidator,
  getChatImageValidator,
  uploadVideoValidator,
  uploadDocumentValidator,
} = require("./filesTelegramValidator");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

// Upload photo
// POST /api/v1/files-telegram/upload-photo
router.post(
  "/upload-photo",
  upload.single("file"),
  uploadPhotoValidator,
  uploadPhoto,
);

// Download photo
// GET /api/v1/files-telegram/download-photo
router.get("/download-photo", downloadPhoto);

// Fetch image and convert to bytes
// POST /api/v1/files-telegram/fetch-image
router.post("/fetch-image", fetchImageValidator, fetchImage);

// Fetch video without exposing token
// POST /api/v1/files-telegram/fetch-video
router.post("/fetch-video", fetchVideoValidator, fetchVideo);

// Get video information without downloading
// POST /api/v1/files-telegram/get-video-info
router.post("/get-video-info", getVideoInfoValidator, getVideoInfo);

// Download video via proxy
// GET /api/v1/files-telegram/download-video
router.get("/download-video", downloadVideo);

// Get updates from Telegram
// POST /api/v1/files-telegram/get-updates
router.post("/get-updates", getUpdatesValidator, getUpdates);

// Send message to specific chat
// POST /api/v1/files-telegram/send-message
router.post("/send-message", sendMessageValidator, sendMessage);

// Download file from proxyUrl and return as bytes
// POST /api/v1/files-telegram/download
router.post("/download", downloadFileValidator, downloadFile);

// Get chat photo/image
// POST /api/v1/files-telegram/get-chat-image
router.post("/get-chat-image", getChatImageValidator, getChatImage);

// Upload video
// POST /api/v1/files-telegram/upload-video
router.post(
  "/upload-video",
  upload.single("file"),
  uploadVideoValidator,
  uploadVideo,
);

// Upload document
// POST /api/v1/files-telegram/upload-document
router.post(
  "/upload-document",
  upload.single("file"),
  uploadDocumentValidator,
  uploadDocument,
);

// Generic file download endpoint
// GET /api/v1/files-v2
router.get("/", downloadPhoto);

module.exports = router;
