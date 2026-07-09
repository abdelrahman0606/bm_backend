const StatusService = require("./statusService");

class StatusController {
  static async createStatus(req, res, next) {
    try {
      const status = await StatusService.createStatus(req.body);
      res.status(201).json({
        success: true,
        message: "Status created successfully",
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getStatuses(req, res, next) {
    try {
      const result = await StatusService.getStatuses(req.query);
      res.status(200).json({
        success: true,
        message: "Statuses fetched successfully",
        data: result.statuses,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getStatus(req, res, next) {
    try {
      const status = await StatusService.getStatusById(req.params.statusId);
      res.status(200).json({
        success: true,
        message: "Status fetched successfully",
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req, res, next) {
    try {
      const status = await StatusService.updateStatus(req.params.statusId, req.body);
      res.status(200).json({
        success: true,
        message: "Status updated successfully",
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteStatus(req, res, next) {
    try {
      const result = await StatusService.deleteStatus(req.params.statusId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = StatusController;
