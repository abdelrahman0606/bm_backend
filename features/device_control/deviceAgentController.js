const enrollmentService = require("./deviceEnrollmentService");
const policyService = require("./devicePolicyService");
const service = require("./deviceControlService");
const { issueDeviceToken } = require("./deviceAuthMiddleware");
const ApiError = require("../../utils/apiError");
const Device = require("./deviceModel");
const events = require("./deviceControlEvents");

/**
 * The five endpoints the Windows service talks to.
 *
 * Nothing here reads a user token, and nothing here accepts a company or
 * employee id from the body: the device's own record decides both. An agent
 * can therefore only ever fetch its own policy and report its own results,
 * no matter what it sends.
 */

/** Exchanges a one-time code for permanent device credentials. */
exports.enroll = async (req, res, next) => {
  try {
    const result = await enrollmentService.redeemEnrollmentToken({
      token: req.body.token,
      name: req.body.name,
      platform: req.body.platform,
      osVersion: req.body.osVersion,
      agentVersion: req.body.agentVersion,
      timeManagementDeviceId: req.body.timeManagementDeviceId || null,
      systemInfo: req.body.systemInfo || {},
    });
    res.status(201).json({ success: true, data: result, message: "Device enrolled" });
  } catch (error) {
    next(error);
  }
};

/**
 * Exchanges device credentials for a short-lived access token.
 *
 * A blocked device is refused here as well as at the token check, so a
 * blocked machine stops renewing within one token lifetime even if its
 * current token is still valid.
 */
exports.issueToken = async (req, res, next) => {
  try {
    const device = await enrollmentService.authenticateDevice(
      req.body.deviceId,
      req.body.deviceSecret
    );
    if (!device) return next(new ApiError("Invalid device credentials", 401));
    if (device.status === "blocked") return next(new ApiError("This device is blocked", 403));

    await Device.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } });

    return res.status(200).json({
      success: true,
      data: {
        token: issueDeviceToken(device),
        deviceId: String(device._id),
        companyId: device.companyId,
      },
      message: "Device token issued",
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * The signed policy this device should be enforcing.
 *
 * `204` means no policy is assigned, which the agent treats as "remove
 * everything you applied" — not as "nothing to do". The distinction matters
 * when a device is taken off a policy: its restrictions have to come off too.
 */
exports.getPolicy = async (req, res, next) => {
  try {
    const { device } = req;
    await Device.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } });

    const envelope = await policyService.signedPolicyFor(device);
    if (!envelope) return res.status(204).send();

    return res.status(200).json({
      success: true,
      data: envelope,
      message: "Policy fetched successfully",
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * What the operating system actually accepted.
 *
 * The device is taken from the verified token, so a report cannot be filed
 * against another machine.
 */
exports.reportEnforcement = async (req, res, next) => {
  try {
    const { device } = req;
    const { report, overall } = await service.recordEnforcement({
      device,
      policyId: req.body.policyId,
      policyVersion: Number(req.body.policyVersion),
      controls: req.body.controls || [],
      agentVersion: req.body.agentVersion || "",
      osVersion: req.body.osVersion || "",
    });

    res.status(201).json({
      success: true,
      data: { reportId: String(report._id), overall },
      message: "Enforcement recorded",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Liveness, plus the cheapest possible "is there anything new" check.
 *
 * The agent polls this far more often than it fetches a policy, so the reply
 * carries only the version it should be on. A matching version means the
 * agent does nothing at all.
 */
exports.heartbeat = async (req, res, next) => {
  try {
    const { device } = req;
    const now = new Date();

    // Read before the write: once `lastSeenAt` is overwritten there is no way
    // to tell a device that has been reporting all along from one that has
    // just come back after a day off.
    const previousLastSeenAt = device.lastSeenAt;

    const update = { lastSeenAt: now };
    if (req.body.agentVersion) update.agentVersion = req.body.agentVersion;
    if (req.body.osVersion) update.osVersion = req.body.osVersion;
    await Device.updateOne({ _id: device._id }, { $set: update });

    // Only published when the silence was long enough to have read as
    // offline, so an ordinary heartbeat costs no recipient lookup.
    events.deviceCameOnline({ device, previousLastSeenAt, now });

    const policy = await policyService.buildEffectivePolicy(device);

    res.status(200).json({
      success: true,
      data: {
        status: device.status,
        hasPolicy: Boolean(policy),
        effectiveVersion: policy ? policy.effectiveVersion : 0,
        appliedPolicyVersion: device.appliedPolicyVersion,
      },
      message: "Heartbeat recorded",
    });
  } catch (error) {
    next(error);
  }
};
