/**
 * Notification Types
 */
const NotificationType = {
  ASSIGNMENT: "assignment",
  COMMENT: "comment",
  INVITATION: "invitation",
  TASK_COMPLETED: "task_completed",
  STATUS_CHANGED: "status_changed",
  FILE_UPLOAD: "file_upload",
  GENERAL: "general",
};

/**
 * Notification Priorities
 */
const NotificationPriority = {
  LOW: "low",
  NORMAL: "normal",
  HIGH: "high",
  URGENT: "urgent",
};

module.exports = {
  NotificationType,
  NotificationPriority,
  NotificationTypes: Object.values(NotificationType),
  NotificationPriorities: Object.values(NotificationPriority),
};
