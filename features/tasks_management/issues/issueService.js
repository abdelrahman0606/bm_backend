const mongoose = require("mongoose");
const IssueModel        = require("./issueModel");
const WatcherModel      = require("../models/watcherModel");
const StatusModel       = require("../statuses/statusModel");
const SprintModel       = require("../models/sprintModel");
const ProjectModel      = require("../projects/projectModel");
const ProjectMemberModel = require("../projects/projectMemberModel");
const ActivityService   = require("../activities/activityService");
const { ActivityAction, ActivityEntityType } = require("../activities/activityEnums");
const UserModel         = require("../../users/userModel");
const ApiError          = require("../../../utils/apiError");

// ── Allowed update fields (whitelist) ─────────────────────────────────────────
const ALLOWED_UPDATE_FIELDS = new Set([
  "title", "description", "type", "priority", "visibility",
  "statusId", "sprintId", "milestoneId", "parentId",
  "assignedTo", "tags", "links", "dependencies", "blockedBy", "nextTaskIds",
  "timeTracking", "storyPoints", "progress", "order",
  "startDate", "dueDate",
]);

class IssueService {

  // ── Private Validation Helpers ──────────────────────────────────────────────

  /**
   * Ensures the project exists and is not deleted.
   * @returns {Promise<Object>} the project document
   */
  static async _validateProjectExists(projectId) {
    const project = await ProjectModel.findOne({ _id: projectId, isDeleted: false });
    if (!project) throw new ApiError("Project not found or has been deleted", 404);
    return project;
  }

  /**
   * Ensures the status belongs to the given project.
   */
  static async _validateStatusBelongsToProject(statusId, projectId) {
    if (!statusId) return;
    const status = await StatusModel.findOne({
      _id: statusId,
      projectId: projectId.toString(),
    });
    if (!status) throw new ApiError("Status does not belong to this project", 400);
  }

  /**
   * Ensures the sprint belongs to the given project.
   */
  static async _validateSprintBelongsToProject(sprintId, projectId) {
    if (!sprintId) return;
    const sprint = await SprintModel.findOne({ _id: sprintId, projectId });
    if (!sprint) throw new ApiError("Sprint does not belong to this project", 400);
  }

  /**
   * Ensures the parent issue belongs to the same project (and is not deleted).
   */
  static async _validateParentBelongsToProject(parentId, projectId) {
    if (!parentId) return;
    const parent = await IssueModel.findOne({
      _id: parentId,
      projectId,
      deletedAt: null,
    });
    if (!parent) throw new ApiError("Parent issue does not belong to this project", 400);
  }

  /**
   * Ensures the assigned user is a member of the project.
   */
  static async _validateAssigneeIsMember(userId, projectId) {
    if (!userId) return;
    const memberExists = await ProjectMemberModel.exists({
      projectId,
      userId,
    });
    if (!memberExists) {
      throw new ApiError("Assigned user is not a member of this project", 400);
    }
  }

  /**
   * Thin wrapper around ActivityService.createActivity — never throws.
   */
  static async _logActivity({ companyId, projectId, issueId, userId, action, title, description, metadata }) {
    await ActivityService.createActivity({
      companyId: companyId?.toString() ?? "",
      projectId: projectId?.toString() ?? "",
      issueId:   issueId?.toString()   ?? "",
      userId:    userId?.toString()    ?? "",
      action,
      entityType: ActivityEntityType.ISSUE,
      entityId:   issueId?.toString()  ?? "",
      title,
      description: description ?? "",
      metadata:    metadata    ?? {},
    });
  }

