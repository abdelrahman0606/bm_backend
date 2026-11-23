const mongoose = require("mongoose");
const FaceRegistration = require("./faceRegistrationModel");
const EmployeeFaceProfile = require("./employeeFaceProfileModel");
const User = require("../users/userModel");
const Company = require("../companies/companyModel");
const ApiError = require("../../utils/apiError");
const engine = require("../../core/access/permissionEngine");
const {
  resolveCompanyForUser,
  userBelongsToCompany,
} = require("../../core/access/companyResolver");
const notifier = require("../../core/notifications/permissionNotifier");
const { NotificationType } = require("../notifications/notificationEnums");

/**
 * The face registration approval lifecycle.
 *
 *   notRegistered → pending → approved
 *                       └───→ rejected → pending (re-applied)
 *
 * `notRegistered` is the absence of a record, so the three stored statuses
 * are the only ones that can be written.
 *
 * The permission the queue is built on is `attendance` + `update`, with the
 * **company id as the grant's entity**: "may update attendance for company
 * X". That is the same shape every other grant has, so an approver is
 * appointed in the ordinary permission editor and nothing bespoke is needed.
 */

/** The resource and action that make somebody an approver. */
const APPROVAL_RESOURCE = "attendance";
const APPROVAL_ACTION = "update";

const _isId = (value) =>
  Boolean(value) && mongoose.Types.ObjectId.isValid(String(value));

/**
 * The shape the client sees.
 *
 * Deliberately narrow: the decision, who made it, and the photo reference the
 * reviewer looked at. No embedding, and no fields from the user document
 * beyond a name — a pending queue is not a staff directory.
 */
const buildRegistrationResponse = (doc, { includeUser = false } = {}) => {
  if (!doc) return { status: "notRegistered" };

  const user = includeUser && doc.userId && typeof doc.userId === "object"
    ? {
        id: String(doc.userId._id),
        fullName: doc.userId.fullName,
        email: doc.userId.email,
        photo: doc.userId.photo || null,
      }
    : undefined;

  const response = {
    id: String(doc._id),
    userId: String(
      doc.userId && doc.userId._id ? doc.userId._id : doc.userId
    ),
    companyId: String(doc.companyId),
    status: doc.status,
    requestedAt: doc.requestedAt,
    decidedBy: doc.decidedBy ? String(doc.decidedBy) : null,
    decidedAt: doc.decidedAt,
    rejectionReason: doc.rejectionReason,
    photo: doc.photo || null,
    attempts: doc.attempts,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };

  if (user) response.user = user;
  return response;
};

/**
 * Loads the actor's role and grants from the database.
 *
 * Never from the request: a role or permission list in a body is a claim.
 */
const _loadActor = async (userId) => {
  if (!_isId(userId)) return engine.Actor.anonymous();
  const user = await User.findById(userId).select("role permissions");
  if (!user) return engine.Actor.anonymous();
  return new engine.Actor({
    id: String(user._id),
    role: user.role,
    permissions: user.permissions || [],
  });
};

/**
 * Whether this actor may decide registrations for this company.
 *
 * A grant on the company, or master. A role on its own is not enough, which
 * is why this asks the engine about the company rather than reading
 * `actor.role`.
 */
const canApproveForCompany = async (userId, companyId) => {
  const actor = await _loadActor(userId);
  if (!actor.isAuthenticated) return false;
  if (actor.isMaster) return true;
  if (engine.can(actor, APPROVAL_RESOURCE, APPROVAL_ACTION, String(companyId))) {
    return true;
  }
  // The company's creator decides for their own company. A relationship, not
  // a title — the notifier uses the same rule, so the queue and the gate
  // agree about who is in it.
  const company = await Company.findById(companyId).select("createdBy");
  return Boolean(company) && String(company.createdBy) === String(userId);
};

/**
 * Where the signed-in user's registration stands.
 *
 * `companyId` from the client is a preference, checked against the companies
 * they belong to; it can narrow the question, never widen it.
 */
exports.getMyStatus = async (userId, claimedCompanyId = null) => {
  const companyId = await resolveCompanyForUser(userId, claimedCompanyId);
  const doc = await FaceRegistration.findOne({ userId, companyId });
  return { ...buildRegistrationResponse(doc), companyId: String(companyId) };
};

/**
 * Applies to register a face, or re-applies after a rejection.
 *
 * The client cannot choose the status. `pending` is the only state this
 * writes, so there is no request shape that reaches `approved` — approval
 * only ever happens in [exports.decide], behind the approver check.
 *
 * Concurrency: the write is a single upsert guarded on the current status, so
 * two taps, or a retry racing the first attempt, cannot produce two records
 * or reset a decision. The unique (userId, companyId) index is the backstop.
 */
