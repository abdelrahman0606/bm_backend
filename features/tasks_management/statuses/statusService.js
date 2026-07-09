const StatusModel = require("../models/statusModel");
const ApiError = require("../../../utils/apiError");

class StatusService {
  static async createStatus(data) {
    try {
      const status = await StatusModel.create(data);
      return status;
    } catch (error) {
      throw new ApiError(500, `Failed to create status: ${error.message}`);
    }
  }

  static async getStatuses(filters) {
    try {
      const { workspaceId, page = 0, limit = 50, search } = filters;
      const query = { workspaceId };

      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = page * limit;
      const statuses = await StatusModel.find(query)
        .sort({ order: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await StatusModel.countDocuments(query);

      return {
        statuses,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch statuses: ${error.message}`);
    }
  }

  static async getStatusById(statusId) {
    try {
      const status = await StatusModel.findById(statusId);
      if (!status) {
        throw new ApiError(404, "Status not found");
      }
      return status;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch status: ${error.message}`);
    }
  }

  static async updateStatus(statusId, updateData) {
    try {
      const status = await StatusModel.findByIdAndUpdate(statusId, updateData, { new: true, runValidators: true });
      if (!status) {
        throw new ApiError(404, "Status not found");
      }
      return status;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update status: ${error.message}`);
    }
  }

  static async deleteStatus(statusId) {
    try {
      const status = await StatusModel.findByIdAndDelete(statusId);
      if (!status) {
        throw new ApiError(404, "Status not found");
      }
      return { message: "Status deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete status: ${error.message}`);
    }
  }
}

module.exports = StatusService;
