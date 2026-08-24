const express = require("express");
const WhatsAppController = require("./whatsapp.controller");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");

const router = express.Router();
const controller = new WhatsAppController();

router.use(express.json());

/**
 * GET /api/v1/whatsapp/profile
 * Returns the authenticated user's WhatsApp account info:
 * name, phone number, about/status, and profile avatar URL.
 */
router.get("/profile", verifyAuthToken, controller.getProfile.bind(controller));

/**
 * GET /api/v1/whatsapp/status
 * Returns login state. If not logged in, includes a QR code image (base64).
 */
router.get("/status", verifyAuthToken, controller.getStatus.bind(controller));

/**
 * GET /api/v1/whatsapp/chats?page=1&limit=20
 * Returns paginated chat list + currently selected chat.
 */
router.get("/chats", verifyAuthToken, controller.getChats.bind(controller));

/**
 * POST /api/v1/whatsapp/open-chat
 * Body: { "chatName": "Contact Name" }
 * Clicks the chat in the sidebar and returns its messages.
 * Each message includes: messageId, type, text, mediaThumbnail,
 * isMediaDownloaded, downloadButtonAvailable, sender, time, isFromMe, status.
 */
router.post("/open-chat", verifyAuthToken, controller.openChat.bind(controller));

/**
 * GET /api/v1/whatsapp/messages
 * Returns messages of the currently open chat (no navigation).
 */
router.get("/messages", verifyAuthToken, controller.getMessages.bind(controller));

/**
 * POST /api/v1/whatsapp/load-more-messages
 * Clicks the "load older messages" button and returns the updated message list.
 * No body required.
 */
router.post("/load-more-messages", verifyAuthToken, controller.loadMoreMessages.bind(controller));

/**
 * POST /api/v1/whatsapp/download-message
 * Body: { "messageId": "A5269A7519154BEF8544F3233AC7D8DC" }
 * Clicks the download button for a media message that hasn't been downloaded yet.
 */
router.post("/download-message", verifyAuthToken, controller.downloadMessage.bind(controller));

/**
 * POST /api/v1/whatsapp/get-media-data
 * Body: { "messageId": "..." }
 * Clicks download (if not already downloaded), waits for it to complete, and returns the full base64 mediaData.
 */
router.post("/get-media-data", verifyAuthToken, controller.getMediaData.bind(controller));

/**
 * GET /api/v1/whatsapp/qr-refresh
 * Reloads WhatsApp Web and returns a fresh QR code (they expire ~every 20s).
 */
router.get("/qr-refresh", verifyAuthToken, controller.refreshQr.bind(controller));

/**
 * POST /api/v1/whatsapp/logout
 * Body (optional): { "forceLogout": true }
 * Closes the browser session. forceLogout=true also clicks WA's logout button.
 */
router.post("/logout", verifyAuthToken, controller.logout.bind(controller));

module.exports = router;
