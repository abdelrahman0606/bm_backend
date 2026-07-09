const LabelModel = require("../models/labelModel");
const ApiError = require("../../../utils/apiError");

class LabelService {
  static async createLabel(data) {
    try {
      const label = await LabelModel.create(data);
      return label;
    } catch (error) {
      throw new ApiError(500, `Failed to create label: ${error.message}`);
    }
  }

  static async getLabels(filters) {
    try {
      const { workspaceId, page = 0, limit = 50, search } = filters;
      const query = { workspaceId };

      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = page * limit;
      const labels = await LabelModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await LabelModel.countDocuments(query);

      return {
        labels,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch labels: ${error.message}`);
    }
  }

  static async getLabelById(labelId) {
    try {
      const label = await LabelModel.findById(labelId);
      if (!label) {
        throw new ApiError(404, "Label not found");
      }
      return label;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch label: ${error.message}`);
    }
  }

  static async updateLabel(labelId, updateData) {
    try {
      const label = await LabelModel.findByIdAndUpdate(labelId, updateData, { new: true, runValidators: true });
      if (!label) {
        throw new ApiError(404, "Label not found");
      }
      return label;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update label: ${error.message}`);
    }
  }

  static async deleteLabel(labelId) {
    try {
      const label = await LabelModel.findByIdAndDelete(labelId);
      if (!label) {
        throw new ApiError(404, "Label not found");
      }
      return { message: "Label deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete label: ${error.message}`);
    }
  }
}

module.exports = LabelService;
