const WorkspaceService = require("./workspaceService");

class WorkspaceController {
  static async createWorkspace(req, res, next) {
    try {
      const userId = req.user?.id || req.body.ownerId; // Fallback if no auth middleware
      const workspace = await WorkspaceService.createWorkspace(req.body, userId);
      res.status(201).json({
        success: true,
        message: "Workspace created successfully",
        data: workspace,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getWorkspaces(req, res, next) {
    try {
      const userId = req.user?.id;
      const result = await WorkspaceService.getWorkspaces(req.query, userId);
      res.status(200).json({
        success: true,
        message: "Workspaces fetched successfully",
        data: result.workspaces,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getWorkspace(req, res, next) {
    try {
      const userId = req.user?.id;
      const workspace = await WorkspaceService.getWorkspaceById(req.params.workspaceId, userId);
      res.status(200).json({
        success: true,
        message: "Workspace fetched successfully",
        data: workspace,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateWorkspace(req, res, next) {
    try {
      const userId = req.user?.id;
      const workspace = await WorkspaceService.updateWorkspace(req.params.workspaceId, req.body, userId);
      res.status(200).json({
        success: true,
        message: "Workspace updated successfully",
        data: workspace,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteWorkspace(req, res, next) {
    try {
      const userId = req.user?.id;
      const workspace = await WorkspaceService.deleteWorkspace(req.params.workspaceId, userId);
      res.status(200).json({
        success: true,
        message: "Workspace deleted successfully",
        data: workspace,
      });
    } catch (error) {
      next(error);
    }
  }

  static async addMember(req, res, next) {
    try {
      const userId = req.user?.id;
      const member = await WorkspaceService.addMember(req.params.workspaceId, req.body, userId);
      res.status(201).json({
        success: true,
        message: "Member added successfully",
        data: member,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getMembers(req, res, next) {
    try {
      const userId = req.user?.id;
      const members = await WorkspaceService.getMembers(req.params.workspaceId, userId);
      res.status(200).json({
        success: true,
        message: "Members fetched successfully",
        data: members,
      });
    } catch (error) {
      next(error);
    }
  }

  static async removeMember(req, res, next) {
    try {
      const userId = req.user?.id;
      const result = await WorkspaceService.removeMember(req.params.workspaceId, req.params.userId, userId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = WorkspaceController;
