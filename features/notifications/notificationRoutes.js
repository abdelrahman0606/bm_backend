const express = require("express");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");
const NotificationController = require("./notificationController");
const {
  sendNotificationValidator,
  getNotificationsValidator,
  notificationIdValidator,
  companyIdQueryValidator,
} = require("./notificationValidator");

const router = express.Router();

// All routes require authentication
router.use(verifyAuthToken);

router.post("/send", sendNotificationValidator, NotificationController.sendNotification);

router.get("/", getNotificationsValidator, NotificationController.getMyNotifications);

router.patch("/read-all", companyIdQueryValidator, NotificationController.markAllAsRead);

router.delete("/read", companyIdQueryValidator, NotificationController.deleteAllRead);

router.patch("/:id/read", notificationIdValidator, NotificationController.markAsRead);

router.delete("/:id", notificationIdValidator, NotificationController.deleteNotification);

module.exports = router;
