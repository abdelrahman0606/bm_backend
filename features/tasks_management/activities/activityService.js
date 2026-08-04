const ActivityModel = require("./activityModel");
const ApiError = require("../../../utils/apiError");
const ProjectModel = require("../projects/projectModel");
const ProjectMemberModel = require("../projects/projectMemberModel");
const UserModel = require("../../users/userModel");
const socketManager = require("../../../infrastructure/realtime/socketManager");
const firebaseService = require("../../notifications/firebaseService");
const { EVENT_TYPES } = require("../../../core/events/eventTypes");
const NotificationModel = require("../../notifications/notificationModel");

class ActivityService {
  /**
   * Internal method to create an activity.
   * Other services will call this.
   *
   * @param {Object} data
   * @param {string} data.companyId
   * @param {string} data.projectId
   * @param {string} [data.issueId]
   * @param {string} data.userId
   * @param {string} data.action - ActivityAction enum
   * @param {string} data.entityType - ActivityEntityType enum
   * @param {string} data.entityId
   * @param {string} data.title
   * @param {string} [data.description]
   * @param {Object} [data.metadata]
   */
  static async createActivity(data) {
    try {
      const activity = await ActivityModel.create(data);
      const activityObj = activity.toObject();

      // Dispatch notifications to project members asynchronously
      if (data.projectId) {
        ProjectMemberModel.find({ projectId: data.projectId, userId: { $ne: data.userId } })
          .lean()
          .then(async (members) => {
            const project = await ProjectModel.findById(data.projectId).select("companyId").lean();
            const companyId = (data.companyId && data.companyId.toString().length === 24) ? data.companyId : (project ? project.companyId : null);

            for (const member of members) {
              const memberId = member.userId.toString();
              const isOnline = socketManager.getSocketCountForUser(memberId) > 0;

              let notifType = "general";
              if (data.action === "ASSIGN") notifType = "assignment";
              else if (data.action === "CHANGE_STATUS") notifType = "status_changed";

              let notificationObj = null;
              try {
                const notification = await NotificationModel.create({
                  companyId,
                  userId: memberId,
                  type: notifType,
                  title: data.title || "Task Update",
                  body: data.description || "A task was updated in your project",
                  createdBy: data.userId,
                  createdAt: activityObj.createdAt || new Date(),
                  updatedAt: activityObj.updatedAt || new Date(),
                  action: {
                    type: "issue",
                    entityId: data.issueId ? data.issueId.toString() : "unknown",
                    route: `/projects/${data.projectId}/issues/${data.issueId || ""}`
                  },
                  metadata: {
                    projectId: data.projectId ? data.projectId.toString() : "",
                    issueId: data.issueId ? data.issueId.toString() : "",
                    activityId: (activityObj.id || activityObj._id || "").toString()
                  }
                });
                notificationObj = notification.toObject();
              } catch (err) {
                console.error("Failed to create Notification in DB:", err);
                continue; // Skip if we can't create it
              }

              if (isOnline) {
                if (global.socketGateway) {
                  global.socketGateway.sendToUser(memberId, {
                    id: notificationObj.id || notificationObj._id.toString(),
                    type: EVENT_TYPES.NOTIFICATION,
                    action: notifType,
                    version: "1",
                    createdAt: new Date(notificationObj.createdAt || Date.now()).toISOString(),
                    payload: notificationObj
                  });
                }
              } else {
                const targetUser = await UserModel.findById(memberId).select("devicesTokens").lean();
                if (targetUser) {
                  const fcmTokens = targetUser.devicesTokens || [];

                  if (fcmTokens.length > 0) {
                    const payload = {
                      title: notificationObj.title,
                      body: notificationObj.body,
                      data: {
                        type: EVENT_TYPES.NOTIFICATION,
                        projectId: data.projectId.toString(),
                        issueId: data.issueId ? data.issueId.toString() : "",
                      },
                    };
                    firebaseService.sendToTokens(fcmTokens, payload).catch((err) =>
                      console.error("Async FCM push failed for task activity:", err)
                    );
                  }
                }
              }
            }
          })
          .catch((err) => console.error("Failed to process task activity notifications:", err));
      }

      return activityObj;
    } catch (error) {
      console.error("[ActivityService] Error creating activity:", error);
      // We don't necessarily want to throw and break the main action (e.g. creating a task)
      // just because logging the activity failed. So we just log the error internally.
      return null;
    }
  }

  /**
   * Return a paginated list of activities.
   */
  static async getActivities(filters, queryParams) {
    try {
      const {
        companyId,
        projectId,
        issueId,
        userId,
        entityType,
        action,
        startDate,
        endDate,
      } = filters;

      const page = parseInt(queryParams.page, 10) || 1;
      const limit = parseInt(queryParams.limit, 10) || 20;
      const sortQuery = queryParams.sort ? queryParams.sort : "-createdAt";

      const query = {};

      if (companyId) query.companyId = companyId;
      if (projectId) query.projectId = projectId;
      if (issueId) query.issueId = issueId;
      if (userId) query.userId = userId;
      if (entityType) query.entityType = entityType;
      if (action) query.action = action;

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;

      const [activities, total] = await Promise.all([
        ActivityModel.find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(limit)
          .exec()
          .then((docs) => docs.map((d) => d.toObject())),
        ActivityModel.countDocuments(query),
      ]);

      return {
        activities,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch activities: ${error.message}`, 500);
    }
  }

  /**
   * Return a single activity by ID
   */
  static async getActivityById(id) {
    try {
      const doc = await ActivityModel.findById(id);

      const activity = doc ? doc.toObject() : null;

      if (!activity) {
        throw new ApiError("Activity not found", 404);
      }

      return activity;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch activity: ${error.message}`, 500);
    }
  }
}

module.exports = ActivityService;
