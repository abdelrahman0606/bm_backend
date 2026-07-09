const VersionModel = require("../models/versionModel");
const ApiError = require("../../../utils/apiError");

class VersionService {
  static async createVersion(data) {
    try {
      const version = await VersionModel.create(data);
      return version;
    } catch (error) {
      throw new ApiError(500, `Failed to create version: ${error.message}`);
    }
  }

  static async getVersions(filters) {
    try {
      const { projectId, page = 0, limit = 50, search } = filters;
      const query = { projectId };

      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = page * limit;
      const versions = await VersionModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await VersionModel.countDocuments(query);

      return {
        versions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch versions: ${error.message}`);
    }
  }

  static async getVersionById(versionId) {
    try {
      const version = await VersionModel.findById(versionId);
      if (!version) {
        throw new ApiError(404, "Version not found");
      }
      return version;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch version: ${error.message}`);
    }
  }

  static async updateVersion(versionId, updateData) {
    try {
      const version = await VersionModel.findByIdAndUpdate(versionId, updateData, { new: true, runValidators: true });
      if (!version) {
        throw new ApiError(404, "Version not found");
      }
      return version;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update version: ${error.message}`);
    }
  }

  static async deleteVersion(versionId) {
    try {
      const version = await VersionModel.findByIdAndDelete(versionId);
      if (!version) {
        throw new ApiError(404, "Version not found");
      }
      return { message: "Version deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete version: ${error.message}`);
    }
  }
}

module.exports = VersionService;
