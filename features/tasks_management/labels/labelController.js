const LabelService = require("./labelService");

class LabelController {
  static async createLabel(req, res, next) {
    try {
      const label = await LabelService.createLabel(req.body);
      res.status(201).json({
        success: true,
        message: "Label created successfully",
        data: label,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getLabels(req, res, next) {
    try {
      const result = await LabelService.getLabels(req.query);
      res.status(200).json({
        success: true,
        message: "Labels fetched successfully",
        data: result.labels,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getLabel(req, res, next) {
    try {
      const label = await LabelService.getLabelById(req.params.labelId);
      res.status(200).json({
        success: true,
        message: "Label fetched successfully",
        data: label,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateLabel(req, res, next) {
    try {
      const label = await LabelService.updateLabel(req.params.labelId, req.body);
      res.status(200).json({
        success: true,
        message: "Label updated successfully",
        data: label,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteLabel(req, res, next) {
    try {
      const result = await LabelService.deleteLabel(req.params.labelId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = LabelController;
