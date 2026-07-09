const express = require("express");
const { validationResult } = require("express-validator");
const StatusController = require("./statusController");
const {
  createStatusValidator,
  updateStatusValidator,
  getStatusValidator,
  deleteStatusValidator,
  listStatusValidator,
} = require("./statusValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post("/", createStatusValidator, handleValidationErrors, StatusController.createStatus);
router.get("/", listStatusValidator, handleValidationErrors, StatusController.getStatuses);
router.get("/:statusId", getStatusValidator, handleValidationErrors, StatusController.getStatus);
router.put("/:statusId", updateStatusValidator, handleValidationErrors, StatusController.updateStatus);
router.delete("/:statusId", deleteStatusValidator, handleValidationErrors, StatusController.deleteStatus);

module.exports = router;
