const express = require("express");
const { validationResult } = require("express-validator");
const ComponentController = require("./componentController");
const {
  createComponentValidator,
  updateComponentValidator,
  getComponentValidator,
  deleteComponentValidator,
  listComponentValidator,
} = require("./componentValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post("/", createComponentValidator, handleValidationErrors, ComponentController.createComponent);
router.get("/", listComponentValidator, handleValidationErrors, ComponentController.getComponents);
router.get("/:componentId", getComponentValidator, handleValidationErrors, ComponentController.getComponent);
router.put("/:componentId", updateComponentValidator, handleValidationErrors, ComponentController.updateComponent);
router.delete("/:componentId", deleteComponentValidator, handleValidationErrors, ComponentController.deleteComponent);

module.exports = router;
