const express = require("express");
const { validationResult } = require("express-validator");
const SprintController = require("./sprintController");
const {
  createSprintValidator,
  updateSprintValidator,
  getSprintValidator,
  deleteSprintValidator,
  listSprintValidator,
} = require("./sprintValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post("/", createSprintValidator, handleValidationErrors, SprintController.createSprint);
router.get("/", listSprintValidator, handleValidationErrors, SprintController.getSprints);
router.get("/:sprintId", getSprintValidator, handleValidationErrors, SprintController.getSprint);
router.put("/:sprintId", updateSprintValidator, handleValidationErrors, SprintController.updateSprint);
router.delete("/:sprintId", deleteSprintValidator, handleValidationErrors, SprintController.deleteSprint);

module.exports = router;
