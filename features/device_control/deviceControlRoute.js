const express = require("express");

const router = express.Router();
const controller = require("./deviceControlController");
const validator = require("./deviceControlValidator");
const { validatorMiddleware } = require("../../middlewares/validatorMiddleware");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");
const {
  attachActor,
  actorOf,
  requirePermission,
} = require("../../core/access/accessMiddleware");
const { scopeEnforced } = require("../../core/access/accessConfig");
const engine = require("../../core/access/permissionEngine");
const ApiError = require("../../utils/apiError");

/**
 * The console and employee API.
 *
 * Two tiers of route live here, and the split is the point:
 *
 *  - `/my/...` is a person looking at their own machines. It needs a session
 *    and nothing else, and is filtered by the id in the token.
 *  - everything else administers other people's devices and needs an
 *    explicit `device` or `devicePolicy` grant, checked server-side by the
 *    same engine the rest of the API uses.
 *
 * The employee routes are declared first so that `/my/devices` can never be
 * captured by `/devices/:id` and quietly fall under an admin permission gate.
 */
router.use(verifyAuthToken);
router.use(attachActor);

/**
 * The administrative gate, with a floor for the period before grants exist.
 *
 * The rest of the API stages entity-scope enforcement behind `ACCESS_ENFORCE`
 * because no account carries grants yet, and turning it on early would refuse
 * everybody. Device Control follows that switch — but it cannot follow the
 * usual `next()` fallback, because "no grants assigned yet" would then mean
 * every authenticated employee could block a colleague's laptop.
 *
 * So the fallback is the role chain instead: until grants are assigned, an
 * administrator or above administers devices. Once `ACCESS_ENFORCE` is on,
 * the explicit `device` and `devicePolicy` grants decide, exactly like every
 * other resource.
 */
const gate = (resource, action, options) => (req, res, next) => {
  if (scopeEnforced()) return requirePermission(resource, action, options)(req, res, next);

  const actor = actorOf(req);
  if (!actor.isAuthenticated) {
    return next(new ApiError("Authentication required", 401));
  }
  if (!engine.isAtLeast(actor.role, "admin")) {
    return next(
      new ApiError("Only administrators can manage device control", 403)
    );
  }
  return next();
};

// ──────────────────────────── Employee's own view ──────────────────────────

router.get("/my/devices", controller.myDevices);
router.get("/my/requests", controller.myRequests);
router.post(
  "/my/requests",
  validator.validateCreateRequest,
  validatorMiddleware,
  controller.createRequest
);
router.post(
  "/my/requests/:id/cancel",
  validator.validateDeviceId,
  validatorMiddleware,
  controller.cancelRequest
);

// ───────────────────────────────── Dashboard ───────────────────────────────

router.get("/summary", gate("device", "view"), controller.getSummary);

// ───────────────────────────────── Devices ─────────────────────────────────

router.get(
  "/devices",
  gate("device", "view"),
  validator.validateListing,
  validatorMiddleware,
  controller.listDevices
);

router.post(
  "/devices",
  gate("device", "create"),
  validator.validateCreateDevice,
  validatorMiddleware,
  controller.createDevice
);

router.get(
  "/devices/:id",
  gate("device", "view"),
  validator.validateDeviceId,
  validatorMiddleware,
  controller.getDevice
);

router.patch(
  "/devices/:id",
  gate("device", "update"),
  validator.validateUpdateDevice,
  validatorMiddleware,
  controller.updateDevice
);

router.post(
  "/devices/:id/status",
  gate("device", "update"),
  validator.validateDeviceStatus,
  validatorMiddleware,
  controller.setDeviceStatus
);

router.post(
  "/devices/:id/enrollment-token",
  gate("device", "update"),
  validator.validateDeviceId,
  validatorMiddleware,
  controller.issueEnrollmentToken
);

// ───────────────────────────────── Policies ────────────────────────────────

router.get(
  "/policies",
  gate("devicePolicy", "view"),
  validator.validateListing,
  validatorMiddleware,
  controller.listPolicies
);

router.post(
  "/policies",
  gate("devicePolicy", "create"),
  validator.validateCreatePolicy,
  validatorMiddleware,
  controller.createPolicy
);

router.get(
  "/policies/:id",
  gate("devicePolicy", "view"),
  validator.validateDeviceId,
  validatorMiddleware,
  controller.getPolicy
);

router.put(
  "/policies/:id",
  gate("devicePolicy", "update"),
  validator.validateUpdatePolicy,
  validatorMiddleware,
  controller.updatePolicy
);

router.delete(
  "/policies/:id",
  gate("devicePolicy", "delete"),
  validator.validateDeviceId,
  validatorMiddleware,
  controller.deletePolicy
);

router.post(
  "/policies/:id/assign",
  gate("devicePolicy", "update"),
  validator.validateAssignPolicy,
  validatorMiddleware,
  controller.assignPolicy
);

router.delete(
  "/assignments/:assignmentId",
  gate("devicePolicy", "update"),
  controller.unassignPolicy
);

// ────────────────────────────── Access requests ────────────────────────────

router.get(
  "/requests",
  gate("device", "view"),
  validator.validateListing,
  validatorMiddleware,
  controller.listRequests
);

router.post(
  "/requests/:id/approve",
  gate("device", "update"),
  validator.validateDecision,
  validatorMiddleware,
  controller.approveRequest
);

router.post(
  "/requests/:id/reject",
  gate("device", "update"),
  validator.validateDecision,
  validatorMiddleware,
  controller.rejectRequest
);

// ─────────────────────────────── Exceptions ────────────────────────────────

router.get("/exceptions", gate("device", "view"), controller.listExceptions);

router.post(
  "/exceptions/:id/revoke",
  gate("device", "update"),
  validator.validateDeviceId,
  validatorMiddleware,
  controller.revokeException
);

// ─────────────────────────────────  Audit  ─────────────────────────────────

router.get(
  "/audit",
  gate("device", "view"),
  validator.validateListing,
  validatorMiddleware,
  controller.listAudit
);

module.exports = router;
