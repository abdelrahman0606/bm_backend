const TimeLogModel = require("../models/timeLogModel");
const ApiError = require("../../../utils/apiError");

class TimeLogService {
  static async createTimeLog(data, userId) {
    try {
      const timeLog = await TimeLogModel.create({
        ...data,
        userId,
      });
      return timeLog;
    } catch (error) {
      throw new ApiError(500, `Failed to create time log: ${error.message}`);
    }
  }

  static async getTimeLogs(filters) {
    try {
      const { issueId, page = 0, limit = 50 } = filters;
      const query = { issueId };

      const skip = page * limit;
      const timeLogs = await TimeLogModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await TimeLogModel.countDocuments(query);

      return {
        timeLogs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch time logs: ${error.message}`);
    }
  }

  static async getTimeLogById(timeLogId) {
    try {
      const timeLog = await TimeLogModel.findById(timeLogId);
      if (!timeLog) {
        throw new ApiError(404, "Time log not found");
      }
      return timeLog;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch time log: ${error.message}`);
    }
  }

  static async updateTimeLog(timeLogId, updateData, userId) {
    try {
      const timeLog = await TimeLogModel.findById(timeLogId);
      if (!timeLog) {
        throw new ApiError(404, "Time log not found");
      }

      if (timeLog.userId.toString() !== userId.toString()) {
        throw new ApiError(403, "Only the creator can update this time log");
      }

      Object.assign(timeLog, updateData);
      await timeLog.save();
      return timeLog;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update time log: ${error.message}`);
    }
  }

  static async deleteTimeLog(timeLogId, userId) {
    try {
      const timeLog = await TimeLogModel.findById(timeLogId);
      if (!timeLog) {
        throw new ApiError(404, "Time log not found");
      }

      if (timeLog.userId.toString() !== userId.toString()) {
        throw new ApiError(403, "Only the creator can delete this time log");
      }

      await TimeLogModel.findByIdAndDelete(timeLogId);
      return { message: "Time log deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete time log: ${error.message}`);
    }
  }
}

module.exports = TimeLogService;