  /**
   * Detect which tracked fields changed between old and new values,
   * and fire targeted activity events.
   */
  static async _logFieldChanges(oldIssue, newData, userId) {
    const companyId  = oldIssue.companyId;
    const projectId  = oldIssue.projectId;
    const issueId    = oldIssue._id;

    const promises = [];

    if (newData.statusId !== undefined &&
        String(newData.statusId) !== String(oldIssue.statusId)) {
      promises.push(this._logActivity({
        companyId, projectId, issueId, userId,
        action:      ActivityAction.CHANGE_STATUS,
        title:       "Status changed",
        description: `Status changed on issue "${oldIssue.title}"`,
        metadata:    { from: oldIssue.statusId, to: newData.statusId },
      }));
    }

    if (newData.priority !== undefined && newData.priority !== oldIssue.priority) {
      promises.push(this._logActivity({
        companyId, projectId, issueId, userId,
        action:      ActivityAction.CHANGE_PRIORITY,
        title:       "Priority changed",
        description: `Priority changed from "${oldIssue.priority}" to "${newData.priority}"`,
        metadata:    { from: oldIssue.priority, to: newData.priority },
      }));
    }

    if (newData.sprintId !== undefined &&
        String(newData.sprintId) !== String(oldIssue.sprintId)) {
      promises.push(this._logActivity({
        companyId, projectId, issueId, userId,
        action:      ActivityAction.CHANGE_SPRINT,
        title:       "Sprint changed",
        description: `Sprint changed on issue "${oldIssue.title}"`,
        metadata:    { from: oldIssue.sprintId, to: newData.sprintId },
      }));
    }

    if (newData.assignedTo !== undefined) {
      if (String(oldIssue.assignedTo || "") !== String(newData.assignedTo || "")) {
        if (newData.assignedTo) {
          promises.push(this._logActivity({
            companyId, projectId, issueId, userId,
            action:      ActivityAction.ASSIGN,
            title:       "Assignee changed",
            description: `Assignee changed for issue "${oldIssue.title}"`,
            metadata:    { from: oldIssue.assignedTo, to: newData.assignedTo },
          }));
        } else if (oldIssue.assignedTo) {
          promises.push(this._logActivity({
            companyId, projectId, issueId, userId,
            action:      ActivityAction.UNASSIGN,
            title:       "Assignee removed",
            description: `Assignee removed from issue "${oldIssue.title}"`,
            metadata:    { removed: oldIssue.assignedTo },
          }));
        }
      }
    }

    await Promise.allSettled(promises);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * Create a new issue.
   * Validates: project, status, sprint, parentId, assignees.
   */
  static async createIssue(data, userId) {
    const {
      companyId, projectId, statusId, sprintId,
      parentId, assignedTo, ...rest
    } = data;

    // Validations
    await this._validateProjectExists(projectId);
    await this._validateStatusBelongsToProject(statusId, projectId);
    await this._validateSprintBelongsToProject(sprintId, projectId);
    await this._validateParentBelongsToProject(parentId, projectId);
    await this._validateAssigneeIsMember(assignedTo, projectId);

    const issue = await IssueModel.create({
      companyId,
      projectId,
      statusId:   statusId  || null,
      sprintId:   sprintId  || null,
      parentId:   parentId  || null,
      assignedTo: assignedTo || null,
      createdBy:  userId,
      ...rest,
    });

    await this._logActivity({
      companyId,
      projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.CREATE,
      title:       "Issue created",
      description: `Issue "${issue.title}" was created`,
    });

    return issue.toObject();
  }

  /**
   * Fetch a single non-deleted issue.
   */
  static async getIssueById(issueId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);
    
    const issueObj = issue.toObject();
    if (Array.isArray(issueObj.assignedTo)) {
      issueObj.assignedTo = issueObj.assignedTo.length > 0 ? String(issueObj.assignedTo[0]) : null;
    }
    return issueObj;
  }

