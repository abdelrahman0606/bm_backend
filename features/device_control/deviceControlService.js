const ApiError = require("../../utils/apiError");
const Device = require("./deviceModel");
const Policy = require("./devicePolicyModel");
const Assignment = require("./policyAssignmentModel");
const Exception = require("./policyExceptionModel");
const AccessRequest = require("./accessRequestModel");
const EnforcementReport = require("./enforcementReportModel");
const auditService = require("./deviceAuditService");
const policyService = require("./devicePolicyService");
const events = require("./deviceControlEvents");

/**
 * Device and policy administration.
 *
 * Every function takes the company id the caller was resolved to and uses it
 * in the filter, never in the response only. A missing companyId in a query
 * here is how one company reads another's devices, so there is no code path
 * that queries these collections without it.
 */

const POLICY_SECTION_KEYS = [
  "applicationControl",
  "websiteControl",
  "fileTransferControl",
  "usbControl",
  "systemRestrictions",
];

// ───────────────────────────────── Devices ─────────────────────────────────

const listDevices = async ({ companyId, status, employeeId, limit = 100, skip = 0 }) => {
  const filter = { companyId };
  if (status) filter.status = status;
  if (employeeId) filter.employeeId = employeeId;

  const [devices, total] = await Promise.all([
    Device.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Math.min(limit, 500)),
    Device.countDocuments(filter),
  ]);

  return { devices, total };
};

const getDevice = async (companyId, deviceId) => {
  const device = await Device.findOne({ _id: deviceId, companyId });
  if (!device) throw new ApiError("Device not found", 404);
  return device;
};

/**
 * Pre-creates a device record so an administrator can assign a policy before
 * the machine has ever connected.
 *
 * It starts `pending` and holds no secret: it becomes a real principal only
 * when an agent redeems an enrollment code against it.
 */
const createDevice = async ({ companyId, employeeId, name, platform, createdBy }) => {
  const device = await Device.create({
    companyId,
    employeeId,
    name,
    platform,
    status: "pending",
    createdBy,
  });

  await auditService.record({
    companyId,
    actorId: createdBy,
    actorKind: "user",
    action: "device.updated",
    targetType: "device",
    targetId: String(device._id),
    after: { name, platform, employeeId, status: "pending" },
    note: "Device record created",
  });

  // Not awaited: realtime is best-effort and must not sit in the response's
  // latency. Every publisher swallows its own failures.
  events.deviceUpdated({ device, actorId: createdBy });

  return device;
};

/** Renames a device or moves it to another employee. */
const updateDevice = async ({ companyId, deviceId, actorId, changes }) => {
  const device = await getDevice(companyId, deviceId);

  const before = {};
  const after = {};
  ["name", "employeeId"].forEach((field) => {
    if (changes[field] !== undefined && changes[field] !== device[field]) {
      before[field] = device[field];
      after[field] = changes[field];
      device[field] = changes[field];
    }
  });

  if (Object.keys(after).length === 0) return device;

  await device.save();
  await auditService.record({
    companyId,
    actorId,
    actorKind: "user",
    action: "device.updated",
    targetType: "device",
    targetId: String(device._id),
    before,
    after,
  });

  events.deviceUpdated({
    device,
    actorId,
    previousEmployeeId: before.employeeId || null,
  });

  return device;
};

/**
 * Blocks or re-activates a device.
 *
 * Blocking stops policy delivery and token renewal. It does not instruct the
 * agent to stop enforcing — the opposite: a blocked machine keeps its last
 * cached policy, which is the safe direction for a device believed to be
 * lost or compromised.
 */
const setDeviceStatus = async ({ companyId, deviceId, status, actorId }) => {
  const device = await getDevice(companyId, deviceId);
  if (device.status === status) return device;

  const before = device.status;
  device.status = status;
  await device.save();

  await auditService.record({
    companyId,
    actorId,
    actorKind: "user",
    action: status === "blocked" ? "device.blocked" : "device.unblocked",
    targetType: "device",
    targetId: String(device._id),
    before: { status: before },
    after: { status },
  });

  events.deviceStatusChanged({ device, actorId });

  return device;
};

// ───────────────────────────────── Policies ────────────────────────────────

