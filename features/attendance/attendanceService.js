const crypto = require("crypto");
const Attendance = require("./attendanceModel");
const AttendanceQrSession = require("./attendanceQrSessionModel");
const EmployeeFaceProfile = require("./employeeFaceProfileModel");
const ApiError = require("../../utils/apiError");

const buildAttendanceResponse = (attendance) => ({
  _id: attendance._id,
    id: attendance.id,
    userId: attendance.userId,
    type: attendance.type,
    timestamp: attendance.timestamp,
    locationId: attendance.locationId,
    latitude: attendance.latitude,
    longitude: attendance.longitude,
    verified: attendance.verified,
    verificationMethod: attendance.verificationMethod,
    similarityPercentage: attendance.similarityPercentage,
    createdAt: attendance.createdAt,
    updatedAt: attendance.updatedAt,
  });

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
  const { type, qrToken, faceEmbedding, latitude, longitude, deviceId } = data;

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
  });

  return attendance ? buildAttendanceResponse(attendance) : null;
};

exports.getAttendances = async (userId, userRole, query) => {
  const q = query || {};
  const { page = 0, limit = 10, type, startDate, endDate, employeeId } = q;
  
  // Normal users can only see their own attendance.
  // Admins/HR could see others (assuming you handle role check before/here).
  const filter = {};
  
  // Basic role handling: if not an admin role, force userId
  // Modify according to the exact roles in your system
  const adminRoles = ["master", "admin", "manager", "hr"]; // adjust based on userModel.js
  if (adminRoles.includes(userRole)) {
    if (employeeId) filter.userId = employeeId;
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
    .populate("userId", "fullName email") // Example population
    .skip(skip)
    .limit(parseInt(limit, 10))
    .sort({ timestamp: -1 });

  const total = await Attendance.countDocuments(filter);

  return {
    attendances: attendances.map((a) => {
      // Optional: you can include populated user data in the response if needed
      const res = buildAttendanceResponse(a);
      if (a.userId && a.userId.fullName) {
        res.user = {
          id: a.userId._id,
          fullName: a.userId.fullName,
          email: a.userId.email,
        };
      }
      return res;
    }),
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

exports.registerFaceProfile = async (data, userId) => {
  const { embedding } = data;
  
  let profile = await EmployeeFaceProfile.findOne({ userId });
  if (profile) {
    profile.embedding = embedding;
    profile.updatedAt = new Date();
    await profile.save();
  } else {
    profile = await EmployeeFaceProfile.create({
      userId,
      embedding,
    });
  }
  
  return {
    id: profile.id,
    userId: profile.userId,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
};
