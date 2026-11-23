const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const ApiError = require("../../utils/apiError");
const Device = require("./deviceModel");
const EnrollmentToken = require("./deviceEnrollmentTokenModel");
const auditService = require("./deviceAuditService");
const policySigner = require("./policySigner");
const events = require("./deviceControlEvents");
const {
  ENROLLMENT_TOKEN_TTL_MINUTES,
  DEVICE_PLATFORMS,
} = require("./deviceControlConstants");

/**
 * Turning a code into a device with credentials of its own.
 *
 * Two different hashes here, for two different jobs. The enrollment token is
 * stored as SHA-256 because it has to be *found* by its value, and a bcrypt
 * hash cannot be looked up. The device secret is stored with bcrypt because
 * it is only ever *compared*, against a record already located by id, and
 * bcrypt is what makes a stolen database useless for impersonating a device.
 */

const _sha256 = (value) =>
  crypto.createHash("sha256").update(String(value), "utf8").digest("hex");

/** A URL-safe random string with 256 bits behind it. */
const _randomSecret = () => crypto.randomBytes(32).toString("base64url");

/**
 * Issues a one-time enrollment code for an employee's machine.
 *
 * The company and employee are fixed at issue time and the agent cannot
 * change them, so a code that leaks can only ever enroll a device into the
 * company it was cut for.
 */
const issueEnrollmentToken = async ({
  companyId,
  employeeId,
  deviceId = null,
  createdBy,
}) => {
  const token = _randomSecret();

  const record = await EnrollmentToken.create({
    companyId,
    employeeId,
    deviceId,
    tokenHash: _sha256(token),
    expiresAt: new Date(Date.now() + ENROLLMENT_TOKEN_TTL_MINUTES * 60 * 1000),
    createdBy,
  });

  await auditService.record({
    companyId,
    actorId: createdBy,
    actorKind: "user",
    action: "device.enrolled",
    targetType: "enrollmentToken",
    targetId: String(record._id),
    note: `Enrollment code issued for employee ${employeeId}`,
  });

  // The only time the plaintext exists. It is not stored and cannot be re-read.
  return { token, expiresAt: record.expiresAt, enrollmentTokenId: String(record._id) };
};

/**
 * Claims a code and hands the agent its credentials.
 *
 * The claim is made with a conditional update rather than a read followed by
 * a write: two agents racing on the same code would both pass a read-then-
 * check, and both would enroll. `findOneAndUpdate` with `usedAt: null` in the
 * filter lets exactly one of them win.
 */
const redeemEnrollmentToken = async ({
  token,
  name,
  platform,
  osVersion = "",
  agentVersion = "",
  timeManagementDeviceId = null,
  systemInfo = {},
}) => {
  if (!token) throw new ApiError("An enrollment code is required", 400);
  if (!DEVICE_PLATFORMS.includes(platform)) {
    throw new ApiError("Unsupported device platform", 400);
  }

  const claimed = await EnrollmentToken.findOneAndUpdate(
    { tokenHash: _sha256(token), usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  );

  if (!claimed) {
    // One message for "wrong", "already used" and "expired" on purpose: the
    // difference is only useful to somebody guessing codes.
    throw new ApiError("This enrollment code is not valid", 400);
  }

  const secret = _randomSecret();
  const secretHash = await bcrypt.hash(secret, 10);

  let device;
  if (claimed.deviceId) {
    // An administrator pre-created the record; the agent is filling it in.
    device = await Device.findOne({
      _id: claimed.deviceId,
      companyId: claimed.companyId,
    });
    if (!device) throw new ApiError("The device for this code no longer exists", 404);

    device.set({
      name: name || device.name,
      platform,
      osVersion,
      agentVersion,
      systemInfo,
      timeManagementDeviceId,
      status: device.status === "blocked" ? "blocked" : "active",
      secretHash,
      credentialVersion: device.credentialVersion + 1,
      enrolledAt: new Date(),
      lastSeenAt: new Date(),
    });
    await device.save();
  } else {
    device = await Device.create({
      companyId: claimed.companyId,
      employeeId: claimed.employeeId,
      name: name || "Unnamed device",
      platform,
      osVersion,
      agentVersion,
      systemInfo,
      timeManagementDeviceId,
      status: "active",
      secretHash,
      credentialVersion: 1,
      enrolledAt: new Date(),
      lastSeenAt: new Date(),
      createdBy: claimed.createdBy,
    });
  }

  await EnrollmentToken.updateOne(
    { _id: claimed._id },
    { $set: { usedByDeviceId: String(device._id) } }
  );

  await auditService.record({
    companyId: device.companyId,
    actorId: String(device._id),
    actorKind: "device",
    action: "device.enrolled",
    targetType: "device",
    targetId: String(device._id),
    after: { name: device.name, platform: device.platform, status: device.status },
  });

  // Not awaited: the agent is waiting on its credentials, and a frame that
  // fails to go out must not turn a completed enrollment into an error.
  events.deviceEnrolled(device);

  return {
    deviceId: String(device._id),
    deviceSecret: secret,
    companyId: device.companyId,
    employeeId: device.employeeId,
    // Pinned by the agent and used to verify every policy from here on.
    policyPublicKey: policySigner.publicKeyPem(),
  };
};

/**
 * Checks a device's secret.
 *
 * Returns the device on success and null on any failure, so a caller cannot
 * accidentally distinguish "no such device" from "wrong secret" in a reply.
 */
const authenticateDevice = async (deviceId, secret) => {
  if (!deviceId || !secret) return null;

  const device = await Device.findById(deviceId).select("+secretHash");
  if (!device || !device.secretHash) return null;

  const matches = await bcrypt.compare(String(secret), device.secretHash);
  if (!matches) return null;

  return device;
};

module.exports = {
  issueEnrollmentToken,
  redeemEnrollmentToken,
  authenticateDevice,
};
