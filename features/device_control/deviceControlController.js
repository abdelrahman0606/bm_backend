const ApiError = require("../../utils/apiError");
const { resolveCompanyForUser } = require("../../core/access/companyResolver");
const service = require("./deviceControlService");
const policyService = require("./devicePolicyService");
const requestService = require("./accessRequestService");
const enrollmentService = require("./deviceEnrollmentService");
const auditService = require("./deviceAuditService");
const AccessRequest = require("./accessRequestModel");
const Exception = require("./policyExceptionModel");
const Assignment = require("./policyAssignmentModel");
const Device = require("./deviceModel");

/**
 * The console and employee endpoints.
 *
 * Every handler resolves the company from the authenticated user rather than
 * from the request, through the same resolver the rest of the API uses. A
 * `companyId` in a body or a query string is never read here, so a client
 * cannot reach another company's devices by asking for them.
 */

const _company = (req) => resolveCompanyForUser(req.userId, null);

const _paging = (query) => ({
  limit: Number(query.limit) > 0 ? Number(query.limit) : 100,
  skip: Number(query.skip) > 0 ? Number(query.skip) : 0,
});

// ──────────────────────────────── Dashboard ────────────────────────────────

exports.getSummary = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const summary = await service.dashboardSummary(companyId);
    res.status(200).json({ success: true, data: summary, message: "Summary fetched successfully" });
  } catch (error) {
    next(error);
  }
};

// ───────────────────────────────── Devices ─────────────────────────────────

exports.listDevices = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const { devices, total } = await service.listDevices({
      companyId,
      status: req.query.status,
      employeeId: req.query.employeeId,
      ..._paging(req.query),
    });
    res.status(200).json({
      success: true,
      data: devices,
      pagination: { total },
      message: "Devices fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getDevice = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const device = await service.getDevice(companyId, req.params.id);
    const [latestReport, effectivePolicy] = await Promise.all([
      service.latestReportFor(companyId, device._id),
      policyService.buildEffectivePolicy(device),
    ]);

    res.status(200).json({
      success: true,
      data: {
        device,
        // Unsigned here on purpose: the console shows what the device should
        // be enforcing, while only the agent route hands out a signed copy.
        effectivePolicy,
        enforcement: latestReport
          ? { overall: latestReport.overallStatus(), report: latestReport }
          : { overall: "pending", report: null },
      },
      message: "Device fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.createDevice = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const device = await service.createDevice({
      companyId,
      employeeId: req.body.employeeId,
      name: req.body.name,
      platform: req.body.platform,
      createdBy: req.userId,
    });
    res.status(201).json({ success: true, data: device, message: "Device created successfully" });
  } catch (error) {
    next(error);
  }
};

exports.updateDevice = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const device = await service.updateDevice({
      companyId,
      deviceId: req.params.id,
      actorId: req.userId,
      changes: { name: req.body.name, employeeId: req.body.employeeId },
    });
    res.status(200).json({ success: true, data: device, message: "Device updated successfully" });
  } catch (error) {
    next(error);
  }
};

exports.setDeviceStatus = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const device = await service.setDeviceStatus({
      companyId,
      deviceId: req.params.id,
      status: req.body.status,
      actorId: req.userId,
    });
    res.status(200).json({ success: true, data: device, message: "Device status updated" });
  } catch (error) {
    next(error);
  }
};

/**
 * Cuts an enrollment code for a device.
 *
 * The plaintext code is in this response and nowhere else: it is not stored,
 * cannot be re-read, and a lost one is replaced by issuing another.
 */
exports.issueEnrollmentToken = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const device = await service.getDevice(companyId, req.params.id);

    const issued = await enrollmentService.issueEnrollmentToken({
      companyId,
      employeeId: device.employeeId,
      deviceId: String(device._id),
      createdBy: req.userId,
    });

    res.status(201).json({
      success: true,
      data: issued,
      message: "Enrollment code issued. It is shown once and expires.",
    });
  } catch (error) {
    next(error);
  }
};

// ───────────────────────────────── Policies ────────────────────────────────

exports.listPolicies = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const { policies, total } = await service.listPolicies({ companyId, ..._paging(req.query) });
    res.status(200).json({
      success: true,
      data: policies,
      pagination: { total },
      message: "Policies fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getPolicy = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const policy = await policyService.requirePolicy(companyId, req.params.id);
    const assignments = await Assignment.find({ companyId, policyId: String(policy._id) });
    res.status(200).json({
      success: true,
      data: { policy, assignments },
      message: "Policy fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.createPolicy = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const policy = await service.createPolicy({ companyId, createdBy: req.userId, body: req.body });
    res.status(201).json({ success: true, data: policy, message: "Policy created successfully" });
  } catch (error) {
    next(error);
  }
};

exports.updatePolicy = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const policy = await service.updatePolicy({
      companyId,
      policyId: req.params.id,
      actorId: req.userId,
      body: req.body,
    });
    res.status(200).json({ success: true, data: policy, message: "Policy updated successfully" });
  } catch (error) {
    next(error);
  }
};

exports.deletePolicy = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const result = await service.deletePolicy({
      companyId,
      policyId: req.params.id,
      actorId: req.userId,
    });
    res.status(200).json({ success: true, data: result, message: "Policy deleted successfully" });
  } catch (error) {
    next(error);
  }
};

