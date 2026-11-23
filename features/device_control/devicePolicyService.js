const ApiError = require("../../utils/apiError");
const Policy = require("./devicePolicyModel");
const Assignment = require("./policyAssignmentModel");
const Exception = require("./policyExceptionModel");
const policySigner = require("./policySigner");
const { CONTROL_KEYS } = require("./deviceControlConstants");

/**
 * Works out what one device should actually be enforcing, right now.
 *
 * Three inputs, in this order: the assignment that wins, the policy it names,
 * and the live exceptions pinned to that device. The result is signed and
 * handed to the agent; nothing else is.
 */

/** Most specific scope first. A device assignment beats an employee one. */
const SCOPE_RANK = { device: 3, employee: 2, company: 1 };

/**
 * The assignment that applies to this device.
 *
 * Scope specificity decides first, then `priority`, then recency. Deciding on
 * priority alone would let a company-wide policy with a high number override
 * a policy an administrator pinned to one machine, which is the opposite of
 * what pinning means.
 */
const compareAssignments = (a, b) => {
  const scope = SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope];
  if (scope !== 0) return scope;
  if (b.priority !== a.priority) return b.priority - a.priority;
  return new Date(b.createdAt) - new Date(a.createdAt);
};

const resolveAssignment = async (device) => {
  const assignments = await Assignment.find({
    companyId: device.companyId,
    $or: [
      { scope: "device", scopeId: String(device._id) },
      { scope: "employee", scopeId: String(device.employeeId) },
      { scope: "company", scopeId: null },
      { scope: "company", scopeId: device.companyId },
    ],
  });

  if (assignments.length === 0) return null;

  return [...assignments].sort(compareAssignments)[0];
};

/** The exceptions in force for this device at `now`. */
const liveExceptions = async (device, now = new Date()) => {
  const candidates = await Exception.find({
    companyId: device.companyId,
    deviceId: String(device._id),
    revokedAt: null,
  });
  return candidates.filter((exception) => exception.isLive(now));
};

/**
 * A plain copy of the policy's five sections.
 *
 * Taken off the Mongoose document rather than mutating it, so applying
 * exceptions can never write back to the shared policy by accident.
 */
const sectionsOf = (policy) => ({
  applicationControl: {
    enabled: policy.applicationControl.enabled,
    mode: policy.applicationControl.mode,
    rules: policy.applicationControl.rules.map((rule) => ({
      kind: rule.kind,
      value: rule.value,
    })),
  },
  websiteControl: {
    enabled: policy.websiteControl.enabled,
    mode: policy.websiteControl.mode,
    disableSecureDns: policy.websiteControl.disableSecureDns,
    rules: policy.websiteControl.rules.map((rule) => ({
      domain: rule.domain,
      includeSubdomains: rule.includeSubdomains,
    })),
  },
  fileTransferControl: {
    enabled: policy.fileTransferControl.enabled,
    blockDownloads: policy.fileTransferControl.blockDownloads,
    blockUploads: policy.fileTransferControl.blockUploads,
    domains: [...policy.fileTransferControl.domains],
    exemptDomains: [],
  },
  usbControl: {
    enabled: policy.usbControl.enabled,
    blockStorage: policy.usbControl.blockStorage,
    denyRead: policy.usbControl.denyRead,
    denyWrite: policy.usbControl.denyWrite,
    approvedDeviceIds: [...policy.usbControl.approvedDeviceIds],
  },
  systemRestrictions: {
    enabled: policy.systemRestrictions.enabled,
    blockInstallers: policy.systemRestrictions.blockInstallers,
    blockAdminTools: policy.systemRestrictions.blockAdminTools,
    restrictedPaths: [...policy.systemRestrictions.restrictedPaths],
  },
});

/** The wildcard resource meaning "the whole category", used for USB access. */
const ALL_RESOURCES = "*";

/**
 * Widens exactly one category of `sections` by one exception.
 *
 * Each branch touches only the section its category names. That is the rule
 * the spec asks for and it is enforced structurally here rather than by
 * convention: there is no path through this function that can reach a
 * section other than the one selected.
 */
