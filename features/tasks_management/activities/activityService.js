const ActivityModel = require("./activityModel");
const ApiError = require("../../../utils/apiError");
const ProjectModel = require("../projects/projectModel");
// We can import UserModel from features/users/userModel if needed, but it's on a different DB connection.
// To keep it simple and performant, we might just return the IDs or fetch them in a batch if strictly required.
// For now, we will return the activities as they are, frontend usually resolves users via a cached map,
// but we will provide an explicit method if full population is demanded later.

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
      return activity.toObject();
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
