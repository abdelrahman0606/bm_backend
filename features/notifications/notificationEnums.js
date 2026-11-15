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
  // Face registration approval. Three types rather than one, so a client can
  // route and style them differently without parsing the body text.
  FACE_REGISTRATION_REQUESTED: "face_registration_requested",
  FACE_REGISTRATION_APPROVED: "face_registration_approved",
  FACE_REGISTRATION_REJECTED: "face_registration_rejected",
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
