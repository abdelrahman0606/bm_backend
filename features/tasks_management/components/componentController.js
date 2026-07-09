const ComponentService = require("./componentService");

class ComponentController {
  static async createComponent(req, res, next) {
    try {
      const component = await ComponentService.createComponent(req.body);
      res.status(201).json({
        success: true,
        message: "Component created successfully",
        data: component,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getComponents(req, res, next) {
    try {
      const result = await ComponentService.getComponents(req.query);
      res.status(200).json({
        success: true,
        message: "Components fetched successfully",
        data: result.components,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getComponent(req, res, next) {
    try {
      const component = await ComponentService.getComponentById(req.params.componentId);
      res.status(200).json({
        success: true,
        message: "Component fetched successfully",
        data: component,
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateComponent(req, res, next) {
    try {
      const component = await ComponentService.updateComponent(req.params.componentId, req.body);
      res.status(200).json({
        success: true,
        message: "Component updated successfully",
        data: component,
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteComponent(req, res, next) {
    try {
      const result = await ComponentService.deleteComponent(req.params.componentId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = ComponentController;