exports.assignPolicy = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const assignment = await service.assignPolicy({
      companyId,
      policyId: req.params.id,
      scope: req.body.scope,
      scopeId: req.body.scopeId || null,
      priority: req.body.priority || 0,
      actorId: req.userId,
    });
    res.status(201).json({ success: true, data: assignment, message: "Policy assigned successfully" });
  } catch (error) {
    next(error);
  }
};

exports.unassignPolicy = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const result = await service.unassignPolicy({
      companyId,
      assignmentId: req.params.assignmentId,
      actorId: req.userId,
    });
    res.status(200).json({ success: true, data: result, message: "Assignment removed" });
  } catch (error) {
    next(error);
  }
};

// ────────────────────────────── Access requests ────────────────────────────

exports.listRequests = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const filter = { companyId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.deviceId) filter.deviceId = req.query.deviceId;
    // One employee's requests, for their member page. `employeeId` is the
    // name every other device endpoint uses for the person, so it is accepted
    // alongside the field's own name rather than making callers know both.
    const requester = req.query.requesterId || req.query.employeeId;
    if (requester) filter.requesterId = String(requester).trim();

    const { limit, skip } = _paging(req.query);
    const [requests, total] = await Promise.all([
      AccessRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      AccessRequest.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: requests,
      pagination: { total },
      message: "Requests fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.approveRequest = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const result = await requestService.approveRequest({
      companyId,
      requestId: req.params.id,
      reviewerId: req.userId,
      grantedUntil: req.body.grantedUntil ? new Date(req.body.grantedUntil) : undefined,
      note: req.body.note || "",
    });
    res.status(200).json({ success: true, data: result, message: "Request approved" });
  } catch (error) {
    next(error);
  }
};

exports.rejectRequest = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const request = await requestService.rejectRequest({
      companyId,
      requestId: req.params.id,
      reviewerId: req.userId,
      note: req.body.note || "",
    });
    res.status(200).json({ success: true, data: request, message: "Request rejected" });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────── Exceptions ────────────────────────────────

exports.listExceptions = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const filter = { companyId };
    if (req.query.deviceId) filter.deviceId = req.query.deviceId;
    const exceptions = await Exception.find(filter).sort({ createdAt: -1 }).limit(500);
    res.status(200).json({
      success: true,
      data: exceptions,
      message: "Exceptions fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.revokeException = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const exception = await requestService.revokeException({
      companyId,
      exceptionId: req.params.id,
      actorId: req.userId,
    });
    res.status(200).json({ success: true, data: exception, message: "Exception revoked" });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────  Audit  ─────────────────────────────────

exports.listAudit = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const { limit, skip } = _paging(req.query);
    const { events, total } = await auditService.list({
      companyId,
      targetType: req.query.targetType,
      targetId: req.query.targetId,
      limit,
      skip,
    });
    res.status(200).json({
      success: true,
      data: events,
      pagination: { total },
      message: "Audit history fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────── Employee's own view ──────────────────────────

/**
 * The employee's own devices and what is restricted on them.
 *
 * No `device` permission is required: this is a person reading their own
 * machine. It is filtered by `employeeId` from the token, so it cannot be
 * turned into a listing of anyone else's devices by changing a parameter.
 */
exports.myDevices = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const devices = await Device.find({ companyId, employeeId: req.userId }).sort({
      createdAt: -1,
    });

    const detailed = await Promise.all(
      devices.map(async (device) => {
        const [policy, report] = await Promise.all([
          policyService.buildEffectivePolicy(device),
          service.latestReportFor(companyId, device._id),
        ]);
        return {
          device,
          restrictions: policy ? policy.sections : null,
          policyName: policy ? policy.policyName : null,
          exceptions: policy ? policy.exceptions : [],
          enforcement: report ? report.overallStatus() : "pending",
        };
      })
    );

    res.status(200).json({
      success: true,
      data: detailed,
      message: "Your devices fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.myRequests = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const requests = await AccessRequest.find({ companyId, requesterId: req.userId })
      .sort({ createdAt: -1 })
      .limit(200);
    res.status(200).json({
      success: true,
      data: requests,
      message: "Your requests fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.createRequest = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const request = await requestService.createRequest({
      companyId,
      requesterId: req.userId,
      deviceId: req.body.deviceId,
      category: req.body.category,
      resource: req.body.resource,
      reason: req.body.reason,
      requestedUntil: req.body.requestedUntil ? new Date(req.body.requestedUntil) : null,
    });
    res.status(201).json({ success: true, data: request, message: "Request submitted" });
  } catch (error) {
    next(error);
  }
};

exports.cancelRequest = async (req, res, next) => {
  try {
    const companyId = await _company(req);
    const request = await requestService.cancelRequest({
      companyId,
      requestId: req.params.id,
      requesterId: req.userId,
    });
    res.status(200).json({ success: true, data: request, message: "Request cancelled" });
  } catch (error) {
    next(error);
  }
};

exports.notFound = (req, res, next) =>
  next(new ApiError(`Device Control route ${req.originalUrl} does not exist`, 404));