  /**
   * Paginated, filtered, searchable issue list.
   *
   * Supported filters: companyId, projectId, sprintId, milestoneId, statusId,
   * assignedTo, createdBy, watcher, type, priority, tags (comma-sep), parentId,
   * archived ("true"|"false"|"only"), deleted ("true"|"false"|"only"),
   * search (title/description text).
   *
   * Sorting: sortBy (field name), sortOrder ("asc"|"desc").
   * Pagination: page (1-based), limit.
   */
  static async getIssues(filters = {}) {
    const {
      companyId, projectId, sprintId, milestoneId, statusId,
      assignedTo, createdBy, watcher, type, priority, parentId,
      tags, archived = "false", deleted = "false",
      search,
      sortBy = "createdAt", sortOrder = "desc",
      page = 1, limit = 20,
    } = filters;

    const query = {};

    // ── Tenant / Project ──────────────────────────────────────────────
    if (companyId)   query.companyId   = companyId;
    if (projectId)   query.projectId   = new mongoose.Types.ObjectId(projectId);
    if (sprintId)    query.sprintId    = new mongoose.Types.ObjectId(sprintId);
    if (milestoneId) query.milestoneId = new mongoose.Types.ObjectId(milestoneId);
    if (statusId)    query.statusId    = new mongoose.Types.ObjectId(statusId);
    if (parentId === "null") query.parentId = null;
    else if (parentId)       query.parentId = new mongoose.Types.ObjectId(parentId);

    // ── People ────────────────────────────────────────────────────────
    if (assignedTo) query.assignedTo = assignedTo;
    if (createdBy)  query.createdBy  = createdBy;

    // ── Watcher filter: resolve from WatcherModel ─────────────────────
    if (watcher) {
      const watchedIssueIds = await WatcherModel.distinct("issueId", { userId: watcher });
      query._id = { $in: watchedIssueIds };
    }

    // ── Classification ────────────────────────────────────────────────
    if (type)     query.type     = type;
    if (priority) query.priority = priority;

    // ── Tags (comma-separated, match ANY tag) ─────────────────────────
    if (tags) {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      if (tagList.length > 0) query.tags = { $in: tagList };
    }

    // ── Archived / Deleted ────────────────────────────────────────────
    if (deleted === "only") {
      query.deletedAt = { $ne: null };
    } else if (deleted === "true") {
      // include all (both deleted and non-deleted) — no filter
    } else {
      // default: exclude deleted
      query.deletedAt = null;
    }

    if (archived === "only") {
      query.archivedAt = { $ne: null };
    } else if (archived === "true") {
      // include all archived too — no additional filter
    } else {
      // default: exclude archived
      query.archivedAt = null;
    }

    // ── Full-text search ──────────────────────────────────────────────
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex   = new RegExp(escaped, "i");
      query.$or = [{ title: regex }, { description: regex }];
    }

    // ── Sorting ───────────────────────────────────────────────────────
    const ALLOWED_SORT_FIELDS = new Set([
      "createdAt", "updatedAt", "dueDate", "startDate", "priority",
      "order", "title", "type", "progress", "storyPoints",
    ]);
    const safeSortBy    = ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
    const safeSortOrder = sortOrder === "asc" ? 1 : -1;

