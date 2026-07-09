const { v4: uuidv4 } = require("uuid");
const CanvasConnectionModel = require("../models/CanvasConnectionModel");
const CanvasActivityModel = require("../models/CanvasActivityModel");
const ApiError = require("../../../utils/apiError");

class CanvasConnectionService {
  // Create connection
  static async createConnection(data, userId) {
    try {
      const connection = new CanvasConnectionModel({
        ...data,
        createdBy: userId,
      });

      await connection.save();

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: null,
        projectId: null,
        pageId: data.pageId,
        connectionId: connection._id.toString(),
        userId: userId,
        action: "connect",
        entityType: "connection",
        title: "Created connection",
      });

      return connection;
    } catch (error) {
      throw new ApiError(500, `Failed to create connection: ${error.message}`);
    }
  }

  // Get connections for page
  static async getPageConnections(pageId) {
    try {
      const connections = await CanvasConnectionModel.find({
        pageId: pageId,
        isDeleted: false,
      });

      return connections;
    } catch (error) {
      throw new ApiError(500, `Failed to fetch connections: ${error.message}`);
    }
  }

  // Delete connection
  static async deleteConnection(connectionId, userId) {
    try {
      const connection = await CanvasConnectionModel.findByIdAndUpdate(
        connectionId,
        { isDeleted: true, updatedAt: new Date() },
        { new: true }
      );

      if (!connection) {
        throw new ApiError(404, "Connection not found");
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: null,
        projectId: null,
        pageId: connection.pageId,
        connectionId: connectionId,
        userId: userId,
        action: "delete",
        entityType: "connection",
        title: "Deleted connection",
      });

      return connection;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete connection: ${error.message}`);
    }
  }
}

module.exports = CanvasConnectionService;
