const crypto = require("crypto");
const Attendance = require("./attendanceModel");
const AttendanceQrSession = require("./attendanceQrSessionModel");
const EmployeeFaceProfile = require("./employeeFaceProfileModel");
const ApiError = require("../../utils/apiError");
const User = require("../users/userModel");
const Company = require("../companies/companyModel");
const engine = require("../../core/access/permissionEngine");
const {
  resolveCompanyForUser,
  companiesForUser,
} = require("../../core/access/companyResolver");
const faceRegistrationService = require("./faceRegistrationService");

/**
 * Whether `actorId` may read `employeeId`'s attendance.
 *
 * Reading somebody else's attendance is reading where they were and when, so
 * it takes a grant on the company they belong to - `attendance` view or
 * update - or being that company's creator, or master. A role name is not
 * enough on its own, which is what the previous check came down to: it read
 * `req.user.role`, a property nothing ever set, so `employeeId` was silently
 * ignored and every caller got their own records back.
 */
const _mayReadEmployeeAttendance = async (actorId, employeeId) => {
  if (!actorId) return false;
  if (String(actorId) === String(employeeId)) return true;

  const actorDoc = await User.findById(actorId).select("role permissions");
  if (!actorDoc) return false;

  const actor = new engine.Actor({
    id: String(actorDoc._id),
    role: actorDoc.role,
    permissions: actorDoc.permissions || [],
  });
  if (actor.isMaster) return true;

  const companies = await companiesForUser(employeeId);
  for (const companyId of companies) {
    if (
      engine.can(actor, "attendance", "view", companyId) ||
      engine.can(actor, "attendance", "update", companyId)
    ) {
      return true;
    }
    const company = await Company.findById(companyId).select("createdBy");
    if (company && String(company.createdBy) === String(actorId)) return true;
  }

  return false;
};

/**
 * Refuses a face-verified entry unless the person's registration is approved.
 *
 * The message says which state they are in, because "register your face",
 * "your request is still being reviewed" and "your request was rejected" call
 * for three different things from the user, and one generic refusal would
 * leave them guessing.
 */
const _assertFaceRegistrationApproved = async (userId, companyId) => {
  const { allowed, status } = await faceRegistrationService.faceVerificationAllowed(
    userId,
    companyId
  );
  if (allowed) return;

  if (status === "notRegistered") {
    throw new ApiError(
      "Your face is not registered yet. Submit a face registration request first.",
      403
    );
  }
  if (status === "pending") {
    throw new ApiError(
      "Your face registration is still awaiting approval.",
      403
    );
  }
  throw new ApiError(
    "Your face registration was rejected. Submit a new request to try again.",
    403
  );
};

const buildAttendanceResponse = (attendance) => {
  const userIdStr =
    attendance.userId && typeof attendance.userId === "object" && attendance.userId._id
      ? attendance.userId._id.toString()
      : attendance.userId
      ? attendance.userId.toString()
      : null;

  const compIdStr =
    attendance.companyId && typeof attendance.companyId === "object" && attendance.companyId._id
      ? attendance.companyId._id.toString()
      : attendance.companyId
      ? attendance.companyId.toString()
      : null;

  const res = {
    _id: attendance._id,
    id: attendance.id,
    userId: userIdStr,
    companyId: compIdStr,
    type: attendance.type,
    timestamp: attendance.timestamp,
    locationId: attendance.locationId,
    photo: attendance.photo !== undefined ? attendance.photo : null,
    similarity: attendance.similarity !== undefined ? attendance.similarity : null,
    latitude: attendance.latitude,
    longitude: attendance.longitude,
    address: attendance.address !== undefined ? attendance.address : null,
    verified: attendance.verified,
    verificationMethod: attendance.verificationMethod,
    similarityPercentage: attendance.similarityPercentage,
    createdAt: attendance.createdAt,
    updatedAt: attendance.updatedAt,
  };

  if (attendance.userId && typeof attendance.userId === "object" && attendance.userId._id) {
    res.user = {
      _id: attendance.userId._id,
      id: attendance.userId._id.toString(),
      fullName: attendance.userId.fullName,
      email: attendance.userId.email,
      phone: attendance.userId.phone,
    };
  }

  return res;
};

exports.generateQrSession = async () => {
  // Generate a secure random token
  const token = crypto.randomBytes(32).toString("hex");
  
  // Set expiration (e.g., 60 seconds from now)
  // This could be moved to config
  const expiresAt = new Date(Date.now() + 60 * 1000); 

  const session = await AttendanceQrSession.create({
    token,
    expiresAt,
  });

  return {
    token: session.token,
    expiresAt: session.expiresAt,
  };
};

