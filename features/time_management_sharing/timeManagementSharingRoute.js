const express = require("express");
const router = express.Router();
const controller = require("./timeManagementSharingController");
const validator = require("./timeManagementSharingValidator");
const { validatorMiddleware } = require("../../middlewares/validatorMiddleware");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");

// All time management sharing routes require authentication
router.use(verifyAuthToken);

// 1. Root Collection Routes
router.post(
  "/",
  validator.validateCreateShare,
  validatorMiddleware,
  controller.createShare
);
router.get("/", controller.getAllMyShares);

// 2. Specific Query & Filtering Routes (declared before parameterized :shareId routes)
router.get("/reports", validator.validateReportQuery, validatorMiddleware, controller.getReport);
router.get("/received", controller.getReceivedShares);
router.get("/sent", controller.getSentShares);
router.get("/user/:userId", controller.getSharesByUser);

// 3. Batch Synchronization Routes
router.post(
  "/sync",
  validator.validateSyncUsage,
  validatorMiddleware,
  controller.syncUsage
);
router.get(
  "/sync/:batchId",
  validator.validateBatchId,
  validatorMiddleware,
  controller.getSyncBatchStatus
);

// 4. Single Share Instance & Action Routes
router.get(
  "/:shareId",
  validator.validateShareId,
  validatorMiddleware,
  controller.getSingleShare
);

router.put(
  "/:shareId",
  validator.validateUpdateShare,
  validatorMiddleware,
  controller.updateShare
);

router.patch(
  "/:shareId",
  validator.validateUpdateShare,
  validatorMiddleware,
  controller.updateShare
);

// Sharing mode / automatic schedule of a saved configuration (owner only)
router.patch(
  "/:shareId/schedule",
  validator.validateUpdateSchedule,
  validatorMiddleware,
  controller.updateShareSchedule
);

// Manual sharing: the owner delivers the saved configuration now
router.post(
  "/:shareId/share-now",
  validator.validateShareNow,
  validatorMiddleware,
  controller.shareNow
);

// Deliveries of a configuration (owner, recipient, or authorized company user)
router.get(
  "/:shareId/deliveries",
  validator.validateShareId,
  validatorMiddleware,
  controller.getDeliveries
);

router.patch(
  "/:shareId/accept",
  validator.validateShareId,
  validatorMiddleware,
  controller.acceptShare
);

router.patch(
  "/:shareId/reject",
  validator.validateShareId,
  validatorMiddleware,
  controller.rejectShare
);

router.patch(
  "/:shareId/cancel",
  validator.validateShareId,
  validatorMiddleware,
  controller.cancelShare
);

router.patch(
  "/:shareId/revoke",
  validator.validateShareId,
  validatorMiddleware,
  controller.revokeShare
);

router.patch(
  "/:shareId/disconnect",
  validator.validateShareId,
  validatorMiddleware,
  controller.disconnectShare
);

router.post(
  "/:shareId/sync",
  validator.validateSyncUsage,
  validatorMiddleware,
  controller.syncUsage
);

module.exports = router;
