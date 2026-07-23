const NotificationService = require("./notificationService");
const asyncHandler = require("express-async-handler");

class NotificationController {
  /**
   * @desc    Send a notification
   * @route   POST /api/v1/notifications/send
   * @access  Private
   */
  static sendNotification = asyncHandler(async (req, res, next) => {
    // Inject the logged-in user as the creator
    const data = {
      ...req.body,
      createdBy: req.userId,
    };

    const notification = await NotificationService.sendNotification(data);
    res.status(201).json({
      success: true,
      data: notification,
    });
  });

  /**
   * @desc    Get my notifications
   * @route   GET /api/v1/notifications
   * @access  Private
   */
  static getMyNotifications = asyncHandler(async (req, res, next) => {
    const result = await NotificationService.getMyNotifications(req.userId, req.query);
    res.status(200).json({
      success: true,
      ...result,
    });
  });

  /**
   * @desc    Mark a notification as read
   * @route   PATCH /api/v1/notifications/:id/read
   * @access  Private
   */
  static markAsRead = asyncHandler(async (req, res, next) => {
    const notification = await NotificationService.markAsRead(req.params.id, req.userId);
    res.status(200).json({
      success: true,
      data: notification,
    });
  });

  /**
   * @desc    Mark all notifications as read
   * @route   PATCH /api/v1/notifications/read-all
   * @access  Private
   */
  static markAllAsRead = asyncHandler(async (req, res, next) => {
    await NotificationService.markAllAsRead(req.userId, req.query.companyId);
    res.status(200).json({
      success: true,
      message: "All notifications marked as read",
    });
  });

  /**
   * @desc    Delete a notification
   * @route   DELETE /api/v1/notifications/:id
   * @access  Private
   */
  static deleteNotification = asyncHandler(async (req, res, next) => {
    await NotificationService.deleteNotification(req.params.id, req.userId);
    res.status(204).json({
      success: true,
    });
  });

  /**
   * @desc    Delete all read notifications
   * @route   DELETE /api/v1/notifications/read
   * @access  Private
   */
  static deleteAllRead = asyncHandler(async (req, res, next) => {
    await NotificationService.deleteAllReadNotifications(req.userId, req.query.companyId);
    res.status(204).json({
      success: true,
    });
  });
}

module.exports = NotificationController;
