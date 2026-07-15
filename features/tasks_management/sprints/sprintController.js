const SprintService = require("./sprintService");

/**
 * SprintController
 *
 * Lightweight: extract validated params, delegate to SprintService, return response.
 * No business logic lives here.
 */
class SprintController {
  // ── Create ────────────────────────────────────────────────────────────────

  static async createSprint(req, res, next) {
    try {
      const userId = req.user?.id || req.userId;
      const sprint = await SprintService.createSprint(req.body, userId);
      res.status(201).json({
        success: true,
        message: "Sprint created successfully",
        data: sprint,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── List ──────────────────────────────────────────────────────────────────

  static async getSprints(req, res, next) {
    try {
      const result = await SprintService.getSprints(req.query);
      res.status(200).json({
        success: true,
        message: "Sprints fetched successfully",
        data: result.sprints,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Single ────────────────────────────────────────────────────────────────

  static async getSprint(req, res, next) {
    try {
      const sprint = await SprintService.getSprintById(req.params.sprintId);
      res.status(200).json({
        success: true,
        message: "Sprint fetched successfully",
        data: sprint,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────

  static async updateSprint(req, res, next) {
    try {
      const userId = req.user?.id || req.userId;
      const sprint = await SprintService.updateSprint(
        req.params.sprintId,
        req.body,
        userId
      );
      res.status(200).json({
        success: true,
        message: "Sprint updated successfully",
        data: sprint,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  static async deleteSprint(req, res, next) {
    try {
      const userId = req.user?.id || req.userId;
      await SprintService.deleteSprint(req.params.sprintId, userId);
      res.status(200).json({
        success: true,
        message: "Sprint deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Start Sprint ──────────────────────────────────────────────────────────

  static async startSprint(req, res, next) {
    try {
      const userId = req.user?.id || req.userId;
      const sprint = await SprintService.startSprint(req.params.sprintId, userId);
      res.status(200).json({
        success: true,
        message: "Sprint started successfully",
        data: sprint,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Complete Sprint ───────────────────────────────────────────────────────

  static async completeSprint(req, res, next) {
    try {
      const userId = req.user?.id || req.userId;
      const sprint = await SprintService.completeSprint(req.params.sprintId, userId);
      res.status(200).json({
        success: true,
        message: "Sprint completed successfully",
        data: sprint,
      });
    } catch (error) {
      next(error);
    }
  }

  // ── Reorder Sprints ───────────────────────────────────────────────────────

  static async reorderSprints(req, res, next) {
    try {
      const userId = req.user?.id || req.userId;
      const { projectId, orderedItems } = req.body;
      const sprints = await SprintService.reorderSprints(projectId, orderedItems, userId);
      res.status(200).json({
        success: true,
        message: "Sprints reordered successfully",
        data: sprints,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SprintController;