    // ── Pagination ────────────────────────────────────────────────────
    const safePage  = Math.max(1, parseInt(page, 10)  || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip      = (safePage - 1) * safeLimit;

    const [issues, total] = await Promise.all([
      IssueModel.find(query)
        .sort({ [safeSortBy]: safeSortOrder })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      IssueModel.countDocuments(query),
    ]);

    // Backward compatibility: Convert legacy array assignedTo to string/null
    // Also convert _id to id for lean() objects
    const sanitizedIssues = issues.map(issue => {
      if (Array.isArray(issue.assignedTo)) {
        issue.assignedTo = issue.assignedTo.length > 0 ? String(issue.assignedTo[0]) : null;
      }
      if (issue._id) {
        issue.id = issue._id.toString();
        delete issue._id;
      }
      if (!('parentId' in issue)) {
        issue.parentId = null;
      }
      delete issue.__v;
      return issue;
    });

    return {
      issues: sanitizedIssues,
      pagination: {
        page:  safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Get complete issue statistics summary for a project.
   */
  static async getProjectIssueStats(projectId, userId) {
    const pId = new mongoose.Types.ObjectId(projectId);

    // Validate project exists
    await this._validateProjectExists(projectId);

    // Validate user access if provided
    if (userId) {
      const isMember = await ProjectMemberModel.exists({ projectId, userId });
      if (!isMember) {
        throw new ApiError("You do not have access to this project", 403);
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const thisWeekEnd = new Date(today);
    thisWeekEnd.setDate(today.getDate() + 7);

    const [statsResult] = await IssueModel.aggregate([
      { $match: { projectId: pId } },
      {
        $facet: {
          general: [
            {
              $group: {
                _id: null,
                totalIssues: { $sum: 1 },
                archivedIssues: { $sum: { $cond: [{ $ne: ["$archivedAt", null] }, 1, 0] } },
                deletedIssues: { $sum: { $cond: [{ $ne: ["$deletedAt", null] }, 1, 0] } },
                completedIssues: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$deletedAt", null] },
                          { $eq: ["$archivedAt", null] },
                          { $ne: ["$completedAt", null] }
                        ]
                      }, 1, 0
                    ]
                  }
                },
                openIssues: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$deletedAt", null] },
                          { $eq: ["$archivedAt", null] },
                          { $eq: ["$completedAt", null] }
                        ]
                      }, 1, 0
                    ]
                  }
                },
                totalProgressSum: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$deletedAt", null] }, { $eq: ["$archivedAt", null] }] },
                      { $ifNull: ["$progress", 0] },
                      0
                    ]
                  }
                },
                progressCount: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$deletedAt", null] }, { $eq: ["$archivedAt", null] }] },
                      1, 0
                    ]
                  }
                },
                totalEstimated: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$deletedAt", null] }, { $eq: ["$archivedAt", null] }] },
                      { $ifNull: ["$timeTracking.estimate", 0] }, 0
                    ]
                  }
                },
                totalTracked: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$deletedAt", null] }, { $eq: ["$archivedAt", null] }] },
                      { $ifNull: ["$timeTracking.logged", 0] }, 0
                    ]
                  }
                },
                totalRemaining: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ["$deletedAt", null] }, { $eq: ["$archivedAt", null] }] },
                      { $ifNull: ["$timeTracking.remaining", 0] }, 0
                    ]
                  }
                },
                blockedIssues: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$deletedAt", null] },
                          { $eq: ["$archivedAt", null] },
                          { $gt: [{ $size: { $ifNull: ["$blockedBy", []] } }, 0] }
                        ]
                      }, 1, 0
                    ]
                  }
                },
                subTasks: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ["$deletedAt", null] },
                          { $eq: ["$archivedAt", null] },
                          { $ne: ["$parentId", null] }
                        ]
                      }, 1, 0
                    ]
                  }
                }
              }
            }
          ],
          byStatus: [
            { $match: { deletedAt: null, archivedAt: null } },
            { $group: { _id: "$statusId", count: { $sum: 1 } } }
          ],
          byPriority: [
            { $match: { deletedAt: null, archivedAt: null } },
            { $group: { _id: "$priority", count: { $sum: 1 } } }
          ],
          byType: [
            { $match: { deletedAt: null, archivedAt: null } },
            { $group: { _id: "$type", count: { $sum: 1 } } }
          ],
          bySprint: [
            { $match: { deletedAt: null, archivedAt: null } },
            { $group: { _id: "$sprintId", count: { $sum: 1 } } }
          ],
          byDueDate: [
            { $match: { deletedAt: null, archivedAt: null, completedAt: null } },
            {
              $group: {
                _id: null,
                noDueDate: { $sum: { $cond: [{ $eq: ["$dueDate", null] }, 1, 0] } },
                overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $lt: ["$dueDate", today] }] }, 1, 0] } },
                dueToday: { $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $gte: ["$dueDate", today] }, { $lt: ["$dueDate", tomorrow] }] }, 1, 0] } },
                dueThisWeek: { $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $gte: ["$dueDate", tomorrow] }, { $lt: ["$dueDate", thisWeekEnd] }] }, 1, 0] } }
              }
            }
          ],
          unassignedIssues: [
            { $match: { deletedAt: null, archivedAt: null, $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }] } },
            { $count: "count" }
          ],
          assignees: [
            { $match: { deletedAt: null, archivedAt: null, assignedTo: { $ne: null } } },
            {
              $group: {
                _id: "$assignedTo",
                assignedIssuesCount: { $sum: 1 },
                completedIssuesCount: {
                  $sum: { $cond: [{ $ne: ["$completedAt", null] }, 1, 0] }
                }
              }
            },
            { $sort: { assignedIssuesCount: -1 } },
            { $limit: 20 }
          ],
          totalAssigned: [
            { $match: { deletedAt: null, archivedAt: null, assignedTo: { $ne: null } } },
            { $count: "count" }
          ],
          labels: [
            { $match: { deletedAt: null, archivedAt: null, "tags.0": { $exists: true } } },
            { $unwind: "$tags" },
            { $group: { _id: "$tags", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
          ]
        }
      }
    ]);

    // Fetch related documents
    const [statuses, sprints, recentActivity] = await Promise.all([
      StatusModel.find({ projectId }).lean(),
      SprintModel.find({ projectId }).lean(),
      IssueModel.find({ projectId: pId, deletedAt: null })
        .sort({ updatedAt: -1 })
        .limit(5)
        .select("_id title statusId updatedAt")
        .lean()
    ]);

    // Calculate Sprint stats
    const totalSprints = sprints.length;
    const activeSprint = sprints.find(s => s.status === "active") || null;
    const plannedSprintsCount = sprints.filter(s => s.status === "planning").length;
    const completedSprintsCount = sprints.filter(s => s.status === "completed").length;

    // Process Aggregation Result
    const gen = statsResult?.general[0] || {};
    const dd = statsResult?.byDueDate[0] || {};
    const unassignedCount = statsResult?.unassignedIssues?.[0]?.count || 0;
    const assignedCount = statsResult?.totalAssigned?.[0]?.count || 0;
    const assigneesGroup = statsResult?.assignees || [];
    
    // Fetch Users for Top Assignees
    const topAssigneeIds = assigneesGroup.map(a => a._id);
    let usersMap = {};
    if (topAssigneeIds.length > 0 && typeof UserModel !== "undefined") {
      const users = await UserModel.find({ _id: { $in: topAssigneeIds } }).select("fullName photo").lean();
      usersMap = users.reduce((acc, u) => {
        acc[u._id.toString()] = u;
        return acc;
      }, {});
    }

    const topAssignees = assigneesGroup.map(a => ({
      userId: a._id,
      fullName: usersMap[a._id]?.fullName || "Unknown User",
      photo: usersMap[a._id]?.photo || null,
      assignedIssuesCount: a.assignedIssuesCount,
      completedIssuesCount: a.completedIssuesCount
    }));

    // Sprints specific mapping
    const bySprint = statsResult?.bySprint || [];
    const activeSprintCount = bySprint.find(b => b._id && String(b._id) === String(activeSprint?._id))?.count || 0;
    const backlogCount = bySprint.find(b => b._id === null)?.count || 0;
    const avgIssuesPerSprint = totalSprints > 0 ? Math.round((gen.totalIssues || 0) / totalSprints) : 0;

    // By Status mapping
    const statusCounts = (statsResult?.byStatus || []).reduce((acc, s) => {
      acc[s._id ? s._id.toString() : "null"] = s.count;
      return acc;
    }, {});

    const byStatus = statuses.map(s => ({
      statusId: s._id,
      statusTitle: s.title,
      statusColor: s.color,
      statusType: s.statusType,
      issuesCount: statusCounts[s._id.toString()] || 0
    }));

    // Priority Map
    const prioCounts = (statsResult?.byPriority || []).reduce((acc, p) => { acc[p._id] = p.count; return acc; }, {});
    const byPriority = {
      Lowest: prioCounts["lowest"] || 0,
      Low: prioCounts["low"] || 0,
      Medium: prioCounts["medium"] || 0,
      High: prioCounts["high"] || 0,
      Urgent: prioCounts["urgent"] || 0
    };

    // Type Map
    const typeCounts = (statsResult?.byType || []).reduce((acc, t) => { acc[t._id] = t.count; return acc; }, {});
    const byIssueType = {
      Task: typeCounts["task"] || 0,
      Bug: typeCounts["bug"] || 0,
      Story: typeCounts["story"] || 0,
      Epic: typeCounts["epic"] || 0,
      Feature: typeCounts["feature"] || 0,
      Improvement: typeCounts["improvement"] || 0,
      "Sub-task": typeCounts["sub-task"] || 0
    };
    
    // Progress calculation
    const completionPercentage = gen.totalIssues > 0 ? Math.round(((gen.completedIssues || 0) / gen.totalIssues) * 100) : 0;
    const overallProgress = gen.progressCount > 0 ? Math.round(gen.totalProgressSum / gen.progressCount) : completionPercentage;

    return {
      general: {
        totalIssues: gen.totalIssues || 0,
        openIssues: gen.openIssues || 0,
        completedIssues: gen.completedIssues || 0,
        archivedIssues: gen.archivedIssues || 0,
        deletedIssues: gen.deletedIssues || 0,
        completionPercentage
      },
      byStatus,
      byPriority,
      byIssueType,
      sprintStatistics: {
        totalSprints,
        activeSprint,
        plannedSprints: plannedSprintsCount,
        completedSprints: completedSprintsCount,
        issuesInActiveSprint: activeSprintCount,
        issuesInBacklog: backlogCount
      },
      assignmentStatistics: {
        assignedIssues: assignedCount,
        unassignedIssues: unassignedCount,
        topAssignees
      },
      dueDateStatistics: {
        overdueIssues: dd.overdue || 0,
        dueToday: dd.dueToday || 0,
        dueThisWeek: dd.dueThisWeek || 0,
        noDueDate: dd.noDueDate || 0
      },
      progress: {
        overallProjectProgress: overallProgress,
        completed: gen.completedIssues || 0,
        remaining: gen.openIssues || 0
      },
      timeTracking: {
        totalEstimatedMinutes: gen.totalEstimated || 0,
        totalTrackedMinutes: gen.totalTracked || 0,
        remainingMinutes: gen.totalRemaining || 0
      },
      recentActivity: recentActivity.map(r => ({
        id: r._id,
        title: r.title,
        statusId: r.statusId,
        updatedAt: r.updatedAt
      })),
      optionalInsights: {
        mostUsedLabels: statsResult?.labels?.map(l => l._id) || [],
        averageIssuesPerSprint: avgIssuesPerSprint,
        numberOfBlockedIssues: gen.blockedIssues || 0,
        numberOfSubTasks: gen.subTasks || 0
      }
    };
  }

  /**
   * Update issue fields. Detects and logs targeted activity events for
   * status, priority, sprint, and assignment changes.
   */
  static async updateIssue(issueId, data, userId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    // Re-validate relational fields if they are being changed
    if (data.statusId !== undefined)
      await this._validateStatusBelongsToProject(data.statusId, issue.projectId);
    if (data.sprintId !== undefined)
      await this._validateSprintBelongsToProject(data.sprintId, issue.projectId);
    if (data.parentId !== undefined)
      await this._validateParentBelongsToProject(data.parentId, issue.projectId);
    if (data.assignedTo !== undefined)
      await this._validateAssigneeIsMember(data.assignedTo, issue.projectId);

    // Log targeted field-change activities before applying the update
    await this._logFieldChanges(issue, data, userId);

    // Apply only whitelisted fields
    for (const [key, value] of Object.entries(data)) {
      if (ALLOWED_UPDATE_FIELDS.has(key)) {
        issue[key] = value;
      }
    }
    issue.lastActivityAt = new Date();

    await issue.save();

    // Generic "updated" activity
    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.UPDATE,
      title:       "Issue updated",
      description: `Issue "${issue.title}" was updated`,
    });

    const issueObj = issue.toObject();
    if (Array.isArray(issueObj.assignedTo)) {
      issueObj.assignedTo = issueObj.assignedTo.length > 0 ? String(issueObj.assignedTo[0]) : null;
    }
    
    return issueObj;
  }

  /**
   * Soft-delete an issue (sets deletedAt).
   */
  static async deleteIssue(issueId, userId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    issue.deletedAt      = new Date();
    issue.lastActivityAt = new Date();
    await issue.save();

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.DELETE,
      title:       "Issue deleted",
      description: `Issue "${issue.title}" was deleted`,
    });

    return issue.toObject();
  }

  /**
   * Archive an issue (sets archivedAt).
   */
  static async archiveIssue(issueId, userId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    if (issue.archivedAt) throw new ApiError("Issue is already archived", 400);

    issue.archivedAt     = new Date();
    issue.lastActivityAt = new Date();
    await issue.save();

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.ARCHIVE,
      title:       "Issue archived",
      description: `Issue "${issue.title}" was archived`,
    });

    return issue.toObject();
  }

  /**
   * Restore a soft-deleted or archived issue.
   */
  static async restoreIssue(issueId, userId) {
    const issue = await IssueModel.findById(issueId);
    if (!issue) throw new ApiError("Issue not found", 404);

    if (!issue.deletedAt && !issue.archivedAt) {
      throw new ApiError("Issue is neither deleted nor archived", 400);
    }

    issue.deletedAt      = null;
    issue.archivedAt     = null;
    issue.lastActivityAt = new Date();
    await issue.save();

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.RESTORE,
      title:       "Issue restored",
      description: `Issue "${issue.title}" was restored`,
    });

    return issue.toObject();
  }

  /**
   * Duplicate an issue (deep clone, resets dates and order).
   */
  static async duplicateIssue(issueId, userId) {
    const source = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!source) throw new ApiError("Issue not found", 404);

    const sourceObj = source.toObject();
    delete sourceObj._id;
    delete sourceObj.id;
    delete sourceObj.createdAt;
    delete sourceObj.updatedAt;

    const cloned = await IssueModel.create({
      ...sourceObj,
      title:         `${source.title} (Copy)`,
      createdBy:     userId,
      order:         source.order + 1,
      startDate:     null,
      dueDate:       null,
      completedAt:   null,
      archivedAt:    null,
      deletedAt:     null,
      lastActivityAt: null,
      progress:      0,
      checklist:     source.checklist.map((item) => ({
        title:     item.title,
        completed: false,
        order:     item.order,
      })),
    });

    await this._logActivity({
      companyId:   cloned.companyId,
      projectId:   cloned.projectId,
      issueId:     cloned._id,
      userId,
      action:      ActivityAction.DUPLICATE,
      title:       "Issue duplicated",
      description: `Issue duplicated from "${source.title}"`,
      metadata:    { sourceId: source._id },
    });

    return cloned.toObject();
  }

  // ── Specialized Actions ────────────────────────────────────────────────────

  /**
   * Move an issue to a different status column.
   * Validates that the status belongs to the issue's project.
   */
  static async moveStatus(issueId, statusId, userId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    await this._validateStatusBelongsToProject(statusId, issue.projectId);

    const oldStatusId    = issue.statusId;
    issue.statusId       = statusId || null;
    issue.lastActivityAt = new Date();
    await issue.save();

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.CHANGE_STATUS,
      title:       "Status changed",
      description: `Issue "${issue.title}" moved to a new status`,
      metadata:    { from: oldStatusId, to: issue.statusId },
    });

    return issue.toObject();
  }

  /**
   * Move an issue to a different sprint (or backlog when sprintId is null).
   * Validates that the sprint belongs to the issue's project.
   */
  static async moveSprint(issueId, sprintId, userId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    await this._validateSprintBelongsToProject(sprintId, issue.projectId);

    const oldSprintId    = issue.sprintId;
    issue.sprintId       = sprintId || null;
    issue.lastActivityAt = new Date();
    await issue.save();

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.CHANGE_SPRINT,
      title:       "Sprint changed",
      description: `Issue "${issue.title}" moved to a new sprint`,
      metadata:    { from: oldSprintId, to: issue.sprintId },
    });

    return issue.toObject();
  }

  /**
   * Change the assignee of an issue.
   */
  static async assignIssue(issueId, assignedTo, userId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    await this._validateAssigneeIsMember(assignedTo, issue.projectId);

    const oldAssignedTo  = issue.assignedTo;
    issue.assignedTo     = assignedTo || null;
    issue.lastActivityAt = new Date();
    await issue.save();

    if (String(oldAssignedTo || "") !== String(issue.assignedTo || "")) {
      if (issue.assignedTo) {
        await this._logActivity({
          companyId:   issue.companyId,
          projectId:   issue.projectId,
          issueId:     issue._id,
          userId,
          action:      ActivityAction.ASSIGN,
          title:       "Assignee changed",
          description: `Assignee changed for issue "${issue.title}"`,
          metadata:    { from: oldAssignedTo, to: issue.assignedTo },
        });
      } else if (oldAssignedTo) {
        await this._logActivity({
          companyId:   issue.companyId,
          projectId:   issue.projectId,
          issueId:     issue._id,
          userId,
          action:      ActivityAction.UNASSIGN,
          title:       "Assignee removed",
          description: `Assignee removed from issue "${issue.title}"`,
          metadata:    { removed: oldAssignedTo },
        });
      }
    }

    const issueObj = issue.toObject();
    if (Array.isArray(issueObj.assignedTo)) {
      issueObj.assignedTo = issueObj.assignedTo.length > 0 ? String(issueObj.assignedTo[0]) : null;
    }
    
    return issueObj;
  }

  /**
   * Bulk-update the `order` field for multiple issues within a status column.
   * Expects items = [{ id, order }]
   */
  static async reorderIssues(items, userId) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError("items must be a non-empty array", 400);
    }

    const bulkOps = items.map(({ id, order }) => ({
      updateOne: {
        filter: { _id: new mongoose.Types.ObjectId(id) },
        update: { $set: { order, lastActivityAt: new Date() } },
      },
    }));

    await IssueModel.bulkWrite(bulkOps, { ordered: false });

    return { reordered: items.length };
  }

  // ── Watchers ───────────────────────────────────────────────────────────────

  /**
   * Add a watcher to an issue. No-op if the watcher already exists (upsert).
   */
  static async addWatcher(issueId, userId, currentUserId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    const watcher = await WatcherModel.findOneAndUpdate(
      { issueId, userId },
      { issueId, userId },
      { upsert: true, new: true }
    );

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId:      currentUserId || userId,
      action:      ActivityAction.ADD_WATCHER,
      title:       "Watcher added",
      description: `A watcher was added to issue "${issue.title}"`,
      metadata:    { watcherId: userId },
    });

    return watcher.toObject();
  }

  /**
   * Remove a watcher from an issue.
   */
  static async removeWatcher(issueId, userId, currentUserId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    await WatcherModel.findOneAndDelete({ issueId, userId });

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId:      currentUserId || userId,
      action:      ActivityAction.REMOVE_WATCHER,
      title:       "Watcher removed",
      description: `A watcher was removed from issue "${issue.title}"`,
      metadata:    { watcherId: userId },
    });

    return { message: "Watcher removed" };
  }

  /**
   * Get all watchers for an issue.
   */
  static async getWatchers(issueId) {
    const watchers = await WatcherModel.find({ issueId }).lean();
    return watchers;
  }

  // ── Checklist (embedded) ───────────────────────────────────────────────────

  /**
   * Add a checklist item to an issue (embedded in Issue document).
   */
  static async addChecklistItem(issueId, itemData, userId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    const newItem = {
      title:     itemData.title,
      completed: false,
      order:     itemData.order ?? issue.checklist.length,
    };

    issue.checklist.push(newItem);
    issue.lastActivityAt = new Date();
    await issue.save();

    const addedItem = issue.checklist[issue.checklist.length - 1];

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.ADD_CHECKLIST,
      title:       "Checklist item added",
      description: `Checklist item "${newItem.title}" added to issue "${issue.title}"`,
    });

    return addedItem.toObject();
  }

  /**
   * Update a checklist item inside an issue.
   */
  static async updateChecklistItem(issueId, itemId, updateData, userId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    const item = issue.checklist.id(itemId);
    if (!item) throw new ApiError("Checklist item not found", 404);

    if (updateData.title     !== undefined) item.title     = updateData.title;
    if (updateData.completed !== undefined) {
      item.completed   = updateData.completed;
      item.completedBy = updateData.completed ? userId : null;
    }
    if (updateData.order !== undefined) item.order = updateData.order;

    issue.lastActivityAt = new Date();
    await issue.save();

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.UPDATE_CHECKLIST,
      title:       "Checklist item updated",
      description: `Checklist item "${item.title}" updated in issue "${issue.title}"`,
    });

    return item.toObject();
  }

  /**
   * Delete a checklist item from an issue.
   */
  static async deleteChecklistItem(issueId, itemId, userId) {
    const issue = await IssueModel.findOne({ _id: issueId, deletedAt: null });
    if (!issue) throw new ApiError("Issue not found", 404);

    const item = issue.checklist.id(itemId);
    if (!item) throw new ApiError("Checklist item not found", 404);

    const itemTitle = item.title;
    item.deleteOne();
    issue.lastActivityAt = new Date();
    await issue.save();

    await this._logActivity({
      companyId:   issue.companyId,
      projectId:   issue.projectId,
      issueId:     issue._id,
      userId,
      action:      ActivityAction.DELETE_CHECKLIST,
      title:       "Checklist item deleted",
      description: `Checklist item "${itemTitle}" deleted from issue "${issue.title}"`,
    });

    return { message: "Checklist item deleted" };
  }
}

module.exports = IssueService;
