const WorkspaceModel = require("../models/workspaceModel");
const WorkspaceMemberModel = require("../models/workspaceMemberModel");
const ApiError = require("../../../utils/apiError");

class WorkspaceService {
  static async createWorkspace(data, ownerId) {
    try {
      const workspace = await WorkspaceModel.create({
        ...data,
        ownerId,
      });

      // Automatically add owner as an admin member
      await WorkspaceMemberModel.create({
        workspaceId: workspace._id,
        userId: ownerId,
        role: "Admin",
      });

      return workspace;
    } catch (error) {
      throw new ApiError(500, `Failed to create workspace: ${error.message}`);
    }
  }

  static async getWorkspaces(filters, ownerId) {
    try {
      const { page = 0, limit = 20, search } = filters;
      const query = { deletedAt: null };

      // Either owner or member
      const memberships = await WorkspaceMemberModel.find({ userId: ownerId });
      const workspaceIds = memberships.map(m => m.workspaceId);
      
      query._id = { $in: workspaceIds };

      if (search) {
        query.name = { $regex: search, $options: "i" };
      }

      const skip = page * limit;
      const workspaces = await WorkspaceModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await WorkspaceModel.countDocuments(query);

      return {
        workspaces,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch workspaces: ${error.message}`);
    }
  }

  static async getWorkspaceById(workspaceId, userId) {
    try {
      const workspace = await WorkspaceModel.findById(workspaceId);
      if (!workspace || workspace.deletedAt) {
        throw new ApiError(404, "Workspace not found");
      }

      const isMember = await WorkspaceMemberModel.exists({ workspaceId, userId });
      if (!isMember) {
        throw new ApiError(403, "Not authorized to access this workspace");
      }

      return workspace;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch workspace: ${error.message}`);
    }
  }

  static async updateWorkspace(workspaceId, updateData, userId) {
    try {
      const workspace = await WorkspaceModel.findById(workspaceId);
      if (!workspace || workspace.deletedAt) {
        throw new ApiError(404, "Workspace not found");
      }

      // Check permission
      const membership = await WorkspaceMemberModel.findOne({ workspaceId, userId });
      if (!membership || (membership.role !== "Admin" && membership.role !== "Owner")) {
        throw new ApiError(403, "Not authorized to update this workspace");
      }

      Object.assign(workspace, updateData);
      await workspace.save();
      return workspace;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update workspace: ${error.message}`);
    }
  }

  static async deleteWorkspace(workspaceId, userId) {
    try {
      const workspace = await WorkspaceModel.findById(workspaceId);
      if (!workspace || workspace.deletedAt) {
        throw new ApiError(404, "Workspace not found");
      }

      if (workspace.ownerId.toString() !== userId.toString()) {
        throw new ApiError(403, "Only the workspace owner can delete it");
      }

      workspace.deletedAt = new Date();
      await workspace.save();
      return workspace;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete workspace: ${error.message}`);
    }
  }

  static async addMember(workspaceId, memberData, adminId) {
    try {
      const membership = await WorkspaceMemberModel.findOne({ workspaceId, userId: adminId });
      if (!membership || (membership.role !== "Admin" && membership.role !== "Owner")) {
        throw new ApiError(403, "Not authorized to add members");
      }

      const existing = await WorkspaceMemberModel.findOne({ workspaceId, userId: memberData.userId });
      if (existing) {
        throw new ApiError(400, "User is already a member");
      }

      const newMember = await WorkspaceMemberModel.create({
        workspaceId,
        userId: memberData.userId,
        role: memberData.role || "Member",
      });

      return newMember;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to add member: ${error.message}`);
    }
  }

  static async getMembers(workspaceId, userId) {
    try {
      const isMember = await WorkspaceMemberModel.exists({ workspaceId, userId });
      if (!isMember) {
        throw new ApiError(403, "Not authorized to view members");
      }

      const members = await WorkspaceMemberModel.find({ workspaceId });
      return members;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to get members: ${error.message}`);
    }
  }

  static async removeMember(workspaceId, memberUserId, adminId) {
    try {
      const membership = await WorkspaceMemberModel.findOne({ workspaceId, userId: adminId });
      if (!membership || (membership.role !== "Admin" && membership.role !== "Owner")) {
        throw new ApiError(403, "Not authorized to remove members");
      }

      const result = await WorkspaceMemberModel.findOneAndDelete({ workspaceId, userId: memberUserId });
      if (!result) {
        throw new ApiError(404, "Member not found");
      }
      return { message: "Member removed successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to remove member: ${error.message}`);
    }
  }
}

module.exports = WorkspaceService;
