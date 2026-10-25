const express = require("express");

const router = express.Router();
const controller = require("./timeManagementDeviceUsageController");
const validator = require("./timeManagementDeviceUsageValidator");
const { validatorMiddleware } = require("../../middlewares/validatorMiddleware");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");
const { requireLocalMongoReady } = require("./timeManagementDatabaseGuard");

/**
 * Device usage synchronization and cross-device reporting.
 *
 * Separate from the Share Time routes on purpose: this is a device reporting
 * its own tracked usage to its owner's account, not a sharing relationship
 * with another user. Reports here aggregate the user's own devices, which is
 * what lets the mobile app show what the desktop recorded.
 */
router.use(verifyAuthToken);
// The usage lives in local MongoDB and is never served from Atlas.
router.use(requireLocalMongoReady);

// Upload a batch of per-device snapshots. Safe to retry with the same batchId.
router.post(
  "/sync",
  validator.validateDeviceUsageSync,
  validatorMiddleware,
  controller.syncDeviceUsage
);

// Re-read the acknowledgement of a batch whose response was lost.
router.get(
  "/sync/:batchId",
  validator.validateBatchId,
  validatorMiddleware,
  controller.getSyncAcknowledgement
);

// Aggregated usage across the user's devices, filtered and paginated server-side.
router.get(
  "/report",
  validator.validateAggregatedUsageQuery,
  validatorMiddleware,
  controller.getAggregatedUsage
);

module.exports = router;