exports.checkIn = async (data, userId) => {
  const { type, qrToken, faceEmbedding, latitude, longitude, address, deviceId } = data;

  // Resolved from the user's own relationships. The companyId in the body is
  // treated as a preference and checked against them, never as proof: it
  // decides which company's attendance record this becomes.
  const companyId = await resolveCompanyForUser(userId, data.companyId);

  // Check if user already attended today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const existingAttendance = await Attendance.findOne({
    userId,
    timestamp: { $gte: startOfDay, $lte: endOfDay },
  });

  if (existingAttendance) {
    throw new ApiError("Attendance for today is already recorded", 400);
  }

  const attendanceData = {
    userId,
    companyId,
    type,
    deviceId,
    timestamp: new Date(),
  };

  if (type === "offline") {
    // Attempt atomic QR consumption
    const session = await AttendanceQrSession.findOneAndUpdate(
      {
        token: qrToken,
        usedAt: null,
        expiresAt: { $gt: new Date() }, // Not expired
        status: "active",
      },
      {
        usedAt: new Date(),
        usedByUserId: userId,
        status: "used",
      },
      { new: true }
    );

    if (!session) {
      throw new ApiError(
        "Invalid, expired, or already used attendance QR token",
        400
      );
    }

    attendanceData.qrSessionId = session._id;
    attendanceData.verified = true;
    attendanceData.verificationMethod = "qr";
    
  } else if (type === "online") {
    // An online entry is face-verified, so it is only open to somebody whose
    // registration an approver has accepted.
    await _assertFaceRegistrationApproved(userId, companyId);

    // Face verification logic
    const profile = await EmployeeFaceProfile.findOne({ userId });
    if (!profile) {
      throw new ApiError("Employee face profile not found", 404);
    }

    // Placeholder for actual face verification similarity logic
    // Normally you'd compute cosine similarity between profile.embedding and faceEmbedding
    // eslint-disable-next-line no-unused-vars
    const unusedFaceEmbedding = faceEmbedding;
    const similarity = 0.95; // Fake similarity for now
    const SIMILARITY_THRESHOLD = 0.85; // Configurable threshold

    if (similarity < SIMILARITY_THRESHOLD) {
      throw new ApiError("Face verification failed", 400);
    }

    // Placeholder for actual location verification logic
    // Normally you'd check if latitude/longitude are within a geofence

    attendanceData.latitude = latitude;
    attendanceData.longitude = longitude;
    attendanceData.address = address;
    attendanceData.verified = true;
    attendanceData.verificationMethod = "face";
    attendanceData.similarityPercentage = similarity * 100;
  }

  const attendance = await Attendance.create(attendanceData);
  return buildAttendanceResponse(attendance);
};

exports.getTodayAttendance = async (userId) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const attendance = await Attendance.findOne({
    userId,
    timestamp: { $gte: startOfDay, $lte: endOfDay },
  }).populate("userId", "fullName email phone");

  return attendance ? buildAttendanceResponse(attendance) : null;
};

/**
 * One person's attendance records, newest first.
 *
 * Always scoped to exactly one employee: the caller, or - with authority over
 * their company - the employee named by `employeeId`. There is no unscoped
 * form, because "every attendance row on the deployment" is not a question
 * any screen asks.
 */
exports.getAttendances = async (userId, query) => {
  const q = query || {};
  const { page = 0, limit = 10, type, startDate, endDate, employeeId } = q;

  const filter = {};

  const asked = employeeId ? String(employeeId).trim() : "";
  if (asked && asked !== String(userId)) {
    const allowed = await _mayReadEmployeeAttendance(userId, asked);
    if (!allowed) {
      throw new ApiError(
        "You do not have permission to read this employee's attendance",
        403
      );
    }
    filter.userId = asked;
  } else {
    filter.userId = userId;
  }

  if (type) {
    filter.type = type;
  }
  
  if (startDate || endDate) {
    filter.timestamp = {};
    if (startDate) filter.timestamp.$gte = new Date(startDate);
    if (endDate) filter.timestamp.$lte = new Date(endDate);
  }

  const skip = page * limit;
  const attendances = await Attendance.find(filter)
    .populate("userId", "fullName email phone")
    .skip(skip)
    .limit(parseInt(limit, 10))
    .sort({ timestamp: -1 });

  const total = await Attendance.countDocuments(filter);

  return {
    attendances: attendances.map((a) => buildAttendanceResponse(a)),
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

exports.registerFaceProfile = async (data, userId) => {
  const { similarity, photo } = data;

  const companyId = await resolveCompanyForUser(userId, data.companyId);

  // This is the face-verified attendance write, so it carries the same gate
  // as an online check-in. Without it, the approval workflow could be walked
  // straight around by calling this endpoint instead.
  await _assertFaceRegistrationApproved(userId, companyId);

  const simVal = similarity !== undefined && similarity !== null ? Number(similarity) : null;

  if (simVal === null || isNaN(simVal) || simVal < 0.5) {
    throw new ApiError("Face verification failed: similarity must be at least 0.5", 400);
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  let attendance = await Attendance.findOne({
    userId,
    timestamp: { $gte: startOfDay, $lte: endOfDay },
  });

  if (attendance) {
    if (photo !== undefined) attendance.photo = photo;
    attendance.similarity = simVal;
    attendance.companyId = companyId;
    attendance.verificationMethod = "face";
    await attendance.save();
  } else {
    attendance = await Attendance.create({
      userId,
      companyId,
      type: "online",
      verified: true,
      verificationMethod: "face",
      photo: photo || null,
      similarity: simVal,
      timestamp: new Date(),
    });
  }

  return buildAttendanceResponse(attendance);
};

exports.registerLocation = async (data, userId) => {
  const { latitude, longitude, address } = data;

  // A location entry does not involve a face, so it carries no registration
  // gate — but the company it is filed under is still resolved here rather
  // than taken from the body.
  const companyId = await resolveCompanyForUser(userId, data.companyId);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  let attendance = await Attendance.findOne({
    userId,
    timestamp: { $gte: startOfDay, $lte: endOfDay },
  });

  if (attendance) {
    if (latitude !== undefined) attendance.latitude = latitude;
    if (longitude !== undefined) attendance.longitude = longitude;
    if (address !== undefined) attendance.address = address;
    attendance.companyId = companyId;
    attendance.verificationMethod = "location";
    await attendance.save();
  } else {
    attendance = await Attendance.create({
      userId,
      companyId,
      type: "online",
      verified: true,
      verificationMethod: "location",
      latitude: latitude !== undefined ? latitude : null,
      longitude: longitude !== undefined ? longitude : null,
      address: address || null,
      timestamp: new Date(),
    });
  }

  return buildAttendanceResponse(attendance);
};

exports.buildAttendanceResponse = buildAttendanceResponse;