const applyException = (sections, exception) => {
  const resource = String(exception.resource || "").trim();
  if (!resource) return;

  switch (exception.category) {
    case "application": {
      const control = sections.applicationControl;
      if (control.mode === "whitelist") {
        control.rules.push({ kind: "path", value: resource });
      } else {
        control.rules = control.rules.filter((rule) => rule.value !== resource);
      }
      break;
    }
    case "website": {
      const control = sections.websiteControl;
      const domain = resource.toLowerCase();
      if (control.mode === "whitelist") {
        control.rules.push({ domain, includeSubdomains: true });
      } else {
        control.rules = control.rules.filter((rule) => rule.domain !== domain);
      }
      break;
    }
    case "usb": {
      const control = sections.usbControl;
      if (resource === ALL_RESOURCES) {
        // A temporary blanket USB grant, which is what "I need to copy this
        // file today" actually asks for. It still expires with the exception.
        control.blockStorage = false;
        control.denyRead = false;
        control.denyWrite = false;
      } else {
        control.approvedDeviceIds.push(resource);
      }
      break;
    }
    case "download":
    case "upload": {
      const control = sections.fileTransferControl;
      if (resource === ALL_RESOURCES) {
        if (exception.category === "download") control.blockDownloads = false;
        else control.blockUploads = false;
      } else {
        control.exemptDomains.push(resource.toLowerCase());
      }
      break;
    }
    case "system": {
      const control = sections.systemRestrictions;
      control.restrictedPaths = control.restrictedPaths.filter(
        (path) => path !== resource
      );
      break;
    }
    default:
      // An unknown category widens nothing. Fail closed.
      break;
  }
};

/**
 * A number that rises whenever anything the agent cares about changes.
 *
 * Seconds since the epoch of the most recent change among the policy, the
 * assignment and the live exceptions. The agent stores the highest value it
 * has seen and refuses anything lower, which is what stops an old signed
 * policy being replayed at it. The policy's own `version` is kept separately
 * for people to read; it does not move when only an exception changes, so it
 * cannot do this job.
 */
const _effectiveVersion = (policy, assignment, exceptions) => {
  const stamps = [policy.updatedAt, assignment ? assignment.updatedAt : null]
    .concat(exceptions.map((exception) => exception.updatedAt))
    .filter(Boolean)
    .map((date) => new Date(date).getTime());
  if (stamps.length === 0) return 1;
  return Math.floor(Math.max(...stamps) / 1000);
};

/**
 * The effective policy for a device, unsigned.
 *
 * Returns `null` when no policy is assigned, which the agent reads as "clear
 * everything this agent applied" rather than "do nothing": a device removed
 * from a policy must come back out of its restrictions.
 */
const buildEffectivePolicy = async (device, now = new Date()) => {
  const assignment = await resolveAssignment(device);
  if (!assignment) return null;

  const policy = await Policy.findOne({
    _id: assignment.policyId,
    companyId: device.companyId,
  });
  if (!policy) return null;

  const exceptions = await liveExceptions(device, now);
  const sections = sectionsOf(policy);
  exceptions.forEach((exception) => applyException(sections, exception));

  return {
    deviceId: String(device._id),
    companyId: device.companyId,
    policyId: String(policy._id),
    policyName: policy.name,
    policyVersion: policy.version,
    effectiveVersion: _effectiveVersion(policy, assignment, exceptions),
    issuedAt: now.toISOString(),
    controls: CONTROL_KEYS,
    sections,
    exceptions: exceptions.map((exception) => ({
      id: String(exception._id),
      category: exception.category,
      resource: exception.resource,
      expiresAt: exception.expiresAt ? exception.expiresAt.toISOString() : null,
    })),
  };
};

/** The effective policy, signed and ready for the wire. */
const signedPolicyFor = async (device, now = new Date()) => {
  const payload = await buildEffectivePolicy(device, now);
  if (!payload) return null;
  return policySigner.sign(payload);
};

/** Bumps `version` and records who changed what. Used by every policy edit. */
const nextVersion = (policy) => policy.version + 1;

/** Loads a policy inside its company, or refuses. */
const requirePolicy = async (companyId, policyId) => {
  const policy = await Policy.findOne({ _id: policyId, companyId });
  if (!policy) throw new ApiError("Policy not found", 404);
  return policy;
};

module.exports = {
  compareAssignments,
  sectionsOf,
  applyException,
  resolveAssignment,
  liveExceptions,
  buildEffectivePolicy,
  signedPolicyFor,
  nextVersion,
  requirePolicy,
  ALL_RESOURCES,
};
