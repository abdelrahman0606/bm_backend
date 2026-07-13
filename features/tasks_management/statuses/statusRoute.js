const express = require("express");
const StatusController = require("./statusController");
const validateResult = require("../../../middlewares/validatorMiddleware");
const {
  createStatusValidator,
  updateStatusValidator,
  reorderStatusesValidator,
  getStatusesValidator,
  getStatusByIdValidator,
  deleteStatusValidator,
} = require("./statusValidator");

const router = express.Router({ mergeParams: true });

router.post(
  "/",
  createStatusValidator,
  validateResult,
  StatusController.createStatus
);

router.get(
  "/",
  getStatusesValidator,
  validateResult,
  StatusController.getStatuses
);

router.patch(
  "/reorder",
  reorderStatusesValidator,
  validateResult,
  StatusController.reorderStatuses
);

router.get(
  "/:id",
  getStatusByIdValidator,
  validateResult,
  StatusController.getStatusById
);

router.put(
  "/:id",
  updateStatusValidator,
  validateResult,
  StatusController.updateStatus
);

router.delete(
  "/:id",
  deleteStatusValidator,
  validateResult,
  StatusController.deleteStatus
);

module.exports = router;
