const ComponentModel = require("../models/componentModel");
const ApiError = require("../../../utils/apiError");

class ComponentService {
  static async createComponent(data) {
    try {
      const component = await ComponentModel.create(data);
      return component;
    } catch (error) {
      throw new ApiError(500, `Failed to create component: ${error.message}`);
    }
  }

  static async getComponents(filters) {
    try {
      const { projectId, page = 0, limit = 50, search } = filters;
      const query = { projectId };

      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = page * limit;
      const components = await ComponentModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await ComponentModel.countDocuments(query);

      return {
        components,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch components: ${error.message}`);
    }
  }

  static async getComponentById(componentId) {
    try {
      const component = await ComponentModel.findById(componentId);
      if (!component) {
        throw new ApiError(404, "Component not found");
      }
      return component;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch component: ${error.message}`);
    }
  }

  static async updateComponent(componentId, updateData) {
    try {
      const component = await ComponentModel.findByIdAndUpdate(componentId, updateData, { new: true, runValidators: true });
      if (!component) {
        throw new ApiError(404, "Component not found");
      }
      return component;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update component: ${error.message}`);
    }
  }

  static async deleteComponent(componentId) {
    try {
      const component = await ComponentModel.findByIdAndDelete(componentId);
      if (!component) {
        throw new ApiError(404, "Component not found");
      }
      return { message: "Component deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete component: ${error.message}`);
    }
  }
}

module.exports = ComponentService;
