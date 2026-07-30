const ProjectModel = require("./projectModel");
const ProjectConfigurationModel = require("./projectConfigurationModel");
const ProjectMemberModel = require("./projectMemberModel");
const ApiError = require("../../../utils/apiError");
const { ProjectMemberRole } = require("./projectEnums");
const StatusService = require("../statuses/statusService");
const UserModel = require("../../users/userModel");
const ActivityService = require("../activities/activityService");
const { ActivityAction, ActivityEntityType } = require("../activities/activityEnums");
const IssueModel = require("../issues/issueModel");
// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the default project configuration settings object.
 */
function buildDefaultSettings() {
  return {
    timeTracking: { enabled: false },
    ai: { enabled: false },
    watchers: { enabled: true },
    components: { enabled: false },
    versions: { enabled: false },
    sprints: { enabled: false },
    activityLogs: { enabled: true },
    notifications: { enabled: true },
    guestAccess: { enabled: false },
    fileUploads: { enabled: true },
    comments: { enabled: true },
    automation: { enabled: false },
  };
}

/**
 * Append member list to a plain project object for the response.
 * Members are never stored on the Project document.
 */
async function appendMembers(projectObj) {
  const projectId = projectObj._id ?? projectObj.id;
  const members = await ProjectMemberModel.find({ projectId })
    .populate({
      path: "userId",
      model: UserModel,
      select: "fullName phone photo email",
    })
    .lean();

  projectObj.members = members.map((m) => {
    const user = m.userId && typeof m.userId === "object" ? m.userId : null;
    let userIdStr = null;
    if (user) {
      userIdStr = (user._id || user.id).toString();
    } else if (m.userId) {
      userIdStr = m.userId.toString();
    }

    return {
      id: m._id ? m._id.toString() : m.id,
      userId: userIdStr,
      fullName: user?.fullName ?? null,
      phone: user?.phone ?? null,
      email: user?.email ?? null,
      photo: user?.photo ?? null,
      role: m.role,
      permissions: m.permissions,
      isStarred: m.isStarred ?? false,
      isMuted: m.isMuted ?? false,
      joinedAt: m.joinedAt,
      lastSeenAt: m.lastSeenAt ?? null,
    };
  });
  return projectObj;
}

/**
 * Append dynamic analytics to projects based on real-time Issue calculations.
 */
async function appendAnalytics(projects) {
  if (!projects || projects.length === 0) return projects;

  const projectIds = projects.map((p) => p._id || p.id);
  const now = new Date();

  const analyticsResult = await IssueModel.aggregate([
    { $match: { projectId: { $in: projectIds }, deletedAt: null, archivedAt: null } },
    {
      $lookup: {
        from: "statuses",
        localField: "statusId",
        foreignField: "_id",
        as: "statusDoc"
      }
    },
    { $unwind: { path: "$statusDoc", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: "$projectId",
        tasksCount: { $sum: 1 },
        completedTasksCount: {
          $sum: { $cond: [{ $eq: ["$statusDoc.statusType", "done"] }, 1, 0] }
        },
        overdueTasksCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ["$dueDate", null] },
                  { $lt: ["$dueDate", now] },
                  { $ne: ["$statusDoc.statusType", "done"] }
                ]
              }, 1, 0
            ]
          }
        }
      }
    }
  ]);

  const analyticsMap = {};
  analyticsResult.forEach((item) => {
    analyticsMap[item._id.toString()] = item;
  });

  return projects.map((p) => {
    const pId = (p._id || p.id).toString();
    const data = analyticsMap[pId] || { tasksCount: 0, completedTasksCount: 0, overdueTasksCount: 0 };
    
    const tasksCount = data.tasksCount || 0;
    const completedTasksCount = data.completedTasksCount || 0;
    const overdueTasksCount = data.overdueTasksCount || 0;
    const progress = tasksCount > 0 ? (completedTasksCount / tasksCount) * 100 : 0;
    const membersCount = Array.isArray(p.members) ? p.members.length : 0;

    p.analytics = {
      tasksCount,
      completedTasksCount,
      overdueTasksCount,
      membersCount,
      filesCount: p.analytics?.filesCount || 0,
      commentsCount: p.analytics?.commentsCount || 0,
      progress
    };

    return p;
  });
}

