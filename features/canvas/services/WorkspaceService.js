const { v4: uuidv4 } = require("uuid");
const WorkspaceModel = require("../models/WorkspaceModel");
const CanvasPageModel = require("../models/CanvasPageModel");
const CanvasBlockModel = require("../models/CanvasBlockModel");
const CanvasActivityModel = require("../models/CanvasActivityModel");
const ApiError = require("../../../utils/apiError");

class WorkspaceService {
  // Create a new workspace
  static async createWorkspace(data, userId) {
    try {
      const workspace = new WorkspaceModel({
        ...data,
        ownerId: userId,
        members: [
          {
            userId: userId,
            role: "owner",
          },
        ],
      });

      await workspace.save();

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: workspace._id.toString(),
        projectId: null,
        userId: userId,
        action: "create",
        entityType: "workspace",
        title: `Created workspace "${data.name}"`,
        isSystemAction: false,
      });

      return workspace;
    } catch (error) {
      throw new ApiError(500, `Failed to create workspace: ${error.message}`);
    }
  }

  // Get workspace by ID
  static async getWorkspace(workspaceId) {
    try {
      const workspace = await WorkspaceModel.findById(workspaceId);
      if (!workspace) {
        throw new ApiError(404, "Workspace not found");
      }
      return workspace;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch workspace: ${error.message}`);
    }
  }

  // Update workspace
  static async updateWorkspace(workspaceId, data, userId) {
    try {
      const workspace = await WorkspaceModel.findByIdAndUpdate(
        workspaceId,
        { ...data, updatedAt: new Date() },
        { new: true, runValidators: true }
      );

      if (!workspace) {
        throw new ApiError(404, "Workspace not found");
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: workspaceId,
        projectId: null,
        userId: userId,
        action: "update",
        entityType: "workspace",
        title: "Updated workspace",
        changes: {
          before: {},
          after: data,
        },
      });

      return workspace;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update workspace: ${error.message}`);
    }
  }

  // Delete workspace
  static async deleteWorkspace(workspaceId, userId) {
    try {
      const workspace = await WorkspaceModel.findByIdAndUpdate(
        workspaceId,
        { isDeleted: true, updatedAt: new Date() },
        { new: true }
      );

      if (!workspace) {
        throw new ApiError(404, "Workspace not found");
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: workspaceId,
        projectId: null,
        userId: userId,
        action: "delete",
        entityType: "workspace",
        title: "Deleted workspace",
      });

      return workspace;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete workspace: ${error.message}`);
    }
  }

  // Add member to workspace
  static async addMember(workspaceId, userId, role, addedBy) {
    try {
      const workspace = await WorkspaceModel.findById(workspaceId);
      if (!workspace) {
        throw new ApiError(404, "Workspace not found");
      }

      const memberExists = workspace.members.find((m) => m.userId === userId);
      if (memberExists) {
        throw new ApiError(400, "User is already a member of this workspace");
      }

      workspace.members.push({
        userId: userId,
        role: role,
      });

      await workspace.save();

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: workspaceId,
        projectId: null,
        userId: addedBy,
        action: "update",
        entityType: "workspace",
        title: `Added member with ${role} role`,
      });

      return workspace;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to add member: ${error.message}`);
    }
  }

  // Remove member from workspace
  static async removeMember(workspaceId, userId, removedBy) {
    try {
      const workspace = await WorkspaceModel.findByIdAndUpdate(
        workspaceId,
        { $pull: { members: { userId: userId } }, updatedAt: new Date() },
        { new: true }
      );

      if (!workspace) {
        throw new ApiError(404, "Workspace not found");
      }

      // Log activity
      await CanvasActivityModel.create({
        workspaceId: workspaceId,
        projectId: null,
        userId: removedBy,
        action: "update",
        entityType: "workspace",
        title: "Removed member",
      });

      return workspace;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to remove member: ${error.message}`);
    }
  }

  // Get workspace members
  static async getMembers(workspaceId) {
    try {
      const workspace = await WorkspaceModel.findById(workspaceId);
      if (!workspace) {
        throw new ApiError(404, "Workspace not found");
      }
      return workspace.members;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch members: ${error.message}`);
    }
  }

  // Get user workspaces
  static async getUserWorkspaces(userId) {
    try {
      const workspaces = await WorkspaceModel.find({
        $or: [
          { ownerId: userId },
          { "members.userId": userId },
        ],
        isDeleted: false,
      });

      return workspaces;
    } catch (error) {
      throw new ApiError(500, `Failed to fetch workspaces: ${error.message}`);
    }
  }
}

module.exports = WorkspaceService;