const listPolicies = async ({ companyId, limit = 100, skip = 0 }) => {
  const [policies, total] = await Promise.all([
    Policy.find({ companyId }).sort({ updatedAt: -1 }).skip(skip).limit(Math.min(limit, 500)),
    Policy.countDocuments({ companyId }),
  ]);
  return { policies, total };
};

const createPolicy = async ({ companyId, createdBy, body }) => {
  const policy = await Policy.create({
    companyId,
    name: body.name,
    description: body.description || "",
    version: 1,
    ...POLICY_SECTION_KEYS.reduce((sections, key) => {
      if (body[key]) sections[key] = body[key];
      return sections;
    }, {}),
    createdBy,
  });

  await auditService.record({
    companyId,
    actorId: createdBy,
    actorKind: "user",
    action: "policy.created",
    targetType: "policy",
    targetId: String(policy._id),
    after: { name: policy.name, version: policy.version },
  });

  events.policyChanged({
    companyId,
    policy,
    action: events.EVENT_ACTIONS.POLICY_CREATED,
    actorId: createdBy,
  });

  return policy;
};

/**
 * Edits a policy and bumps its version.
 *
 * The version moves on every accepted edit, even a cosmetic one, because the
 * agent uses it to tell "I already have this" from "this changed". Being
 * occasionally too eager costs one policy fetch; being too clever here costs
 * an un-applied change.
 */
const updatePolicy = async ({ companyId, policyId, actorId, body }) => {
  const policy = await policyService.requirePolicy(companyId, policyId);

  const before = { name: policy.name, version: policy.version };

  if (body.name !== undefined) policy.name = body.name;
  if (body.description !== undefined) policy.description = body.description;
  POLICY_SECTION_KEYS.forEach((key) => {
    if (body[key] !== undefined) policy.set(key, body[key]);
  });

  policy.version = policyService.nextVersion(policy);
  policy.updatedBy = actorId;
  await policy.save();

  await auditService.record({
    companyId,
    actorId,
    actorKind: "user",
    action: "policy.updated",
    targetType: "policy",
    targetId: String(policy._id),
    before,
    after: { name: policy.name, version: policy.version },
  });

  events.policyChanged({
    companyId,
    policy,
    action: events.EVENT_ACTIONS.POLICY_UPDATED,
    actorId,
  });

  return policy;
};

/**
 * Deletes a policy, refusing while it is still assigned.
 *
 * Deleting an assigned policy would leave its devices with no policy at all,
 * which the agent reads as "clear everything" — a silent, fleet-wide removal
 * of restrictions triggered by a delete button. The administrator unassigns
 * first, deliberately.
 */
const deletePolicy = async ({ companyId, policyId, actorId }) => {
  const policy = await policyService.requirePolicy(companyId, policyId);

  const assigned = await Assignment.countDocuments({
    companyId,
    policyId: String(policy._id),
  });
  if (assigned > 0) {
    throw new ApiError(
      `This policy is still assigned to ${assigned} target(s). Unassign it first.`,
      409
    );
  }

  await Policy.deleteOne({ _id: policy._id, companyId });

  await auditService.record({
    companyId,
    actorId,
    actorKind: "user",
    action: "policy.deleted",
    targetType: "policy",
    targetId: String(policy._id),
    before: { name: policy.name, version: policy.version },
  });

  events.policyChanged({
    companyId,
    policy,
    action: events.EVENT_ACTIONS.POLICY_DELETED,
    actorId,
  });

  return { deleted: true };
};

// ──────────────────────────────── Assignments ──────────────────────────────

