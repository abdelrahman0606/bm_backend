const SprintService = require("./sprintService");

class SprintController {
  static async createSprint(req, res, next) {
    try {
      const sprint = await SprintService.createSprint(req.body);
      res.status(201).json({
        success: true,
        message: "Sprint created successfully",
        data: sprint,
      });
    } catch (error) {
      next(error);
    }
  }

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

  static async updateSprint(req, res, next) {
    try {
      const sprint = await SprintService.updateSprint(req.params.sprintId, req.body);
      res.status(200).json({
        success: true,
        message: "Sprint updated successfully",
        data: sprint,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteSprint(req, res, next) {
    try {
      const result = await SprintService.deleteSprint(req.params.sprintId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = SprintController;
