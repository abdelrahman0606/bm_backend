const ProjectService = require("./projectService");
const ApiError = require("../../../utils/apiError");

/**
 * ProjectController
 *
 * Lightweight — only handles:
 *   1. Extract validated params from req
 *   2. Delegate to ProjectService
 *   3. Return formatted response
 *
 * No business logic lives here.
 */
class ProjectController {
  // ── List ──────────────────────────────────────────────────────────────────

  static async getProjects(req, res, next) {
    try {
      const result = await ProjectService.getProjects(req.query);
      res.status(200).json({
        success: true,
        message: "Projects fetched successfully",
        result: result.projects.length,
        data: result.projects,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Single ────────────────────────────────────────────────────────────────

  static async getProject(req, res, next) {
    try {
      const project = await ProjectService.getProjectById(req.params.projectId);
      res.status(200).json({
        success: true,
        message: "Project fetched successfully",
        data: project,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  static async createProject(req, res, next) {
    try {
      const userId = req.user?.id;
      const project = await ProjectService.createProject(req.body, userId);
      res.status(201).json({
        success: true,
        message: "Project created successfully",
        data: project,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────

  static async updateProject(req, res, next) {
    try {
      const project = await ProjectService.updateProject(
        req.params.projectId,
        req.body
      );
      res.status(200).json({
        success: true,
        message: "Project updated successfully",
        data: project,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Archive ───────────────────────────────────────────────────────────────

  static async archiveProject(req, res, next) {
    try {
      const project = await ProjectService.archiveProject(req.params.projectId);
      res.status(200).json({
        success: true,
        message: "Project archived successfully",
        data: project,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Restore ───────────────────────────────────────────────────────────────

  static async restoreProject(req, res, next) {
    try {
      const project = await ProjectService.restoreProject(req.params.projectId);
      res.status(200).json({
        success: true,
        message: "Project restored successfully",
        data: project,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  static async deleteProject(req, res, next) {
    try {
      await ProjectService.deleteProject(req.params.projectId);
      res.status(200).json({
        success: true,
        message: "Project deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  static async getProjectStats(req, res, next) {
    try {
      const { companyId } = req.query;
      const stats = await ProjectService.getProjectStats(companyId);
      res.status(200).json({
        success: true,
        message: "Project statistics fetched successfully",
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  static async getProjectConfiguration(req, res, next) {
    try {
      const config = await ProjectService.getProjectConfiguration(
        req.params.projectId
      );
      res.status(200).json({
        success: true,
        message: "Project configuration fetched successfully",
        data: config,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateProjectConfiguration(req, res, next) {
    try {
      const config = await ProjectService.updateProjectConfiguration(
        req.params.projectId,
        req.body.settings
      );
      res.status(200).json({
        success: true,
        message: "Project configuration updated successfully",
        data: config,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ProjectController;