const assignPolicy = async ({ companyId, policyId, scope, scopeId, priority = 0, actorId }) => {
  await policyService.requirePolicy(companyId, policyId);

  if (scope === "device") await getDevice(companyId, scopeId);

  // One assignment per policy per target: re-assigning updates rather than
  // stacking duplicates that would then race on priority.
  const assignment = await Assignment.findOneAndUpdate(
    { companyId, policyId, scope, scopeId: scope === "company" ? null : scopeId },
    { $set: { priority, createdBy: actorId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await auditService.record({
    companyId,
    actorId,
    actorKind: "user",
    action: "policy.assigned",
    targetType: "policyAssignment",
    targetId: String(assignment._id),
    after: { policyId, scope, scopeId: assignment.scopeId, priority },
  });

  events.assignmentChanged({
    companyId,
    assignment,
    action: events.EVENT_ACTIONS.POLICY_ASSIGNED,
    actorId,
  });

  return assignment;
};

const unassignPolicy = async ({ companyId, assignmentId, actorId }) => {
  const assignment = await Assignment.findOne({ _id: assignmentId, companyId });
  if (!assignment) throw new ApiError("Assignment not found", 404);

  await Assignment.deleteOne({ _id: assignment._id, companyId });

  await auditService.record({
    companyId,
    actorId,
    actorKind: "user",
    action: "policy.unassigned",
    targetType: "policyAssignment",
    targetId: String(assignment._id),
    before: {
      policyId: assignment.policyId,
      scope: assignment.scope,
      scopeId: assignment.scopeId,
    },
  });

  events.assignmentChanged({
    companyId,
    assignment,
    action: events.EVENT_ACTIONS.POLICY_UNASSIGNED,
    actorId,
  });

  return { deleted: true };
};

// ──────────────────────────────── Enforcement ──────────────────────────────

/**
 * Records what an agent actually achieved, and only then updates the device.
 *
 * `appliedPolicyVersion` moves solely from here, and solely when at least one
 * control applied. This is the rule that keeps the console honest: an
 * assignment alone never makes a device look enforced.
 *
 * Failures are audited as they arrive, because an enforcement report is the
 * only evidence that a policy did not take, and nobody is watching the agent
 * logs on an employee's laptop.
 */
const recordEnforcement = async ({ device, policyId, policyVersion, controls, agentVersion, osVersion }) => {
  const report = await EnforcementReport.create({
    companyId: device.companyId,
    deviceId: String(device._id),
    policyId: policyId || null,
    policyVersion,
    controls,
    agentVersion,
    osVersion,
    reportedAt: new Date(),
  });

  const overall = report.overallStatus();

  const update = { lastSeenAt: new Date() };
  if (agentVersion) update.agentVersion = agentVersion;
  if (osVersion) update.osVersion = osVersion;
  if (overall === "applied" || overall === "partial") {
    update.appliedPolicyVersion = policyVersion;
  }
  await Device.updateOne({ _id: device._id }, { $set: update });

  const failed = (controls || []).filter((control) => control.status === "failed");
  if (failed.length > 0) {
    await auditService.record({
      companyId: device.companyId,
      actorId: String(device._id),
      actorKind: "device",
      action: "enforcement.failed",
      targetType: "device",
      targetId: String(device._id),
      after: { policyVersion, failed: failed.map((control) => control.key) },
      note: failed.map((control) => `${control.key}: ${control.message}`).join("; "),
    });
  }

  events.enforcementReported({ device, report, overall });

  return { report, overall };
};

/** The newest report for each of a company's devices, for the dashboard. */
const latestReportFor = async (companyId, deviceId) =>
  EnforcementReport.findOne({ companyId, deviceId: String(deviceId) }).sort({
    reportedAt: -1,
  });

/**
 * Dashboard counters.
 *
 * "Outdated" compares the version the device confirmed against the version
 * its policy would hand out now, so a device that is simply offline and a
 * device that failed to apply are both visible rather than averaged away.
 */
const dashboardSummary = async (companyId, { offlineAfterMinutes = 30 } = {}) => {
  const offlineCutoff = new Date(Date.now() - offlineAfterMinutes * 60 * 1000);

  const [total, active, blocked, pendingRequests, staleDevices] = await Promise.all([
    Device.countDocuments({ companyId }),
    Device.countDocuments({ companyId, status: "active" }),
    Device.countDocuments({ companyId, status: "blocked" }),
    AccessRequest.countDocuments({ companyId, status: "pending" }),
    Device.countDocuments({
      companyId,
      status: "active",
      $or: [{ lastSeenAt: null }, { lastSeenAt: { $lt: offlineCutoff } }],
    }),
  ]);

  const liveExceptions = await Exception.countDocuments({
    companyId,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });

  return {
    totalDevices: total,
    activeDevices: active,
    blockedDevices: blocked,
    offlineDevices: staleDevices,
    pendingRequests,
    liveExceptions,
  };
};

module.exports = {
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  setDeviceStatus,
  listPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
  assignPolicy,
  unassignPolicy,
  recordEnforcement,
  latestReportFor,
  dashboardSummary,
};
