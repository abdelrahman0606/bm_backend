const FileService = require("./fileService");
const FilesTelegramService = require("./files_telegram/filesTelegramService");

class FileController {
  /**
   * Upload file controller
   */
  static async uploadFile(req, res, next) {
    try {
      const { file } = req;
      const { id } = req.body;
      const withDatabase = String(req.body.withDatabase).toLowerCase() === "true";

      let scope = {};

      if (req.body.scope) {
        try {
          scope = typeof req.body.scope === "string" ? JSON.parse(req.body.scope) : { ...req.body.scope };
        } catch (e) {
          // ignore parsing error or handle it
        }
      } else {
        // Handle multer flatten format: scope[issue] = "123"
        for (const key of Object.keys(req.body)) {
          const match = key.match(/^scope\[(.*?)\]$/);
          if (match && match[1]) {
            scope[match[1]] = req.body[key];
          }
        }
      }

      const source = req.body.source || "local";

      let fileData;
      if (source === "telegram") {
        fileData = await FilesTelegramService.uploadFileDirectly(
          file,
          id,
          withDatabase,
          scope
        );
      } else {
        fileData = await FileService.uploadFile(
          file,
          id,
          withDatabase,
          scope
        );
      }

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
      const result = await FileService.getFiles(req.query);

      res.status(200).json({
        success: true,
        message: "Files retrieved successfully",
        data: result.files,
        pagination: result.pagination
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload multiple files controller
   */
  static async uploadMultipleFiles(req, res, next) {
    try {
      const { files } = req;
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, message: "No files provided" });
      }

      let { ids } = req.body;
      const withDatabase = String(req.body.withDatabase).toLowerCase() === "true";

      // Parse ids if it's a stringified JSON array or comma separated string
      if (typeof ids === "string") {
        try { 
          ids = JSON.parse(ids); 
        } catch(e) { 
          ids = ids.split(",").map(id => id.trim()); 
        }
      }
      if (!Array.isArray(ids)) {
        ids = [ids];
      }

      if (ids.length !== files.length) {
        return res.status(400).json({ success: false, message: "Number of ids must match number of files" });
      }

      let scope = {};

      if (req.body.scope) {
        try {
          scope = typeof req.body.scope === "string" ? JSON.parse(req.body.scope) : { ...req.body.scope };
        } catch (e) {
          // ignore parsing error or handle it
        }
      } else {
        // Handle multer flatten format: scope[issue] = "123"
        for (const key of Object.keys(req.body)) {
          const match = key.match(/^scope\[(.*?)\]$/);
          if (match && match[1]) {
            scope[match[1]] = req.body[key];
          }
        }
      }

      const source = req.body.source || "local";

      const uploadedFiles = [];
      for (let i = 0; i < files.length; i++) {
        let fileData;
        if (source === "telegram") {
          fileData = await FilesTelegramService.uploadFileDirectly(
            files[i],
            ids[i],
            withDatabase,
            scope
          );
        } else {
          fileData = await FileService.uploadFile(
            files[i],
            ids[i],
            withDatabase,
            scope
          );
        }
        uploadedFiles.push(fileData);
      }

      res.status(201).json({
        success: true,
        message: "Files uploaded successfully",
        data: uploadedFiles,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = FileController;
