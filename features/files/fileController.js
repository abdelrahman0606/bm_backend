const FileService = require("./fileService");

class FileController {
  /**
   * Upload file controller
   */
  static async uploadFile(req, res, next) {
    try {
      const { file } = req;
      const { id, category, entityId } = req.body;
      const withDatabase = String(req.body.withDatabase).toLowerCase() === "true";

      const fileData = await FileService.uploadFile(
        file,
        id,
        withDatabase,
        category,
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
}

module.exports = FileController;
