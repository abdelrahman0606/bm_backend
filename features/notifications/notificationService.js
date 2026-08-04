const NotificationModel = require("./notificationModel");
const firebaseService = require("./firebaseService");
const UserModel = require("../users/userModel");
const ApiError = require("../../utils/apiError");

class NotificationService {
  /**
   * Send a notification
   */
  static async sendNotification(data) {
    const {
      companyId,
      userId,
      type,
      priority,
      title,
      body,
      image,
      icon,
      createdBy,
      action,
      metadata,
      withDatabase = true,
    } = data;

    const targetUser = await UserModel.findById(userId);
    if (!targetUser) {
      throw new ApiError("Target user not found", 404);
    }

    const sender = await UserModel.findById(createdBy);
    if (!sender) {
      throw new ApiError("Sender user not found", 404);
    }

    // Handle withDatabase optionally
    let notification;
    if (String(withDatabase).toLowerCase() !== "false") {
      // Create the notification in DB
      notification = await NotificationModel.create({
        companyId,
        userId,
        type,
        priority,
        title,
        body,
        image,
        icon,
        createdBy,
        action,
        metadata,
      });
    } else {
      // Construct an in-memory representation for FCM
      notification = {
        companyId,
        userId,
        type,
        priority,
        title,
        body,
        image,
        icon,
        createdBy,
        action,
        metadata,
        toObject: function () { return this; }
      };
    }

    // Send push notification if user has tokens
    const fcmTokens = targetUser.devicesTokens || [];

    if (fcmTokens.length > 0) {
      // Async dispatch to avoid blocking the API response
      firebaseService.sendToTokens(fcmTokens, notification.toObject()).catch((err) => {
        console.error("Async FCM push failed:", err);
      });
    }

    // Dispatch realtime websocket notification if gateway is initialized
    if (global.socketGateway) {
      global.socketGateway.sendToUser(targetUser.id || targetUser._id.toString(), "new_notification", {
        notification: notification.toObject ? notification.toObject() : notification
      });
    }

    return notification;
  }

  /**
   * Get user's notifications
   */
  static async getMyNotifications(userId, queryParams) {
    const { isRead, type, priority, companyId, page = 1, limit = 20 } = queryParams;

    const query = { userId };
    
    if (isRead !== undefined) query.isRead = isRead === "true";
    if (type) query.type = type;
    if (priority) query.priority = priority;
    if (companyId) query.companyId = companyId;

    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      NotificationModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate("createdBy", "fullName email photo")
        .exec(),
      NotificationModel.countDocuments(query),
    ]);

    return {
      notifications,
      total,
      page: parseInt(page, 10),
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * Mark a notification as read
   */
  static async markAsRead(notificationId, userId) {
    const notification = await NotificationModel.findOneAndUpdate(
      { _id: notificationId, userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      throw new ApiError("Notification not found or unauthorized", 404);
    }

    return notification;
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId, companyId) {
    const query = { userId, isRead: false };
    if (companyId) {
      query.companyId = companyId;
    }

    await NotificationModel.updateMany(
      query,
      { isRead: true, readAt: new Date() }
    );
  }

  /**
   * Delete a notification
   */
  static async deleteNotification(notificationId, userId) {
    const notification = await NotificationModel.findOneAndDelete({ _id: notificationId, userId });

    if (!notification) {
      throw new ApiError("Notification not found or unauthorized", 404);
    }
  }

  /**
   * Delete all read notifications for a user
   */
  static async deleteAllReadNotifications(userId, companyId) {
    const query = { userId, isRead: true };
    if (companyId) {
      query.companyId = companyId;
    }

    await NotificationModel.deleteMany(query);
  }
}

module.exports = NotificationService;
