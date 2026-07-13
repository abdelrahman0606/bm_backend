const ProjectModel = require("./projectModel");
const ProjectConfigurationModel = require("./projectConfigurationModel");
const ProjectMemberModel = require("./projectMemberModel");
const ApiError = require("../../../utils/apiError");
const { ProjectMemberRole } = require("./projectEnums");
const StatusService = require("../statuses/statusService");

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
  const members = await ProjectMemberModel.find({ projectId }).lean();
  projectObj.members = members;
  return projectObj;
}

// ── Service ──────────────────────────────────────────────────────────────────

class ProjectService {
  // ── Create ────────────────────────────────────────────────────────────────

  static async createProject(data, userId) {
    try {
      const project = await ProjectModel.create({
        ...data,
        createdBy: userId,
        lastActivityAt: new Date(),
      });

      // Auto-provision configuration with defaults
      await ProjectConfigurationModel.create({
        projectId: project._id,
        settings: buildDefaultSettings(),
      });

      // Auto-add creator as owner member
      await ProjectMemberModel.create({
        projectId: project._id,
        userId,
        role: ProjectMemberRole.OWNER,
      });

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

      return {
        projects,
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

      return appendMembers(project);
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
