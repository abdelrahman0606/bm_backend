const StatusService = require("./statusService");

class StatusController {
  static async createStatus(req, res, next) {
    try {
      const status = await StatusService.createStatus(req.body, req.userId);
      res.status(201).json({
        status: "success",
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getStatuses(req, res, next) {
    try {
      const filters = {
        companyId: req.query.companyId,
        projectId: req.query.projectId,
        statusType: req.query.statusType,
      };

      const result = await StatusService.getStatuses(filters, req.query);

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getStatusById(req, res, next) {
    try {
      const status = await StatusService.getStatusById(req.params.id);
      res.status(200).json({
        status: "success",
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateStatus(req, res, next) {
    try {
      const status = await StatusService.updateStatus(req.params.id, req.body, req.userId);
      res.status(200).json({
        status: "success",
        data: status,
      });
    } catch (error) {
      next(error);
    }
  }

  static async reorderStatuses(req, res, next) {
    try {
      const { projectId, orderedIds } = req.body;
      const result = await StatusService.reorderStatuses(projectId, orderedIds, req.userId);
      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteStatus(req, res, next) {
    try {
      const result = await StatusService.deleteStatus(req.params.id, req.userId);
      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = StatusController;
