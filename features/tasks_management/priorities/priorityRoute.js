const express = require("express");
const { validationResult } = require("express-validator");
const PriorityController = require("./priorityController");
const {
  createPriorityValidator,
  updatePriorityValidator,
  getPriorityValidator,
  deletePriorityValidator,
  listPriorityValidator,
} = require("./priorityValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post("/", createPriorityValidator, handleValidationErrors, PriorityController.createPriority);
router.get("/", listPriorityValidator, handleValidationErrors, PriorityController.getPriorities);
router.get("/:priorityId", getPriorityValidator, handleValidationErrors, PriorityController.getPriority);
router.put("/:priorityId", updatePriorityValidator, handleValidationErrors, PriorityController.updatePriority);
router.delete("/:priorityId", deletePriorityValidator, handleValidationErrors, PriorityController.deletePriority);

module.exports = router;
