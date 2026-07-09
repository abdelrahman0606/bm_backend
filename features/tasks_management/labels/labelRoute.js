const express = require("express");
const { validationResult } = require("express-validator");
const LabelController = require("./labelController");
const {
  createLabelValidator,
  updateLabelValidator,
  getLabelValidator,
  deleteLabelValidator,
  listLabelValidator,
} = require("./labelValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post("/", createLabelValidator, handleValidationErrors, LabelController.createLabel);
router.get("/", listLabelValidator, handleValidationErrors, LabelController.getLabels);
router.get("/:labelId", getLabelValidator, handleValidationErrors, LabelController.getLabel);
router.put("/:labelId", updateLabelValidator, handleValidationErrors, LabelController.updateLabel);
router.delete("/:labelId", deleteLabelValidator, handleValidationErrors, LabelController.deleteLabel);

module.exports = router;
