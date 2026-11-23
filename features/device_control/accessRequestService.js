const ApiError = require("../../utils/apiError");
const AccessRequest = require("./accessRequestModel");
const Exception = require("./policyExceptionModel");
const Device = require("./deviceModel");
const auditService = require("./deviceAuditService");
const events = require("./deviceControlEvents");
const permissionNotifier = require("../../core/notifications/permissionNotifier");

/**
 * The request and approval workflow.
 *
 * Two rules here are security, not process, and both are enforced on the
 * server because a client cannot be trusted to enforce either:
 *
 *  1. nobody decides their own request, whatever their role;
 *  2. an approval grants one scoped, expiring exception — never a change to
 *     the policy everyone else is under, and never a second category.
 */

/**
 * Tells whoever is entitled to decide that a request is waiting.
 *
 * Deliberately thin on detail. The notification says who and what kind, and
 * carries ids in its metadata so a tap opens the queue; the resource and the
 * employee's stated reason are left out. Both are the employee's own words
 * about their own machine, and a push payload is handed to a third-party
 * transport and cached well past this system — the reviewer reads them over
 * the authorized API instead, one screen later.
 *
 * Never awaited by the caller and never able to fail one: a request that was
 * recorded is recorded whether or not anybody's phone buzzed.
 */
const _notifyReviewers = async ({ request, device }) => {
  try {
    await permissionNotifier.notifyEntitled({
      companyId: String(request.companyId),
      resource: "device",
      action: "update",
      type: "device_access_request",
      title: "Device access request",
      body: `${device.name} needs ${request.category} access`,
      priority: "normal",
      createdBy: String(request.requesterId),
      notificationAction: { type: "device_access_request" },
      metadata: {
        requestId: String(request._id),
        deviceId: String(request.deviceId),
        category: request.category,
      },
      // The requester is not their own reviewer, so they are not in the queue.
      excludeUserIds: [String(request.requesterId)],
    });
  } catch (error) {
    console.error(
      "[device-control] reviewers were not notified:",
      error && error.message
    );
  }
};

/** Loads a device inside the caller's company, or refuses. */
const _requireDevice = async (companyId, deviceId) => {
  const device = await Device.findOne({ _id: deviceId, companyId });
  if (!device) throw new ApiError("Device not found", 404);
  return device;
};

/**
 * Files a request against one of the requester's own devices.
 *
 * The requester comes from the verified token. A body that names someone else
 * is ignored rather than refused, because there is no legitimate client that
 * sends one and nothing is gained by explaining the field to whoever tried.
 */
const createRequest = async ({
  companyId,
  requesterId,
  deviceId,
  category,
  resource,
  reason,
  requestedUntil = null,
}) => {
  const device = await _requireDevice(companyId, deviceId);

  if (String(device.employeeId) !== String(requesterId)) {
    throw new ApiError("You can only request access for your own device", 403);
  }

  const request = await AccessRequest.create({
    companyId,
    requesterId,
    deviceId: String(device._id),
    category,
    resource,
    reason,
    requestedUntil,
    status: "pending",
  });

  await auditService.record({
    companyId,
    actorId: requesterId,
    actorKind: "user",
    action: "request.created",
    targetType: "accessRequest",
    targetId: String(request._id),
    after: { category, resource },
    note: reason,
  });

  events.requestCreated({ request });
  _notifyReviewers({ request, device });

  return request;
};

/**
 * Approves a request and grants the one exception it asked for.
 *
 * `grantedUntil` lets a reviewer shorten what was asked without rewriting the
 * request, so the record keeps both the ask and the decision. A null expiry
 * is a standing exception and is allowed, because some approvals genuinely
 * are permanent; it still has to be revoked explicitly to end.
 */
