const SprintModel = require("../models/sprintModel");
const ApiError = require("../../../utils/apiError");

class SprintService {
  static async createSprint(data) {
    try {
      if (new Date(data.startDate) >= new Date(data.endDate)) {
        throw new ApiError(400, "Start date must be before end date");
      }
      const sprint = await SprintModel.create(data);
      return sprint;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to create sprint: ${error.message}`);
    }
  }

  static async getSprints(filters) {
    try {
      const { projectId, boardId, page = 0, limit = 20, search } = filters;
      const query = { projectId };

      if (boardId) query.boardId = boardId;

      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = page * limit;
      const sprints = await SprintModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await SprintModel.countDocuments(query);

      return {
        sprints,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch sprints: ${error.message}`);
    }
  }

  static async getSprintById(sprintId) {
    try {
      const sprint = await SprintModel.findById(sprintId);
      if (!sprint) {
        throw new ApiError(404, "Sprint not found");
      }
      return sprint;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch sprint: ${error.message}`);
    }
  }

  static async updateSprint(sprintId, updateData) {
    try {
      if (updateData.startDate && updateData.endDate) {
        if (new Date(updateData.startDate) >= new Date(updateData.endDate)) {
          throw new ApiError(400, "Start date must be before end date");
        }
      }

      const sprint = await SprintModel.findByIdAndUpdate(sprintId, updateData, { new: true, runValidators: true });
      if (!sprint) {
        throw new ApiError(404, "Sprint not found");
      }
      return sprint;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update sprint: ${error.message}`);
    }
  }

  static async deleteSprint(sprintId) {
    try {
      const sprint = await SprintModel.findByIdAndDelete(sprintId);
      if (!sprint) {
        throw new ApiError(404, "Sprint not found");
      }
      return { message: "Sprint deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete sprint: ${error.message}`);
    }
  }
}

module.exports = SprintService;