exports.requestRegistration = async (userId, data = {}) => {
  const companyId = await resolveCompanyForUser(userId, data.companyId);
  const { photo = null, modelVersion = null, withNotify = true } = data;

  const existing = await FaceRegistration.findOne({ userId, companyId });

  if (existing && existing.status === "pending") {
    // Idempotent on purpose: a double tap is not an error worth showing.
    return {
      registration: buildRegistrationResponse(existing),
      created: false,
      notified: null,
    };
  }

  if (existing && existing.status === "approved") {
    throw new ApiError("Your face registration is already approved", 409);
  }

  let doc;
  let created = false;

  if (existing) {
    // Re-applying after a rejection. Guarded on the status we read, so a
    // decision arriving in between is not overwritten.
    doc = await FaceRegistration.findOneAndUpdate(
      { _id: existing._id, status: "rejected" },
      {
        $set: {
          status: "pending",
          requestedAt: new Date(),
          decidedBy: null,
          decidedAt: null,
          rejectionReason: null,
          photo,
          modelVersion,
        },
        $inc: { attempts: 1 },
      },
      { new: true }
    );

    if (!doc) {
      // Somebody decided it while we were deciding to re-apply.
      const current = await FaceRegistration.findOne({ userId, companyId });
      return {
        registration: buildRegistrationResponse(current),
        created: false,
        notified: null,
      };
    }
  } else {
    try {
      doc = await FaceRegistration.create({
        userId,
        companyId,
        status: "pending",
        requestedAt: new Date(),
        photo,
        modelVersion,
        attempts: 1,
      });
      created = true;
    } catch (error) {
      // The unique index fired: a concurrent request won. Return its record
      // rather than failing, because the user's intent was satisfied.
      if (error && error.code === 11000) {
        const current = await FaceRegistration.findOne({ userId, companyId });
        return {
          registration: buildRegistrationResponse(current),
          created: false,
          notified: null,
        };
      }
      throw error;
    }
  }

  let notified = null;
  if (withNotify) {
    const applicant = await User.findById(userId).select("fullName");
    const name =
      (applicant && applicant.fullName) || "An employee";

    notified = await notifier.notifyEntitled({
      companyId,
      resource: APPROVAL_RESOURCE,
      action: APPROVAL_ACTION,
      type: NotificationType.FACE_REGISTRATION_REQUESTED,
      title: "Face registration awaiting approval",
      body: `${name} has asked to register their face for attendance.`,
      priority: "high",
      createdBy: String(userId),
      notificationAction: {
        type: "face_registration",
        entityId: String(doc._id),
        route: "/attendance/face-registrations",
      },
      // Ids and a name only. No photo, no embedding, nothing biometric —
      // this payload leaves the system through a push transport.
      metadata: {
        registrationId: String(doc._id),
        applicantId: String(userId),
        applicantName: name,
        companyId: String(companyId),
        attempts: doc.attempts,
      },
      excludeUserIds: [String(userId)],
    });
  }

  return {
    registration: buildRegistrationResponse(doc),
    created,
    notified,
  };
};

/**
 * Approves or rejects a registration.
 *
 * The request id is checked against the company the *approver* may decide
 * for, so an id harvested from elsewhere does not become authority. The
 * company is read from the stored record, never from the request.
 */