const approveRequest = async ({
  companyId,
  requestId,
  reviewerId,
  grantedUntil = undefined,
  note = "",
}) => {
  const request = await AccessRequest.findOne({ _id: requestId, companyId });
  if (!request) throw new ApiError("Request not found", 404);

  if (request.status !== "pending") {
    throw new ApiError(`This request is already ${request.status}`, 409);
  }

  // The rule the whole workflow rests on.
  if (String(request.requesterId) === String(reviewerId)) {
    throw new ApiError("You cannot decide your own access request", 403);
  }

  const expiresAt =
    grantedUntil === undefined ? request.requestedUntil : grantedUntil;

  const exception = await Exception.create({
    companyId,
    deviceId: request.deviceId,
    category: request.category,
    resource: request.resource,
    grantedBy: reviewerId,
    requestId: String(request._id),
    expiresAt: expiresAt || null,
  });

  request.set({
    status: "approved",
    reviewerId,
    decisionNote: note,
    decidedAt: new Date(),
    exceptionId: String(exception._id),
  });
  await request.save();

  await auditService.record({
    companyId,
    actorId: reviewerId,
    actorKind: "user",
    action: "request.approved",
    targetType: "accessRequest",
    targetId: String(request._id),
    after: {
      category: request.category,
      resource: request.resource,
      expiresAt: exception.expiresAt,
    },
    note,
  });

  await auditService.record({
    companyId,
    actorId: reviewerId,
    actorKind: "user",
    action: "exception.granted",
    targetType: "policyException",
    targetId: String(exception._id),
    after: {
      deviceId: exception.deviceId,
      category: exception.category,
      resource: exception.resource,
      expiresAt: exception.expiresAt,
    },
  });

  events.requestDecided({
    request,
    action: events.EVENT_ACTIONS.REQUEST_APPROVED,
    exception,
  });
  events.exceptionChanged({
    exception,
    action: events.EVENT_ACTIONS.EXCEPTION_GRANTED,
    actorId: reviewerId,
    employeeId: request.requesterId,
  });

  return { request, exception };
};

/** Rejects a request. Same self-decision rule as approval. */
const rejectRequest = async ({ companyId, requestId, reviewerId, note = "" }) => {
  const request = await AccessRequest.findOne({ _id: requestId, companyId });
  if (!request) throw new ApiError("Request not found", 404);

  if (request.status !== "pending") {
    throw new ApiError(`This request is already ${request.status}`, 409);
  }

  if (String(request.requesterId) === String(reviewerId)) {
    throw new ApiError("You cannot decide your own access request", 403);
  }

  request.set({
    status: "rejected",
    reviewerId,
    decisionNote: note,
    decidedAt: new Date(),
  });
  await request.save();

  await auditService.record({
    companyId,
    actorId: reviewerId,
    actorKind: "user",
    action: "request.rejected",
    targetType: "accessRequest",
    targetId: String(request._id),
    note,
  });

  events.requestDecided({
    request,
    action: events.EVENT_ACTIONS.REQUEST_REJECTED,
  });

  return request;
};

/** The requester withdrawing their own pending request. */
const cancelRequest = async ({ companyId, requestId, requesterId }) => {
  const request = await AccessRequest.findOne({ _id: requestId, companyId });
  if (!request) throw new ApiError("Request not found", 404);

  if (String(request.requesterId) !== String(requesterId)) {
    throw new ApiError("You can only cancel your own request", 403);
  }
  if (request.status !== "pending") {
    throw new ApiError(`This request is already ${request.status}`, 409);
  }

  request.set({ status: "cancelled", decidedAt: new Date() });
  await request.save();

  await auditService.record({
    companyId,
    actorId: requesterId,
    actorKind: "user",
    action: "request.cancelled",
    targetType: "accessRequest",
    targetId: String(request._id),
  });

  events.requestCancelled({ request });

  return request;
};

/** Ends an exception early. The device picks it up on its next sync. */
const revokeException = async ({ companyId, exceptionId, actorId }) => {
  const exception = await Exception.findOne({ _id: exceptionId, companyId });
  if (!exception) throw new ApiError("Exception not found", 404);
  if (exception.revokedAt) return exception;

  exception.set({ revokedAt: new Date(), revokedBy: actorId });
  await exception.save();

  await auditService.record({
    companyId,
    actorId,
    actorKind: "user",
    action: "exception.revoked",
    targetType: "policyException",
    targetId: String(exception._id),
    before: { category: exception.category, resource: exception.resource },
  });

  // The owner is looked up rather than assumed: an exception is pinned to a
  // device, and the person who needs to know the hole has closed is whoever
  // owns that device now — not necessarily whoever asked for it.
  const device = await Device.findOne({
    _id: exception.deviceId,
    companyId,
  }).select("employeeId");

  events.exceptionChanged({
    exception,
    action: events.EVENT_ACTIONS.EXCEPTION_REVOKED,
    actorId,
    employeeId: device ? device.employeeId : null,
  });

  return exception;
};

/**
 * Marks lapsed requests expired.
 *
 * Only cosmetic: the exception itself stops counting on its own date, in
 * `isLive`, so enforcement never depends on this having run.
 */
const expireLapsedRequests = async (now = new Date()) =>
  AccessRequest.updateMany(
    { status: "pending", requestedUntil: { $ne: null, $lte: now } },
    { $set: { status: "expired", decidedAt: now } }
  );

module.exports = {
  createRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  revokeException,
  expireLapsedRequests,
};
