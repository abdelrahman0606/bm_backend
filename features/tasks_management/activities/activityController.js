const ActivityService = require("./activityService");

class ActivityController {
  static async getActivities(req, res, next) {
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
      } = req.query;

      const filters = {
        companyId,
        projectId,
        issueId,
        userId,
        entityType,
        action,
        startDate,
        endDate,
      };

      const result = await ActivityService.getActivities(filters, req.query);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getActivityById(req, res, next) {
    try {
      const activity = await ActivityService.getActivityById(req.params.id);

      res.status(200).json({
        status: "success",
        data: activity,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ActivityController;