// ── Service ──────────────────────────────────────────────────────────────────

class ProjectService {
  // ── Create ────────────────────────────────────────────────────────────────

  static async createProject(data, userId) {
    try {
      const { members, ...projectData } = data;
      const project = await ProjectModel.create({
        ...projectData,
        createdBy: userId,
        lastActivityAt: new Date(),
      });

      // Auto-provision configuration with defaults
      await ProjectConfigurationModel.create({
        projectId: project._id,
        settings: buildDefaultSettings(),
      });

      // Process and save members if provided in the payload
      const membersToCreate = [];

      if (Array.isArray(members)) {
        members.forEach((m) => {
          if (m.userId) {
            membersToCreate.push({
              projectId: project._id,
              userId: m.userId,
              role: m.role || ProjectMemberRole.MEMBER,
              permissions: m.permissions || m.premisions || {},
              isStarred: m.isStarred ?? false,
              isMuted: m.isMuted ?? false,
              joinedAt: m.joinedAt ? new Date(m.joinedAt) : new Date(),
              lastSeenAt: m.lastSeenAt ? new Date(m.lastSeenAt) : null,
            });
          }
        });
      }

      // Ensure the creator is added as OWNER if not already in the members list
      const hasCreator = membersToCreate.some(
        (m) => m.userId.toString() === userId.toString()
      );
      if (!hasCreator) {
        membersToCreate.push({
          projectId: project._id,
          userId,
          role: ProjectMemberRole.OWNER,
          permissions: {},
          isStarred: false,
          isMuted: false,
          joinedAt: new Date(),
          lastSeenAt: null,
        });
      }

      if (membersToCreate.length > 0) {
        await ProjectMemberModel.insertMany(membersToCreate);
      }

      // Auto-generate default statuses
      await StatusService.createDefaultStatuses(
        project._id.toString(),
        data.companyId,
        data.type,
        userId
      );

      return appendMembers(project.toObject());
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to create project: ${error.message}`, 500);
    }
  }

  // ── Members by projectId ──────────────────────────────────────────────────

  static async getProjectMembers(query = {}) {
    try {
      const {
        projectId,
        search,
        page: rawPage = 0,
        limit: rawLimit = 20,
      } = query;

      const excludeUserId = query["id!"] || query["id!="] || null;

      const page = Math.max(parseInt(rawPage, 10) || 0, 0);
      const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 20, 1), 100);

      // ── Base filter ─────────────────────────────────────────────────────────
      const filter = { projectId };

      if (excludeUserId) {
        filter.userId = { $ne: excludeUserId };
      }

      // ── Fetch all members with populated user data ───────────────────────────
      // We populate first, then apply search in-memory since search is on user
      // fields (fullName, email, phone) that live in a separate DB connection.
      let rawMembers = await ProjectMemberModel.find(filter)
        .populate({
          path: "userId",
          model: UserModel,
          select: "fullName phone photo email",
        })
        .sort({ joinedAt: -1 })
        .lean();

      // ── Search (in-memory on populated user fields) ──────────────────────────
      if (search) {
        const term = search.toLowerCase();
        rawMembers = rawMembers.filter((m) => {
          const user = m.userId && typeof m.userId === "object" ? m.userId : null;
          if (!user) return false;
          return (
            (user.fullName || "").toLowerCase().includes(term) ||
            (user.email || "").toLowerCase().includes(term) ||
            (user.phone || "").toLowerCase().includes(term)
          );
        });
      }

      // ── Pagination ───────────────────────────────────────────────────────────
      const total = rawMembers.length;
      const paginated = rawMembers.slice(page * limit, page * limit + limit);

      const members = paginated.map((m) => {
        const user = m.userId && typeof m.userId === "object" ? m.userId : null;
        let userIdStr = null;
        if (user) {
          userIdStr = (user._id || user.id).toString();
        } else if (m.userId) {
          userIdStr = m.userId.toString();
        }
        return {
          id: m._id ? m._id.toString() : m.id,
          projectId: m.projectId ? m.projectId.toString() : null,
          userId: userIdStr,
          fullName: user?.fullName ?? null,
          phone: user?.phone ?? null,
          email: user?.email ?? null,
          photo: user?.photo ?? null,
          role: m.role,
          permissions: m.permissions,
          isStarred: m.isStarred ?? false,
          isMuted: m.isMuted ?? false,
          joinedAt: m.joinedAt,
          lastSeenAt: m.lastSeenAt ?? null,
        };
      });

      return {
        members,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch project members: ${error.message}`, 500);
    }
  }

  // ── Helper: Difference Detection ──────────────────────────────────────────

  static _detectMemberDifferences(existingMembers, incomingMembers) {
    const existingMap = new Map();
    existingMembers.forEach(m => existingMap.set(String(m.userId), m));

    const incomingMap = new Map();
    incomingMembers.forEach(m => incomingMap.set(String(m.userId), m));

    const added = [];
    const removed = [];
    const updated = [];

    for (const m of incomingMembers) {
      const uid = String(m.userId);
      if (!existingMap.has(uid)) {
        added.push(m);
      } else {
        const ext = existingMap.get(uid);
        const roleChanged = ext.role !== m.role;
        const oldPerms = JSON.stringify(ext.permissions || {});
        const newPerms = JSON.stringify(m.permissions || {});
        const permsChanged = oldPerms !== newPerms;

        if (roleChanged || permsChanged || 
            (m.isStarred !== undefined && m.isStarred !== ext.isStarred) || 
            (m.isMuted !== undefined && m.isMuted !== ext.isMuted) ||
            (m.lastSeenAt !== undefined && String(m.lastSeenAt) !== String(ext.lastSeenAt))) {
          updated.push({
            ...m,
            _id: ext._id,
            roleChanged,
            permsChanged
          });
        }
      }
    }

    for (const ext of existingMembers) {
      if (!incomingMap.has(String(ext.userId))) {
        removed.push(ext);
      }
    }

    return { added, removed, updated };
  }

  // ── Helper: Log Activities ────────────────────────────────────────────────

  static async _logMemberActivities(project, currentUserId, added, removed, updated) {
    const actPromises = [];
    const { _id: projectId, companyId } = project;

    for (const r of removed) {
      actPromises.push(ActivityService.createActivity({
        companyId,
        projectId,
        userId: currentUserId || r.userId.toString(),
        action: ActivityAction.REMOVE_MEMBER,
        entityType: ActivityEntityType.MEMBER,
        entityId: r.userId.toString(),
        title: "Member removed",
        description: "A member was removed from the project",
        metadata: { removedUserId: r.userId.toString() }
      }));
    }

    for (const a of added) {
      actPromises.push(ActivityService.createActivity({
        companyId,
        projectId,
        userId: currentUserId || a.userId.toString(),
        action: ActivityAction.ADD_MEMBER,
        entityType: ActivityEntityType.MEMBER,
        entityId: a.userId.toString(),
        title: "Member added",
        description: `A new member was added to the project with role ${a.role}`,
        metadata: { addedUserId: a.userId.toString(), role: a.role }
      }));
    }

    for (const u of updated) {
      if (u.roleChanged || u.permsChanged) {
        let desc = "Member updated";
        if (u.roleChanged && u.permsChanged) desc = `Member role changed to ${u.role} and permissions updated`;
        else if (u.roleChanged) desc = `Member role changed to ${u.role}`;
        else desc = "Member permissions updated";

        actPromises.push(ActivityService.createActivity({
          companyId,
          projectId,
          userId: currentUserId || u.userId.toString(),
          action: ActivityAction.UPDATE,
          entityType: ActivityEntityType.MEMBER,
          entityId: u.userId.toString(),
          title: "Member updated",
          description: desc,
          metadata: { 
            updatedUserId: u.userId.toString(), 
            roleChanged: u.roleChanged, 
            permsChanged: u.permsChanged,
            newRole: u.role 
          }
        }));
      }
    }

    await Promise.allSettled(actPromises);
  }

  // ── Update members (bulk) ─────────────────────────────────────────────────

  static async updateProjectMembers(projectId, members, currentUserId) {
    try {
      const project = await ProjectModel.findOne({ _id: projectId, isDeleted: false });
      if (!project) throw new ApiError("Project not found", 404);

      if (currentUserId) {
        const currentUserMember = await ProjectMemberModel.findOne({ projectId, userId: currentUserId });
        if (!currentUserMember || (currentUserMember.role !== ProjectMemberRole.OWNER && currentUserMember.role !== ProjectMemberRole.ADMIN)) {
          throw new ApiError("You do not have permission to manage members", 403);
        }
      }

      // Check for duplicates
      if (!Array.isArray(members)) {
        throw new ApiError("members array is required", 400);
      }

      const uniqueUserIds = new Set();
      for (const m of members) {
        if (!m.userId) throw new ApiError("userId is required for all members", 400);
        if (uniqueUserIds.has(m.userId)) {
          throw new ApiError(`Duplicate member found in the payload: ${m.userId}`, 400);
        }
        uniqueUserIds.add(m.userId);
      }

      const incomingUserIds = Array.from(uniqueUserIds);

      // Validate users exist and belong to the same company
      const existingUsers = await UserModel.find({ _id: { $in: incomingUserIds } }).lean();
      if (existingUsers.length !== incomingUserIds.length) {
        throw new ApiError("One or more users in the members list do not exist", 400);
      }

      const projectCompanyId = project.companyId ? project.companyId.toString() : null;
      for (const user of existingUsers) {
        if (user.companyId && projectCompanyId && user.companyId.toString() !== projectCompanyId) {
          throw new ApiError(`User ${user.fullName || user._id} does not belong to the project's company`, 400);
        }
      }

      // Owner rules
      const incomingOwners = members.filter(m => m.role === ProjectMemberRole.OWNER);
      if (incomingOwners.length === 0) {
        throw new ApiError("The project must have at least one owner", 400);
      }

      // Self-protection
      if (currentUserId) {
        const existingSelf = await ProjectMemberModel.findOne({ projectId, userId: currentUserId });
        if (existingSelf && existingSelf.role === ProjectMemberRole.OWNER) {
          const incomingSelf = members.find(m => String(m.userId) === String(currentUserId));
          if (!incomingSelf || incomingSelf.role !== ProjectMemberRole.OWNER) {
            // Demoting or removing self
            const otherOwners = incomingOwners.filter(m => String(m.userId) !== String(currentUserId));
            if (otherOwners.length === 0) {
              throw new ApiError("You cannot remove your owner role without assigning another owner first", 400);
            }
          }
        }
      }

      // Difference Detection
      const existingMembers = await ProjectMemberModel.find({ projectId });
      const { added, removed, updated } = this._detectMemberDifferences(existingMembers, members);

      // DB Operations
      if (removed.length > 0) {
        await ProjectMemberModel.deleteMany({
          projectId,
          userId: { $in: removed.map(r => r.userId) }
        });
      }

      if (added.length > 0) {
        const toInsert = added.map(m => ({
          projectId,
          userId: m.userId,
          role: m.role || ProjectMemberRole.MEMBER,
          permissions: m.permissions || {},
          isStarred: m.isStarred ?? false,
          isMuted: m.isMuted ?? false,
          joinedAt: m.joinedAt ? new Date(m.joinedAt) : new Date(),
          lastSeenAt: m.lastSeenAt ? new Date(m.lastSeenAt) : null,
        }));
        await ProjectMemberModel.insertMany(toInsert);
      }

      if (updated.length > 0) {
        const allowedFields = ["role", "permissions", "isStarred", "isMuted", "lastSeenAt"];
        const bulkOps = updated.map(m => {
          const $set = {};
          allowedFields.forEach((f) => {
            if (m[f] !== undefined) $set[f] = m[f];
          });
          return {
            updateOne: {
              filter: { _id: m._id },
              update: { $set }
            }
          };
        });
        await ProjectMemberModel.bulkWrite(bulkOps);
      }

      // Activities
      await this._logMemberActivities(project, currentUserId, added, removed, updated);

      // Return the fresh list
      return ProjectService.getProjectMembers({ projectId });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to update members: ${error.message}`, 500);
    }
  }

  // ── Update member (single) ────────────────────────────────────────────────

  static async updateProjectMember(memberId, data) {
    try {
      const allowedFields = ["role", "permissions", "isStarred", "isMuted", "lastSeenAt"];
      const $set = {};
      allowedFields.forEach((f) => {
        if (data[f] !== undefined) $set[f] = data[f];
      });

      const updated = await ProjectMemberModel.findByIdAndUpdate(
        memberId,
        { $set },
        { new: true, runValidators: true }
      )
        .populate({ path: "userId", model: UserModel, select: "fullName phone photo email" })
        .lean();

      if (!updated) {
        throw new ApiError("Member not found", 404);
      }

      const user = updated.userId && typeof updated.userId === "object" ? updated.userId : null;
      let userIdStr = null;
      if (user) {
        userIdStr = (user._id || user.id).toString();
      } else if (updated.userId) {
        userIdStr = updated.userId.toString();
      }

      return {
        id: updated._id ? updated._id.toString() : updated.id,
        projectId: updated.projectId ? updated.projectId.toString() : null,
        userId: userIdStr,
        fullName: user?.fullName ?? null,
        phone: user?.phone ?? null,
        email: user?.email ?? null,
        photo: user?.photo ?? null,
        role: updated.role,
        permissions: updated.permissions,
        isStarred: updated.isStarred ?? false,
        isMuted: updated.isMuted ?? false,
        joinedAt: updated.joinedAt,
        lastSeenAt: updated.lastSeenAt ?? null,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to update member: ${error.message}`, 500);
    }
  }

  // ── Read (list) ───────────────────────────────────────────────────────────

  /**
   * Return a paginated list of projects.
   * Supports filtering by companyId, status, privacy, isArchived, isFavorite.
   * Supports full-text search on title and description.
   * Supports sorting by any valid project field.
   *
   * @param {Object} query - Express req.query
   */
  static async getProjects(query) {
    try {
      const page = Math.max(parseInt(query.page, 10) || 0, 0);
      const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
      const skip = page * limit;

      // ── Filter ────────────────────────────────────────────────────────────
      const filter = { isDeleted: false };

      const allowedFilters = [
        "companyId",
        "createdBy",
        "status",
        "privacy",
        "isFavorite",
        "isArchived",
      ];

      allowedFilters.forEach((field) => {
        if (query[field] === undefined || query[field] === "") return;
        const schemaPath = ProjectModel.schema.path(field);
        if (!schemaPath) return;

        const type = schemaPath.instance;
        if (type === "Boolean") {
          filter[field] = String(query[field]).toLowerCase() === "true";
        } else if (type === "ObjectId" || type === "String") {
          // Support pipe-separated OR values: status=active|planned
          if (String(query[field]).includes("|")) {
            filter[field] = {
              $in: String(query[field])
                .split("|")
                .map((v) => v.trim())
                .filter(Boolean),
            };
          } else {
            filter[field] = query[field];
          }
        }
      });

      // ── Search ────────────────────────────────────────────────────────────
      if (query.search) {
        filter.$or = [
          { title: { $regex: query.search, $options: "i" } },
          { description: { $regex: query.search, $options: "i" } },
        ];
      }

      // ── Sort ──────────────────────────────────────────────────────────────
      const SORTABLE_FIELDS = [
        "createdAt",
        "updatedAt",
        "lastActivityAt",
        "title",
        "status",
        "dueDate",
        "startDate",
      ];

      let sortQuery = { createdAt: -1 };
      if (query.sort) {
        const [field, order] = String(query.sort).split(":");
        if (SORTABLE_FIELDS.includes(field)) {
          sortQuery = { [field]: order === "asc" ? 1 : -1 };
        }
      }

      // ── Execute ───────────────────────────────────────────────────────────
      const [projects, total] = await Promise.all([
        ProjectModel.find(filter)
          .sort(sortQuery)
          .skip(skip)
          .limit(limit)
          .exec()
          .then((docs) => docs.map((d) => d.toObject())),
        ProjectModel.countDocuments(filter),
      ]);

      let projectsWithMembers = await Promise.all(
        projects.map((p) => appendMembers(p))
      );

      projectsWithMembers = await appendAnalytics(projectsWithMembers);

      return {
        projects: projectsWithMembers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch projects: ${error.message}`, 500);
    }
  }

  // ── Read (single) ─────────────────────────────────────────────────────────

  /**
   * Return a single project by ID, with members appended.
   *
   * @param {string} projectId
   */
  static async getProjectById(projectId) {
    try {
      const doc = await ProjectModel.findOne({
        _id: projectId,
        isDeleted: false,
      });

      const project = doc ? doc.toObject() : null;

      if (!project) {
        throw new ApiError("Project not found", 404);
      }

      const projectWithMembers = await appendMembers(project);
      const projectsWithAnalytics = await appendAnalytics([projectWithMembers]);
      return projectsWithAnalytics[0];
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch project: ${error.message}`, 500);
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────

  /**
   * Update a project by ID.
   * Only whitelisted fields are applied.
   *
   * @param {string} projectId
   * @param {Object} data       - Validated body
   */
  static async updateProject(projectId, data) {
    try {
      const UPDATABLE_FIELDS = [
        "title",
        "description",
        "logo",
        "color",
        "privacy",
        "status",
        "type",
        "isFavorite",
        "startDate",
        "dueDate",
      ];

      const updateFields = {};
      UPDATABLE_FIELDS.forEach((field) => {
        if (data[field] !== undefined) {
          updateFields[field] = data[field];
        }
      });

      if (Object.keys(updateFields).length === 0) {
        throw new ApiError("No valid fields provided for update", 400);
      }

      updateFields.lastActivityAt = new Date();

      const doc = await ProjectModel.findOneAndUpdate(
        { _id: projectId, isDeleted: false },
        { $set: updateFields },
        { new: true, runValidators: true }
      );

      const project = doc ? doc.toObject() : null;

      if (!project) {
        throw new ApiError("Project not found", 404);
      }

      return appendMembers(project);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to update project: ${error.message}`, 500);
    }
  }

  // ── Archive ───────────────────────────────────────────────────────────────

  /**
   * Soft-archive a project.
   *
   * @param {string} projectId
   */
  static async archiveProject(projectId) {
    try {
      const project = await ProjectModel.findOneAndUpdate(
        { _id: projectId, isDeleted: false, isArchived: false },
        {
          $set: {
            isArchived: true,
            archivedAt: new Date(),
            lastActivityAt: new Date(),
          },
        },
        { new: true }
      ).lean();

      if (!project) {
        throw new ApiError("Project not found or already archived", 404);
      }

      return project;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to archive project: ${error.message}`, 500);
    }
  }

  // ── Restore ───────────────────────────────────────────────────────────────

  /**
   * Restore an archived project.
   *
   * @param {string} projectId
   */
  static async restoreProject(projectId) {
    try {
      const project = await ProjectModel.findOneAndUpdate(
        { _id: projectId, isDeleted: false, isArchived: true },
        {
          $set: {
            isArchived: false,
            archivedAt: null,
            lastActivityAt: new Date(),
          },
        },
        { new: true }
      ).lean();

      if (!project) {
        throw new ApiError("Project not found or not archived", 404);
      }

      return project;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to restore project: ${error.message}`, 500);
    }
  }

  // ── Delete (soft) ─────────────────────────────────────────────────────────

  /**
   * Soft-delete a project by setting isDeleted = true.
   *
   * @param {string} projectId
   */
  static async deleteProject(projectId) {
    try {
      const project = await ProjectModel.findOneAndUpdate(
        { _id: projectId, isDeleted: false },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            lastActivityAt: new Date(),
          },
        },
        { new: true }
      ).lean();

      if (!project) {
        throw new ApiError("Project not found", 404);
      }

      return project;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to delete project: ${error.message}`, 500);
    }
  }

  // ── Stats (dynamic analytics) ─────────────────────────────────────────────

  /**
   * Return dynamic project counts for a given company.
   * Analytics are never persisted on the Project document.
   *
   * @param {string} companyId
   */
  static async getProjectStats(companyId) {
    try {
      const now = new Date();
      const baseFilter = { isDeleted: false };
      if (companyId) baseFilter.companyId = companyId;

      const [
        total,
        planned,
        active,
        onHold,
        completed,
        cancelled,
        archived,
        overdue,
        favorites,
      ] = await Promise.all([
        ProjectModel.countDocuments(baseFilter),
        ProjectModel.countDocuments({ ...baseFilter, status: "planned" }),
        ProjectModel.countDocuments({ ...baseFilter, status: "active" }),
        ProjectModel.countDocuments({ ...baseFilter, status: "on_hold" }),
        ProjectModel.countDocuments({ ...baseFilter, status: "completed" }),
        ProjectModel.countDocuments({ ...baseFilter, status: "cancelled" }),
        ProjectModel.countDocuments({ ...baseFilter, isArchived: true }),
        ProjectModel.countDocuments({
          ...baseFilter,
          dueDate: { $lt: now },
          status: { $nin: ["completed", "cancelled"] },
        }),
        ProjectModel.countDocuments({ ...baseFilter, isFavorite: true }),
      ]);

      return {
        total,
        byStatus: { planned, active, on_hold: onHold, completed, cancelled },
        archived,
        overdue,
        favorites,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch project stats: ${error.message}`, 500);
    }
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  /**
   * Return the configuration for a project.
   * Auto-creates a default config if one is missing (safety net).
   *
   * @param {string} projectId
   */
  static async getProjectConfiguration(projectId) {
    try {
      const project = await ProjectModel.exists({ _id: projectId, isDeleted: false });
      if (!project) {
        throw new ApiError("Project not found", 404);
      }

      let config = await ProjectConfigurationModel.findOne({ projectId });
      if (!config) {
        // Safety net: auto-create if missing
        config = await ProjectConfigurationModel.create({
          projectId,
          settings: buildDefaultSettings(),
        });
      }

      return config;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch configuration: ${error.message}`, 500);
    }
  }

  /**
   * Update the configuration (settings) for a project.
   * Uses $set with dot-notation so partial updates don't wipe other flags.
   *
   * @param {string} projectId
   * @param {Object} settings  - Partial or full settings object
   */
  static async updateProjectConfiguration(projectId, settings) {
    try {
      const project = await ProjectModel.exists({ _id: projectId, isDeleted: false });
      if (!project) {
        throw new ApiError("Project not found", 404);
      }

      // Build dot-notation $set to allow partial updates
      const dotSet = {};
      Object.entries(settings).forEach(([featureKey, featureVal]) => {
        if (featureVal && typeof featureVal === "object") {
          Object.entries(featureVal).forEach(([subKey, subVal]) => {
            dotSet[`settings.${featureKey}.${subKey}`] = subVal;
          });
        }
      });

      const config = await ProjectConfigurationModel.findOneAndUpdate(
        { projectId },
        { $set: dotSet },
        { new: true, upsert: true, runValidators: true }
      );

      return config;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to update configuration: ${error.message}`, 500);
    }
  }
}

module.exports = ProjectService;
