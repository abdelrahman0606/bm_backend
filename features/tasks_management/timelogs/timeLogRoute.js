const express = require("express");
const { validationResult } = require("express-validator");
const TimeLogController = require("./timeLogController");
const {
  createTimeLogValidator,
  updateTimeLogValidator,
  getTimeLogValidator,
  deleteTimeLogValidator,
  listTimeLogValidator,
} = require("./timeLogValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post("/", createTimeLogValidator, handleValidationErrors, TimeLogController.createTimeLog);
router.get("/", listTimeLogValidator, handleValidationErrors, TimeLogController.getTimeLogs);
router.get("/:timeLogId", getTimeLogValidator, handleValidationErrors, TimeLogController.getTimeLog);
router.put("/:timeLogId", updateTimeLogValidator, handleValidationErrors, TimeLogController.updateTimeLog);
router.delete("/:timeLogId", deleteTimeLogValidator, handleValidationErrors, TimeLogController.deleteTimeLog);

module.exports = router;