exports.decide = async (approverId, registrationId, data = {}) => {
  const { approve, reason = null, withNotify = true } = data;

  if (typeof approve !== "boolean") {
    throw new ApiError("A decision must say approve: true or false", 400);
  }

  if (!_isId(registrationId)) {
    throw new ApiError("Face registration request not found", 404);
  }

  const existing = await FaceRegistration.findById(registrationId);
  if (!existing) {
    throw new ApiError("Face registration request not found", 404);
  }

  // Authority comes from the record's own company, so a client cannot widen
  // its reach by naming a company it does have access to.
  const allowed = await canApproveForCompany(approverId, existing.companyId);
  if (!allowed) {
    throw new ApiError(
      "You do not have permission to decide face registrations for this company",
      403
    );
  }

  if (String(existing.userId) === String(approverId)) {
    throw new ApiError("You cannot approve your own face registration", 403);
  }

  if (existing.status !== "pending") {
    throw new ApiError(
      `This request has already been ${existing.status}`,
      409
    );
  }

  const status = approve ? "approved" : "rejected";
  const trimmedReason =
    typeof reason === "string" && reason.trim() ? reason.trim() : null;

  if (!approve && !trimmedReason) {
    throw new ApiError("A rejection needs a reason", 400);
  }

  const decidedAt = new Date();

  // The guard on `status: "pending"` is the concurrency control: two
  // approvers pressing at once, one approve and one reject, resolve to
  // whichever write lands first and the loser is told it was already decided.
  const doc = await FaceRegistration.findOneAndUpdate(
    { _id: existing._id, status: "pending" },
    {
      $set: {
        status,
        decidedBy: approverId,
        decidedAt,
        rejectionReason: approve ? null : trimmedReason,
      },
      $push: {
        history: {
          status,
          decidedBy: approverId,
          decidedAt,
          reason: approve ? null : trimmedReason,
        },
      },
    },
    { new: true }
  );

  if (!doc) {
    const current = await FaceRegistration.findById(existing._id);
    throw new ApiError(
      `This request has already been ${current ? current.status : "decided"}`,
      409
    );
  }

  let notified = null;
  if (withNotify) {
    notified = await notifier.notifyUser({
      companyId: doc.companyId,
      userId: doc.userId,
      type: approve
        ? NotificationType.FACE_REGISTRATION_APPROVED
        : NotificationType.FACE_REGISTRATION_REJECTED,
      title: approve
        ? "Face registration approved"
        : "Face registration rejected",
      body: approve
        ? "You can now record attendance with face verification."
        : `Your face registration was rejected: ${trimmedReason}`,
      priority: "high",
      createdBy: String(approverId),
      notificationAction: {
        type: "face_registration",
        entityId: String(doc._id),
        route: "/attendance",
      },
      metadata: {
        registrationId: String(doc._id),
        status: doc.status,
        companyId: String(doc.companyId),
      },
    });
  }

  return { registration: buildRegistrationResponse(doc), notified };
};

/**
 * Where one employee's registration stands, read by an approver.
 *
 * The counterpart of [exports.getMyStatus] for somebody else's record, so a
 * member page can show where that person is without pulling the whole queue
 * and searching it client-side. The company is resolved from the approver's
 * own authority first, so this cannot be used to read another company's
 * records by naming a user in it.
 *
 * A user who never applied has no record, and gets `notRegistered` - the
 * state with the fewest privileges - rather than a 404: "nothing submitted"
 * is an answer, not a missing page.
 */
exports.getStatusForUser = async (
  approverId,
  targetUserId,
  claimedCompanyId = null
) => {
  if (!_isId(targetUserId)) {
    throw new ApiError("User not found", 404);
  }

  const companyId = await _resolveApproverCompany(approverId, claimedCompanyId);

  const doc = await FaceRegistration.findOne({
    userId: targetUserId,
    companyId,
  }).populate("userId", "fullName email photo");

  const profile = await EmployeeFaceProfile.findOne({
    userId: targetUserId,
  }).select("_id updatedAt modelVersion");

  return {
    ...buildRegistrationResponse(doc, { includeUser: true }),
    userId: String(targetUserId),
    companyId: String(companyId),
    // Whether an embedding is actually stored, which is a different question
    // from whether the request was approved: a revoked face leaves the
    // decision in the record and takes the biometric away.
    hasFaceProfile: Boolean(profile),
    faceProfileUpdatedAt: profile ? profile.updatedAt : null,
  };
};

/**
 * Removes an employee's stored face and closes face attendance for them.
 *
 * Two things happen, and both are the point: the embedding is deleted, so
 * nothing of their biometric is kept, and the decision is moved off
 * `approved`, so face-verified attendance stops being accepted. The record
 * is kept and the reason is pushed onto its history rather than deleting the
 * row - who removed a biometric, and when, is exactly the thing an audit
 * needs, and `rejected` is a state they can re-apply from.
 *
 * Revoking your own face is allowed: unlike approving your own request, it
 * only ever takes a privilege away.
 */
exports.revokeForUser = async (approverId, targetUserId, data = {}) => {
  const {
    reason = null,
    companyId: claimedCompanyId = null,
    withNotify = true,
  } = data;

  if (!_isId(targetUserId)) {
    throw new ApiError("User not found", 404);
  }

  const companyId = await _resolveApproverCompany(approverId, claimedCompanyId);

  const trimmedReason =
    typeof reason === "string" && reason.trim()
      ? reason.trim()
      : "Face removed by an approver";

  const removedProfile = await EmployeeFaceProfile.findOneAndDelete({
    userId: targetUserId,
  });

  const decidedAt = new Date();
  const doc = await FaceRegistration.findOneAndUpdate(
    { userId: targetUserId, companyId },
    {
      $set: {
        status: "rejected",
        decidedBy: approverId,
        decidedAt,
        rejectionReason: trimmedReason,
        photo: null,
      },
      $push: {
        history: {
          status: "rejected",
          decidedBy: approverId,
          decidedAt,
          reason: trimmedReason,
        },
      },
    },
    { new: true }
  );

  // Nothing to revoke at all - no embedding and no record - is told apart
  // from a successful removal, so a caller is not shown "removed" for a
  // person who never had a face stored.
  if (!doc && !removedProfile) {
    throw new ApiError("This user has no registered face", 404);
  }

  let notified = null;
  if (withNotify) {
    notified = await notifier.notifyUser({
      companyId: String(companyId),
      userId: String(targetUserId),
      type: NotificationType.FACE_REGISTRATION_REJECTED,
      title: "Face registration removed",
      body: `Your registered face was removed: ${trimmedReason}`,
      priority: "high",
      createdBy: String(approverId),
      notificationAction: {
        type: "face_registration",
        entityId: doc ? String(doc._id) : String(targetUserId),
        route: "/attendance",
      },
      metadata: {
        status: "rejected",
        companyId: String(companyId),
        faceProfileRemoved: Boolean(removedProfile),
      },
    });
  }

  return {
    registration: doc
      ? buildRegistrationResponse(doc)
      : { status: "notRegistered", userId: String(targetUserId), companyId: String(companyId) },
    faceProfileRemoved: Boolean(removedProfile),
    notified,
  };
};

