const express = require("express");
const { validationResult } = require("express-validator");
const VersionController = require("./versionController");
const {
  createVersionValidator,
  updateVersionValidator,
  getVersionValidator,
  deleteVersionValidator,
  listVersionValidator,
} = require("./versionValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post("/", createVersionValidator, handleValidationErrors, VersionController.createVersion);
router.get("/", listVersionValidator, handleValidationErrors, VersionController.getVersions);
router.get("/:versionId", getVersionValidator, handleValidationErrors, VersionController.getVersion);
router.put("/:versionId", updateVersionValidator, handleValidationErrors, VersionController.updateVersion);
router.delete("/:versionId", deleteVersionValidator, handleValidationErrors, VersionController.deleteVersion);

module.exports = router;
