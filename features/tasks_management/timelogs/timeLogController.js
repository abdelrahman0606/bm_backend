const TimeLogService = require("./timeLogService");

class TimeLogController {
  static async createTimeLog(req, res, next) {
    try {
      const userId = req.user?.id || req.body.userId;
      const timeLog = await TimeLogService.createTimeLog(req.body, userId);
      res.status(201).json({
        success: true,
        message: "Time log created successfully",
        data: timeLog,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getTimeLogs(req, res, next) {
    try {
      const result = await TimeLogService.getTimeLogs(req.query);
      res.status(200).json({
        success: true,
        message: "Time logs fetched successfully",
        data: result.timeLogs,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getTimeLog(req, res, next) {
    try {
      const timeLog = await TimeLogService.getTimeLogById(req.params.timeLogId);
      res.status(200).json({
        success: true,
        message: "Time log fetched successfully",
        data: timeLog,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateTimeLog(req, res, next) {
    try {
      const userId = req.user?.id;
      const timeLog = await TimeLogService.updateTimeLog(req.params.timeLogId, req.body, userId);
      res.status(200).json({
        success: true,
        message: "Time log updated successfully",
        data: timeLog,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteTimeLog(req, res, next) {
    try {
      const userId = req.user?.id;
      const result = await TimeLogService.deleteTimeLog(req.params.timeLogId, userId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = TimeLogController;
