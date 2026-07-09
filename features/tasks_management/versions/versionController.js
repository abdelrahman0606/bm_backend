const VersionService = require("./versionService");

class VersionController {
  static async createVersion(req, res, next) {
    try {
      const version = await VersionService.createVersion(req.body);
      res.status(201).json({
        success: true,
        message: "Version created successfully",
        data: version,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getVersions(req, res, next) {
    try {
      const result = await VersionService.getVersions(req.query);
      res.status(200).json({
        success: true,
        message: "Versions fetched successfully",
        data: result.versions,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getVersion(req, res, next) {
    try {
      const version = await VersionService.getVersionById(req.params.versionId);
      res.status(200).json({
        success: true,
        message: "Version fetched successfully",
        data: version,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateVersion(req, res, next) {
    try {
      const version = await VersionService.updateVersion(req.params.versionId, req.body);
      res.status(200).json({
        success: true,
        message: "Version updated successfully",
        data: version,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteVersion(req, res, next) {
    try {
      const result = await VersionService.deleteVersion(req.params.versionId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = VersionController;
