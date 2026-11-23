const { EVENT_TYPES } = require("../../core/events/eventTypes");
const { getEventDispatcher } = require("../../core/events/eventDispatcher");
const permissionNotifier = require("../../core/notifications/permissionNotifier");

/**
 * The live feed for Device Policy Management.
 *
 * Three rules shape everything here.
 *
 * **1. An event is a nudge, never an authorization.** Every payload carries
 * ids and statuses only — enough for a client to know something changed and
 * refetch it through the API, where the permission check actually happens. No
 * policy contents, no secrets, no enrollment codes. A client that trusted a
 * socket frame would be trusting whatever reached it; the backend stays the
 * source of truth.
 *
 * **2. Delivery is best-effort and never costs the operation.** A policy that
 * was saved is saved whether or not the frame went out, so every publish is
 * wrapped and callers do not await it. A realtime failure is logged, not
 * raised.
 *
 * **3. Recipients are resolved, not assumed.** Sockets join only `user:<id>`,
 * so there is no company room to shout into — and that is the right shape:
 * most of these events are for administrators, and a company room would
 * deliver them to every employee. Who counts as an administrator comes from
 * `permissionNotifier.approversFor`, which re-checks each candidate through
 * the permission engine, so an event follows the same grant the API does.
 */

const EVENT_TYPE = EVENT_TYPES.DEVICE_CONTROL;

/**
 * What changed. Deliberately the same vocabulary as `AUDIT_ACTIONS`, with two
 * additions that are not audited because nothing was decided: a device coming
 * back online, and a report that succeeded.
 */
const EVENT_ACTIONS = Object.freeze({
  DEVICE_ENROLLED: "device.enrolled",
  DEVICE_UPDATED: "device.updated",
  DEVICE_BLOCKED: "device.blocked",
  DEVICE_UNBLOCKED: "device.unblocked",
  /** A device that had gone quiet has checked in again. */
  DEVICE_ONLINE: "device.online",
  POLICY_CREATED: "policy.created",
  POLICY_UPDATED: "policy.updated",
  POLICY_DELETED: "policy.deleted",
  POLICY_ASSIGNED: "policy.assigned",
  POLICY_UNASSIGNED: "policy.unassigned",
  /** An agent reported on a policy, whatever the outcome. */
  ENFORCEMENT_REPORTED: "enforcement.reported",
  /** At least one control could not be applied. */
  ENFORCEMENT_FAILED: "enforcement.failed",
  REQUEST_CREATED: "request.created",
  REQUEST_APPROVED: "request.approved",
  REQUEST_REJECTED: "request.rejected",
  REQUEST_CANCELLED: "request.cancelled",
  EXCEPTION_GRANTED: "exception.granted",
  EXCEPTION_REVOKED: "exception.revoked",
});

/**
 * How long a device may be silent before a check-in counts as coming back.
 *
 * The same 30 minutes the dashboard calls offline, so "online again" and the
 * offline counter cannot disagree.
 */
const ONLINE_AFTER_SILENCE_MS = 30 * 60 * 1000;

const _id = (value) => (value ? String(value) : null);

/**
 * Publishes one event to a resolved set of users.
 *
 * `toUserIds` are the people the change is *about* — a device's owner, a
 * request's author — and they are included whether or not they administer
 * anything. `adminResource` decides which grant the administrators need:
 * `device` for devices, requests and exceptions, `devicePolicy` for the
 * policies themselves, matching the gates on the routes.
 *
 * Returns the number of recipients, which is only useful for logging and
 * tests; nothing branches on it.
 */
const _publish = async ({
  companyId,
  action,
  payload = {},
  toUserIds = [],
  notifyAdmins = true,
  adminResource = "device",
}) => {
  try {
    const company = _id(companyId);
    if (!company || !action) return 0;

    const recipients = new Set(toUserIds.map(_id).filter(Boolean));

    if (notifyAdmins) {
      const admins = await permissionNotifier.approversFor({
        companyId: company,
        resource: adminResource,
        action: "view",
      });
      admins.forEach((user) => recipients.add(String(user._id)));
    }

    if (recipients.size === 0) return 0;

    const dispatcher = getEventDispatcher();
    recipients.forEach((userId) => {
      dispatcher.sendToUser(
        userId,
        EVENT_TYPE,
        { companyId: company, ...payload },
        { action }
      );
    });

    return recipients.size;
  } catch (error) {
    // Realtime is a convenience. Losing a frame must never turn a successful
    // write into a failed request.
    console.error(
      `[device-control] event "${action}" was not delivered:`,
      error && error.message
    );
    return 0;
  }
};