/**
 * The registrations an approver may decide, for one company.
 *
 * The company is checked against the approver's own authority first, so this
 * cannot be used to read another company's queue by passing its id.
 */
exports.listForApprover = async (approverId, query = {}) => {
  const {
    page = 0,
    limit = 10,
    status = "pending",
    companyId: claimedCompanyId,
  } = query;

  const companyId = await _resolveApproverCompany(approverId, claimedCompanyId);

  const filter = { companyId };
  if (status && status !== "all") {
    filter.status = status;
  }

  const skip = Number(page) * Number(limit);
  const docs = await FaceRegistration.find(filter)
    .populate("userId", "fullName email photo")
    .skip(skip)
    .limit(parseInt(limit, 10))
    .sort({ requestedAt: -1 });

  const total = await FaceRegistration.countDocuments(filter);

  return {
    registrations: docs.map((doc) =>
      buildRegistrationResponse(doc, { includeUser: true })
    ),
    companyId: String(companyId),
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / Number(limit)),
    },
  };
};

/**
 * How many registrations are waiting on this approver.
 *
 * Its own endpoint because a badge should not have to fetch a page of
 * records to count them, and because the count has to be the approver's own
 * — a total that includes another company's queue is wrong, not merely
 * unhelpful. Zero for somebody who is not an approver at all.
 */
exports.pendingCountForApprover = async (approverId, claimedCompanyId = null) => {
  const actor = await _loadActor(approverId);
  if (!actor.isAuthenticated) return { pending: 0, companyId: null };

  let companyId;
  try {
    companyId = await _resolveApproverCompany(approverId, claimedCompanyId);
  } catch (error) {
    // Not an approver, or not in a company: nothing is waiting on them, and
    // a badge is not the place to raise it.
    return { pending: 0, companyId: null };
  }

  const pending = await FaceRegistration.countDocuments({
    companyId,
    status: "pending",
  });

  return { pending, companyId: String(companyId) };
};

/**
 * The company an approver is acting for, checked both ways.
 *
 * They must belong to it *and* be entitled to decide for it.
 */
const _resolveApproverCompany = async (approverId, claimedCompanyId) => {
  const actor = await _loadActor(approverId);

  // Master is not tied to a company by membership, so a claim is all there
  // is to go on — but it still has to be a real company id.
  if (actor.isMaster && _isId(claimedCompanyId)) {
    return String(claimedCompanyId);
  }

  if (_isId(claimedCompanyId)) {
    const belongs = await userBelongsToCompany(approverId, claimedCompanyId);
    if (!belongs) {
      throw new ApiError("You do not belong to that company", 403);
    }
  }

  const companyId = await resolveCompanyForUser(approverId, claimedCompanyId);

  const allowed = await canApproveForCompany(approverId, companyId);
  if (!allowed) {
    throw new ApiError(
      "You do not have permission to review face registrations for this company",
      403
    );
  }

  return companyId;
};

/**
 * Whether this user may record attendance by face right now.
 *
 * The one question the attendance endpoints ask. It returns the status with
 * the answer so a refusal can say *why*, which is the difference between
 * "register your face" and "your request is still being reviewed".
 */
exports.faceVerificationAllowed = async (userId, companyId) => {
  const doc = await FaceRegistration.findOne({ userId, companyId });
  const status = doc ? doc.status : "notRegistered";
  return { allowed: status === "approved", status };
};

exports.buildRegistrationResponse = buildRegistrationResponse;
exports.canApproveForCompany = canApproveForCompany;
exports.APPROVAL_RESOURCE = APPROVAL_RESOURCE;
exports.APPROVAL_ACTION = APPROVAL_ACTION;
