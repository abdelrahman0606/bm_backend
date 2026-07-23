const NotificationService = require("./notificationService");

class NotificationHelper {
  /**
   * Helper function to send notification from any other service.
   * Takes care of error catching so other features do not crash.
   * 
   * @param {Object} data 
   * @param {String} data.companyId
   * @param {String} data.userId
   * @param {String} data.type
   * @param {String} data.priority
   * @param {String} data.title
   * @param {String} data.body
   * @param {String} [data.image]
   * @param {String} [data.icon]
   * @param {String} data.createdBy
   * @param {Object} data.action
   * @param {Object} [data.metadata]
   * @returns 
   */
  static async send(data) {
    try {
      return await NotificationService.sendNotification(data);
    } catch (error) {
      console.error("NotificationHelper.send failed:", error.message);
      // Return null rather than throwing so the main process (e.g., issue creation) isn't interrupted
      return null;
    }
  }
}

module.exports = NotificationHelper;
