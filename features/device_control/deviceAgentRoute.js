const express = require("express");

const router = express.Router();
const controller = require("./deviceAgentController");
const validator = require("./deviceControlValidator");
const { validatorMiddleware } = require("../../middlewares/validatorMiddleware");
const { verifyDeviceToken } = require("./deviceAuthMiddleware");

/**
 * The Windows service's API. No user session is involved anywhere in it.
 *
 * `enroll` and `token` are unauthenticated by necessity — they are how a
 * machine acquires credentials in the first place — and are protected by
 * what they demand instead: a one-time code that expires, and a device
 * secret that was handed out exactly once.
 *
 * Everything after them carries a device token whose audience no user route
 * accepts, so the blast radius of a secret stolen from a laptop is these
 * three endpoints on that one device.
 */

router.post("/enroll", validator.validateEnroll, validatorMiddleware, controller.enroll);

router.post("/token", validator.validateDeviceToken, validatorMiddleware, controller.issueToken);

router.use(verifyDeviceToken);

router.get("/policy", controller.getPolicy);

router.post(
  "/enforcement",
  validator.validateEnforcementReport,
  validatorMiddleware,
  controller.reportEnforcement
);

router.post(
  "/heartbeat",
  validator.validateHeartbeat,
  validatorMiddleware,
  controller.heartbeat
);

module.exports = router;
