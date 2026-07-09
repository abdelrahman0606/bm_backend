const PriorityModel = require("../models/priorityModel");
const ApiError = require("../../../utils/apiError");

class PriorityService {
  static async createPriority(data) {
    try {
      const priority = await PriorityModel.create(data);
      return priority;
    } catch (error) {
      throw new ApiError(500, `Failed to create priority: ${error.message}`);
    }
  }

  static async getPriorities(filters) {
    try {
      const { workspaceId, page = 0, limit = 50, search } = filters;
      const query = { workspaceId };

      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = page * limit;
      const priorities = await PriorityModel.find(query)
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await PriorityModel.countDocuments(query);

      return {
        priorities,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch priorities: ${error.message}`);
    }
  }

  static async getPriorityById(priorityId) {
    try {
      const priority = await PriorityModel.findById(priorityId);
      if (!priority) {
        throw new ApiError(404, "Priority not found");
      }
      return priority;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch priority: ${error.message}`);
    }
  }

  static async updatePriority(priorityId, updateData) {
    try {
      const priority = await PriorityModel.findByIdAndUpdate(priorityId, updateData, { new: true, runValidators: true });
      if (!priority) {
        throw new ApiError(404, "Priority not found");
      }
      return priority;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update priority: ${error.message}`);
    }
  }

  static async deletePriority(priorityId) {
    try {
      const priority = await PriorityModel.findByIdAndDelete(priorityId);
      if (!priority) {
        throw new ApiError(404, "Priority not found");
      }
      return { message: "Priority deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete priority: ${error.message}`);
    }
  }
}

module.exports = PriorityService;
