const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { FileModel, FileSourceType } = require("./fileModel");
const ApiError = require("../../utils/apiError");
const { buildFileScope } = require("./utils/fileScopeBuilder");

class FileService {
  /**
   * Upload a file, save it to disk, and optionally save metadata to the database.
   *
   * @param {Object} file - The uploaded file object from multer
   * @param {String} id - The client-provided UUID
   * @param {Boolean} withDatabase - Whether to save to DB
   * @param {String} [entityType] - Type of entity the file belongs to (company, project, issue, comment, etc.)
   * @param {String} [entityId] - Associated entity ID
   * @returns {Object} The file metadata object
   */
  static async uploadFile(file, id, withDatabase, entityType, entityId) {
    try {
      if (!file) {
        throw new ApiError("No file provided", 400);
      }

      // Calculate SHA256
      const hash = crypto.createHash("sha256");
      hash.update(file.buffer);
      const sha256 = hash.digest("hex");

      // Save file to disk
      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      // Generate a unique physical filename just in case
      const physicalFileName = `${id}_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const filePath = path.join(uploadsDir, physicalFileName);

      fs.writeFileSync(filePath, file.buffer);

      // Create replica object
      const replica = {
        sourceType: FileSourceType.CLOUD,
        path: `uploads/${physicalFileName}`,
        connectionInfo: {},
        isAvailable: true,
        lastVerified: new Date(),
      };

      // Build hierarchical scope
      const scope = await buildFileScope(entityType, entityId);

      // Construct metadata
      const fileData = {
        _id: id,
        sha256,
        fileName: file.originalname,
        mimeType: file.mimetype,
        entityType: entityType || null,
        scope,
        size: file.size,
        replicas: [replica],
        customMetadata: {},
        // If not saving to DB, we must provide createdAt manually to the return object
        createdAt: new Date(), 
      };

      if (withDatabase) {
        // Ensure not already exists
        const existing = await FileModel.findById(id);
        if (existing) {
          throw new ApiError("File with this ID already exists", 409);
        }
        
        const fileDoc = await FileModel.create(fileData);
        return fileDoc.toObject();
      }
      
      return {
        id: fileData._id,
        sha256: fileData.sha256,
        fileName: fileData.fileName,
        mimeType: fileData.mimeType,
        entityType: fileData.entityType,
        scope: fileData.scope,
        size: fileData.size,
        replicas: fileData.replicas,
        customMetadata: fileData.customMetadata,
        createdAt: fileData.createdAt,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to upload file: ${error.message}`, 500);
    }
  }
  /**
   * Save a Telegram-uploaded file to the database
   */
  static async saveTelegramFileToDatabase(
    fileBuffer,
    originalName,
    mimeType,
    id,
    entityType,
    entityId,
    telegramPath,
    telegramFileId,
    fileSize,
    customMetadata
  ) {
    if (!id) {
      throw new ApiError("id is required when withDatabase is true", 400);
    }

    // Use empty buffer if no buffer provided (e.g. uploaded via URL)
    const buffer = fileBuffer || Buffer.from("no-buffer");

    const hash = crypto.createHash("sha256");
    hash.update(buffer);
    const sha256 = hash.digest("hex");

    const replica = {
      sourceType: FileSourceType.TELEGRAM,
      path: telegramPath || telegramFileId || "",
      connectionInfo: { fileId: telegramFileId },
      isAvailable: true,
      lastVerified: new Date(),
    };

    const scope = await buildFileScope(entityType, entityId);

    const fileData = {
      _id: id,
      sha256,
      fileName: originalName || "telegram_upload",
      mimeType: mimeType || "application/octet-stream",
      entityType: entityType || null,
      scope,
      size: fileSize || buffer.length,
      replicas: [replica],
      customMetadata: customMetadata || {},
    };

    const existing = await FileModel.findById(id);
    if (existing) {
      throw new ApiError("File with this ID already exists", 409);
    }

    const fileDoc = await FileModel.create(fileData);
    return fileDoc.toObject();
  }

  /**
   * Fetch files by scope.
   */
  static async getFiles(filters) {
    const query = {};
    
    // Convert direct query parameters into scope lookups
    if (filters.companyId) query["scope.company"] = filters.companyId;
    if (filters.projectId) query["scope.project"] = filters.projectId;
    if (filters.issueId) query["scope.issue"] = filters.issueId;
    if (filters.commentId) query["scope.comment"] = filters.commentId;
    if (filters.sprintId) query["scope.sprint"] = filters.sprintId;
    if (filters.milestoneId) query["scope.milestone"] = filters.milestoneId;
    
    // Exact entity match if provided explicitly via entityType/entityId parameters
    if (filters.entityType && filters.entityId) {
      query[`scope.${filters.entityType}`] = filters.entityId;
    } else if (filters.entityType) {
      query.entityType = filters.entityType;
    }

    const files = await FileModel.find(query).sort({ createdAt: -1 }).lean();
    
    // Map _id to id for lean output
    return files.map(file => {
      if (file._id) {
        file.id = file._id;
        delete file._id;
      }
      delete file.__v;
      return file;
    });
  }
}

module.exports = FileService;
