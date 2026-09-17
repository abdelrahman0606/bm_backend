const Attendance = require("../attendance/attendanceModel");
const { buildAttendanceResponse } = require("../attendance/attendanceService");
const IssueModel = require("../tasks_management/issues/issueModel");
const Company = require("../companies/companyModel");

exports.getMyDayData = async (userId, query) => {
  const { day, fields } = query || {};

  // Parse date and take only date part (start of day to end of day)
  let dateObj = new Date();
  if (day) {
    const parsedDate = new Date(day);
    if (!isNaN(parsedDate.getTime())) {
      dateObj = parsedDate;
    }
  }

  const startOfDay = new Date(dateObj);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(dateObj);
  endOfDay.setHours(23, 59, 59, 999);

  // Parse requested fields (default to attendance if not specified)
  const requestedFields = fields
    ? fields.split(",").map((f) => f.trim().toLowerCase())
    : ["attendance"];

  const result = {};

  if (requestedFields.includes("attendance")) {
    const attendance = await Attendance.findOne({
      userId,
      timestamp: { $gte: startOfDay, $lte: endOfDay },
    }).populate("userId", "fullName email phone");

    result.attendance = attendance ? buildAttendanceResponse(attendance) : null;
  }

  if (requestedFields.includes("issues")) {
    const userIdStr = String(userId);
    const rawIssues = await IssueModel.find({
      assignedTo: { $in: [userIdStr, userId] },
      deletedAt: null,
      $or: [
        {
          startDate: { $ne: null, $lte: endOfDay },
          dueDate: { $ne: null, $gte: startOfDay },
        },
        {
          $or: [{ dueDate: null }, { dueDate: { $exists: false } }],
          startDate: { $gte: startOfDay, $lte: endOfDay },
        },
        {
          $or: [{ startDate: null }, { startDate: { $exists: false } }],
          dueDate: { $gte: startOfDay, $lte: endOfDay },
        },
      ],
    })
      .populate("statusId", "title color statusType")
      .sort({ createdAt: -1 })
      .lean();

    // Fetch company names for companyIds
    const companyIds = [
      ...new Set(
        rawIssues.map((issue) => issue.companyId).filter(Boolean)
      ),
    ];

    const companies = companyIds.length
      ? await Company.find({ _id: { $in: companyIds } }).lean()
      : [];

    const companyMap = new Map();
    companies.forEach((comp) => {
      companyMap.set(comp._id.toString(), comp.title || comp.name || "");
    });

    const issues = rawIssues.map((issue) => {
      if (Array.isArray(issue.assignedTo)) {
        issue.assignedTo = issue.assignedTo.length > 0 ? String(issue.assignedTo[0]) : null;
      }

      if (issue.statusId && typeof issue.statusId === "object") {
        const s = issue.statusId;
        issue.status = {
          id: s._id ? s._id.toString() : String(s.id || ""),
          name: s.title || s.name || "",
          color: s.color || null,
          statusType: s.statusType || null,
        };
        issue.statusId = s._id ? s._id.toString() : String(s.id || "");
      } else {
        issue.status = null;
      }

      const compId = issue.companyId ? issue.companyId.toString() : null;
      issue.companyName = compId && companyMap.has(compId) ? companyMap.get(compId) : null;

      if (issue._id) {
        issue.id = issue._id.toString();
        delete issue._id;
      }
      delete issue.__v;
      return issue;
    });

    result.issues = issues;
  }

  return result;
};
