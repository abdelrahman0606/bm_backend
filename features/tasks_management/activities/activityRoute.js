const express = require("express");
const ActivityController = require("./activityController");
const {
  getActivitiesValidator,
  getActivityByIdValidator,
} = require("./activityValidator");
const validateResult = require("../../../middlewares/validatorMiddleware");

const router = express.Router({ mergeParams: true });

// Note: No POST/PUT/DELETE routes are exposed. Activities are strictly generated internally.

router.get(
  "/",
  getActivitiesValidator,
  validateResult,
  ActivityController.getActivities
);

router.get(
  "/:id",
  getActivityByIdValidator,
  validateResult,
  ActivityController.getActivityById
);

module.exports = router;
