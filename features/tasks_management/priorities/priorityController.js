const PriorityService = require("./priorityService");

class PriorityController {
  static async createPriority(req, res, next) {
    try {
      const priority = await PriorityService.createPriority(req.body);
      res.status(201).json({
        success: true,
        message: "Priority created successfully",
        data: priority,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getPriorities(req, res, next) {
    try {
      const result = await PriorityService.getPriorities(req.query);
      res.status(200).json({
        success: true,
        message: "Priorities fetched successfully",
        data: result.priorities,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getPriority(req, res, next) {
    try {
      const priority = await PriorityService.getPriorityById(req.params.priorityId);
      res.status(200).json({
        success: true,
        message: "Priority fetched successfully",
        data: priority,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updatePriority(req, res, next) {
    try {
      const priority = await PriorityService.updatePriority(req.params.priorityId, req.body);
      res.status(200).json({
        success: true,
        message: "Priority updated successfully",
        data: priority,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deletePriority(req, res, next) {
    try {
      const result = await PriorityService.deletePriority(req.params.priorityId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = PriorityController;