// ───────────────────────────────── Devices ─────────────────────────────────

/** An agent completed enrollment and the machine is now managed. */
const deviceEnrolled = (device) =>
  _publish({
    companyId: device.companyId,
    action: EVENT_ACTIONS.DEVICE_ENROLLED,
    toUserIds: [device.employeeId],
    payload: {
      deviceId: _id(device._id),
      employeeId: _id(device.employeeId),
      name: device.name,
      platform: device.platform,
      status: device.status,
    },
  });

/** A device was renamed or moved to another employee. */
const deviceUpdated = ({ device, actorId, previousEmployeeId = null }) =>
  _publish({
    companyId: device.companyId,
    action: EVENT_ACTIONS.DEVICE_UPDATED,
    // The previous owner is told too: the device has just left their list,
    // and a stale row they can no longer open is worse than no row.
    toUserIds: [device.employeeId, previousEmployeeId, actorId],
    payload: {
      deviceId: _id(device._id),
      employeeId: _id(device.employeeId),
      name: device.name,
      status: device.status,
    },
  });

/** A device was blocked or re-activated. */
const deviceStatusChanged = ({ device, actorId }) =>
  _publish({
    companyId: device.companyId,
    action:
      device.status === "blocked"
        ? EVENT_ACTIONS.DEVICE_BLOCKED
        : EVENT_ACTIONS.DEVICE_UNBLOCKED,
    toUserIds: [device.employeeId, actorId],
    payload: {
      deviceId: _id(device._id),
      employeeId: _id(device.employeeId),
      status: device.status,
    },
  });

/**
 * A device that had gone quiet has reported in.
 *
 * There is deliberately no matching "offline" event: nothing happens on the
 * server when a device stops talking, so there is nothing to publish. A
 * client decides offline from `lastSeenAt`, which it already has. Emitting a
 * fabricated offline event would mean a timer sweeping every device, and a
 * laptop that is merely shut for the night would generate an alert.
 */
const deviceCameOnline = ({ device, previousLastSeenAt, now = new Date() }) => {
  const silence = previousLastSeenAt
    ? now.getTime() - new Date(previousLastSeenAt).getTime()
    : Infinity;

  // Inside the window the device was already considered online, so a
  // heartbeat is not news and costs nobody a query.
  if (silence < ONLINE_AFTER_SILENCE_MS) return Promise.resolve(0);

  return _publish({
    companyId: device.companyId,
    action: EVENT_ACTIONS.DEVICE_ONLINE,
    toUserIds: [device.employeeId],
    payload: {
      deviceId: _id(device._id),
      employeeId: _id(device.employeeId),
      status: device.status,
      lastSeenAt: now.toISOString(),
      silentForMinutes: Number.isFinite(silence)
        ? Math.round(silence / 60000)
        : null,
    },
  });
};

// ───────────────────────────────── Policies ────────────────────────────────

const policyChanged = ({ companyId, policy, action, actorId }) =>
  _publish({
    companyId,
    action,
    toUserIds: [actorId],
    adminResource: "devicePolicy",
    payload: {
      policyId: _id(policy && policy._id),
      name: policy && policy.name,
      version: policy && policy.version,
    },
  });

/**
 * A policy was pointed at, or taken off, a device, an employee or a company.
 *
 * Sent to the `device` audience rather than `devicePolicy`: an assignment
 * changes what a machine will enforce, which is the devices view's business,
 * and a help-desk role that may see devices but not author policies still
 * needs its list to be right.
 */
