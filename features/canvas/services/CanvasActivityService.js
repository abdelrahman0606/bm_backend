const CanvasActivityModel = require("../models/CanvasActivityModel");
const ApiError = require("../../../utils/apiError");

class CanvasActivityService {
  // Get workspace activity
  static async getWorkspaceActivity(workspaceId, options = {}) {
    try {
      const { page = 0, limit = 50, days = 30 } = options;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = {
        workspaceId: workspaceId,
        createdAt: { $gte: startDate },
      };

      const totalActivities = await CanvasActivityModel.countDocuments(query);
      const activities = await CanvasActivityModel.find(query)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit);

      return {
        activities,
        pagination: {
          page,
          limit,
          total: totalActivities,
          pages: Math.ceil(totalActivities / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch workspace activity: ${error.message}`);
    }
  }

  // Get project activity
  static async getProjectActivity(projectId, options = {}) {
    try {
      const { page = 0, limit = 50, days = 30 } = options;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = {
        projectId: projectId,
        createdAt: { $gte: startDate },
      };

      const totalActivities = await CanvasActivityModel.countDocuments(query);
      const activities = await CanvasActivityModel.find(query)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit);

      return {
        activities,
        pagination: {
          page,
          limit,
          total: totalActivities,
          pages: Math.ceil(totalActivities / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch project activity: ${error.message}`);
    }
  }

  // Get page activity
  static async getPageActivity(pageId, options = {}) {
    try {
      const { page = 0, limit = 50, days = 30 } = options;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = {
        pageId: pageId,
        createdAt: { $gte: startDate },
      };

      const totalActivities = await CanvasActivityModel.countDocuments(query);
      const activities = await CanvasActivityModel.find(query)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit);

      return {
        activities,
        pagination: {
          page,
          limit,
          total: totalActivities,
          pages: Math.ceil(totalActivities / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch page activity: ${error.message}`);
    }
  }

  // Get block activity
  static async getBlockActivity(blockId, options = {}) {
    try {
      const { page = 0, limit = 50, days = 30 } = options;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = {
        blockId: blockId,
        createdAt: { $gte: startDate },
      };

      const totalActivities = await CanvasActivityModel.countDocuments(query);
      const activities = await CanvasActivityModel.find(query)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit);

      return {
        activities,
        pagination: {
          page,
          limit,
          total: totalActivities,
          pages: Math.ceil(totalActivities / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch block activity: ${error.message}`);
    }
  }

  // Get user activity
  static async getUserActivity(userId, options = {}) {
    try {
      const { page = 0, limit = 50, days = 30 } = options;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = {
        userId: userId,
        createdAt: { $gte: startDate },
      };

      const totalActivities = await CanvasActivityModel.countDocuments(query);
      const activities = await CanvasActivityModel.find(query)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit);

      return {
        activities,
        pagination: {
          page,
          limit,
          total: totalActivities,
          pages: Math.ceil(totalActivities / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch user activity: ${error.message}`);
    }
  }

  // Get activity by action type
  static async getActivityByAction(workspaceId, action, options = {}) {
    try {
      const { page = 0, limit = 50 } = options;

      const query = {
        workspaceId: workspaceId,
        action: action,
      };

      const totalActivities = await CanvasActivityModel.countDocuments(query);
      const activities = await CanvasActivityModel.find(query)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit);

      return {
        activities,
        pagination: {
          page,
          limit,
          total: totalActivities,
          pages: Math.ceil(totalActivities / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch activity by action: ${error.message}`);
    }
  }

  // Get activity stats
  static async getActivityStats(workspaceId, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const stats = await CanvasActivityModel.aggregate([
        {
          $match: {
            workspaceId: workspaceId,
            createdAt: { $gte: startDate },
          },
        },
        {
          $group: {
            _id: "$action",
            count: { $sum: 1 },
          },
        },
      ]);

      return stats;
    } catch (error) {
      throw new ApiError(500, `Failed to fetch activity stats: ${error.message}`);
    }
  }
}

module.exports = CanvasActivityService;
