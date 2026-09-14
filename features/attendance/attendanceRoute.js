const express = require("express");

const router = express.Router();
const attendanceService = require("./attendanceService");
const {
  validateQrGeneration,
  validateCheckIn,
  validateFaceProfileRegistration,
} = require("./attendanceValidator");
const {
  validatorMiddleware,
} = require("../../middlewares/validatorMiddleware");
const { verifyAuthToken } = require("../../middlewares/authMiddleware");

// All routes require authentication
router.use(verifyAuthToken);

// Generate QR Code (Should ideally be restricted to Admin/HR roles)
router.post(
  "/qr",
  validateQrGeneration,
  validatorMiddleware,
  // TODO: Add role restriction middleware if available (e.g., restrictTo('admin', 'hr'))
  async (req, res, next) => {
    try {
      const qrData = await attendanceService.generateQrSession();
      res.status(201).json({
        success: true,
        data: qrData,
        message: "Attendance QR session generated successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

// Submit check-in (Offline or Online)
router.post(
  "/check-in",
  validateCheckIn,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const attendance = await attendanceService.checkIn(req.body, req.userId);
      res.status(201).json({
        success: true,
        data: attendance,
        message: "Attendance recorded successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get today's attendance for the logged in user
router.get("/today", async (req, res, next) => {
  try {
    const attendance = await attendanceService.getTodayAttendance(req.userId);
    res.status(200).json({
      success: true,
      data: attendance ? { attended: true, attendance } : { attended: false },
      message: attendance ? "Attendance found for today" : "No attendance recorded for today",
    });
  } catch (error) {
    next(error);
  }
});

// Get all attendances (with pagination and filtering)
router.get("/", async (req, res, next) => {
  try {
    // Assuming req.user is populated by verifyAuthToken, you can pass the role
    const userRole = req.user ? req.user.role : "employee";
    
    const result = await attendanceService.getAttendances(req.userId, userRole, req.query);
    res.status(200).json({
      success: true,
      data: result.attendances,
      pagination: result.pagination,
      message: "Attendances fetched successfully",
    });
  } catch (error) {
    next(error);
  }
});

// Register face profile
router.post(
  "/face-profile",
  validateFaceProfileRegistration,
  validatorMiddleware,
  async (req, res, next) => {
    try {
      const profile = await attendanceService.registerFaceProfile(req.body, req.userId);
      res.status(201).json({
        success: true,
        data: profile,
        message: "Face profile registered successfully",
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