const assignmentChanged = ({ companyId, assignment, action, actorId }) =>
  _publish({
    companyId,
    action,
    // An employee- or device-scoped assignment changes what that person's
    // machine does, so they are told as well.
    toUserIds: [
      actorId,
      assignment && assignment.scope === "employee" ? assignment.scopeId : null,
    ],
    payload: {
      assignmentId: _id(assignment && assignment._id),
      policyId: _id(assignment && assignment.policyId),
      scope: assignment && assignment.scope,
      scopeId: _id(assignment && assignment.scopeId),
      priority: assignment && assignment.priority,
    },
  });

// ──────────────────────────────── Enforcement ──────────────────────────────

/**
 * An agent said what the operating system accepted.
 *
 * Two audiences, on purpose. The owner is always told, because it is their
 * machine and the answer costs no query. Administrators are told only when
 * the report needs attention — a `failed` or `partial` outcome, or a control
 * the device cannot support. A fleet applying a new policy cleanly would
 * otherwise mean one recipient lookup per device in a burst, to deliver news
 * that nothing is wrong.
 */
const enforcementReported = ({ device, report, overall }) => {
  const failed = (report.controls || []).filter(
    (control) => control.status === "failed"
  );
  const needsAttention = overall !== "applied";

  return _publish({
    companyId: device.companyId,
    action: failed.length > 0
      ? EVENT_ACTIONS.ENFORCEMENT_FAILED
      : EVENT_ACTIONS.ENFORCEMENT_REPORTED,
    toUserIds: [device.employeeId],
    notifyAdmins: needsAttention,
    payload: {
      deviceId: _id(device._id),
      employeeId: _id(device.employeeId),
      policyId: _id(report.policyId),
      policyVersion: report.policyVersion,
      overall,
      failedControls: failed.map((control) => control.key),
      unsupportedControls: (report.controls || [])
        .filter((control) => control.status === "unsupported")
        .map((control) => control.key),
    },
  });
};

// ────────────────────────── Requests and exceptions ────────────────────────

/** An employee asked for access to something their policy refuses. */
const requestCreated = ({ request }) =>
  _publish({
    companyId: request.companyId,
    action: EVENT_ACTIONS.REQUEST_CREATED,
    toUserIds: [request.requesterId],
    payload: {
      requestId: _id(request._id),
      deviceId: _id(request.deviceId),
      requesterId: _id(request.requesterId),
      category: request.category,
      resource: request.resource,
      status: request.status,
    },
  });

/** A reviewer decided. The requester is always told; so is the queue. */
const requestDecided = ({ request, action, exception = null }) =>
  _publish({
    companyId: request.companyId,
    action,
    toUserIds: [request.requesterId, request.reviewerId],
    payload: {
      requestId: _id(request._id),
      deviceId: _id(request.deviceId),
      requesterId: _id(request.requesterId),
      category: request.category,
      resource: request.resource,
      status: request.status,
      exceptionId: _id(exception && exception._id),
      expiresAt:
        exception && exception.expiresAt
          ? new Date(exception.expiresAt).toISOString()
          : null,
    },
  });

/** The requester withdrew it themselves. */
const requestCancelled = ({ request }) =>
  _publish({
    companyId: request.companyId,
    action: EVENT_ACTIONS.REQUEST_CANCELLED,
    toUserIds: [request.requesterId],
    payload: {
      requestId: _id(request._id),
      deviceId: _id(request.deviceId),
      status: request.status,
    },
  });

/** An exception was granted or ended. */
const exceptionChanged = ({ exception, action, actorId, employeeId = null }) =>
  _publish({
    companyId: exception.companyId,
    action,
    toUserIds: [actorId, employeeId],
    payload: {
      exceptionId: _id(exception._id),
      deviceId: _id(exception.deviceId),
      category: exception.category,
      resource: exception.resource,
      expiresAt: exception.expiresAt
        ? new Date(exception.expiresAt).toISOString()
        : null,
      revokedAt: exception.revokedAt
        ? new Date(exception.revokedAt).toISOString()
        : null,
    },
  });

module.exports = {
  EVENT_TYPE,
  EVENT_ACTIONS,
  ONLINE_AFTER_SILENCE_MS,
  deviceEnrolled,
  deviceUpdated,
  deviceStatusChanged,
  deviceCameOnline,
  policyChanged,
  assignmentChanged,
  enforcementReported,
  requestCreated,
  requestDecided,
  requestCancelled,
  exceptionChanged,
};
