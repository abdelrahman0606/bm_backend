const FileService = require("./fileService");

class FileController {
  /**
   * Upload file controller
   */
  static async uploadFile(req, res, next) {
    try {
      const { file } = req;
      const { id, entityType, entityId } = req.body;
      const withDatabase = String(req.body.withDatabase).toLowerCase() === "true";

      const fileData = await FileService.uploadFile(
        file,
        id,
        withDatabase,
        entityType,
        entityId
      );

      res.status(201).json({
        success: true,
        message: "File uploaded successfully",
        data: fileData,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get files by hierarchical scope
   */
  static async getFiles(req, res, next) {
    try {
      const files = await FileService.getFiles(req.query);

      res.status(200).json({
        success: true,
        message: "Files retrieved successfully",
        data: files,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = FileController;
