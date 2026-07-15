const SprintModel = require("../models/sprintModel");
const { SprintStatus } = require("../models/sprintModel");
const ProjectModel = require("../projects/projectModel");
const { ProjectType } = require("../projects/projectEnums");
const ActivityService = require("../activities/activityService");
const { ActivityAction, ActivityEntityType } = require("../activities/activityEnums");
const ApiError = require("../../../utils/apiError");

// ── Constants ─────────────────────────────────────────────────────────────────


// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validate that the project exists and supports Sprints.
 */
async function assertSprintSupported(projectId) {
  const project = await ProjectModel.findById(projectId).lean();
  if (!project) {
    throw new ApiError("Project not found", 404);
  }

  return project;
}

/**
 * Get the next sprint number for a project (max existing + 1).
 */
async function nextSprintNumber(projectId) {
  const last = await SprintModel.findOne({ projectId })
    .sort({ number: -1 })
    .select("number")
    .lean();
  return last ? last.number + 1 : 1;
}

/**
 * Log an activity for a sprint action.
 */
async function logSprintActivity({ companyId, projectId, sprintId, userId, action, title, description, metadata }) {
  await ActivityService.createActivity({
    companyId,
    projectId,
    userId,
    action,
    entityType: ActivityEntityType.SPRINT,
    entityId: sprintId,
    title,
    description: description || "",
    metadata: metadata || {},
  });
}

// ── Service ───────────────────────────────────────────────────────────────────

class SprintService {
  // ── Create ────────────────────────────────────────────────────────────────

  static async createSprint(data, userId) {
    try {
      const { projectId, companyId, title, goal, startDate, endDate, boardId } = data;

      // Validate project & type
      const project = await assertSprintSupported(projectId);

      // Validate dates if both provided
      if (startDate && endDate && new Date(startDate) >= new Date(endDate)) {
        throw new ApiError("startDate must be before endDate", 400);
      }

      // Auto-increment sprint number
      const number = await nextSprintNumber(projectId);

      // Next order = current count + 1
      const orderCount = await SprintModel.countDocuments({ projectId });

      const sprint = await SprintModel.create({
        companyId: companyId || project.companyId,
        projectId,
        number,
        title,
        goal: goal || null,
        status: SprintStatus.PLANNING,
        startDate: startDate || null,
        endDate: endDate || null,
        createdBy: userId,
        order: orderCount,
        boardId: boardId || null,
      });

      const sprintObj = sprint.toObject();

      await logSprintActivity({
        companyId: sprintObj.companyId,
        projectId: sprintObj.projectId.toString(),
        sprintId: sprintObj.id,
        userId,
        action: ActivityAction.CREATE,
        title: `Sprint "${sprintObj.title}" created`,
        metadata: { sprintNumber: sprintObj.number },
      });

      return sprintObj;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to create sprint: ${error.message}`, 500);
    }
  }

  // ── Get List ──────────────────────────────────────────────────────────────

  static async getSprints(query) {
    try {
      const {
        projectId,
        companyId,
        status,
        createdBy,
        search,
        page: rawPage = 0,
        limit: rawLimit = 20,
        sort: rawSort,
      } = query;

      const page = Math.max(parseInt(rawPage, 10) || 0, 0);
      const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 20, 1), 100);
      const skip = page * limit;

      // ── Filter ────────────────────────────────────────────────────────────
      const filter = {};
      if (projectId) filter.projectId = projectId;
      if (companyId) filter.companyId = companyId;
      if (status) filter.status = status;
      if (createdBy) filter.createdBy = createdBy;

      if (search) {
        filter.title = { $regex: search, $options: "i" };
      }

      // ── Sort ──────────────────────────────────────────────────────────────
      const SORTABLE = ["createdAt", "updatedAt", "number", "order", "status", "startDate"];
      let sortQuery = { order: 1, number: 1 };
      if (rawSort) {
        const [field, dir] = String(rawSort).split(":");
        if (SORTABLE.includes(field)) {
          sortQuery = { [field]: dir === "desc" ? -1 : 1 };
        }
      }

      const [sprints, total] = await Promise.all([
        SprintModel.find(filter)
          .sort(sortQuery)
          .skip(skip)
          .limit(limit)
          .exec()
          .then((docs) => docs.map((d) => d.toObject())),
        SprintModel.countDocuments(filter),
      ]);

      return {
        sprints,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch sprints: ${error.message}`, 500);
    }
  }

  // ── Get Single ────────────────────────────────────────────────────────────

  static async getSprintById(sprintId) {
    try {
      const sprint = await SprintModel.findById(sprintId);
      if (!sprint) {
        throw new ApiError("Sprint not found", 404);
      }
      return sprint.toObject();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch sprint: ${error.message}`, 500);
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────

  static async updateSprint(sprintId, data, userId) {
    try {
      const existing = await SprintModel.findById(sprintId).lean();
      if (!existing) throw new ApiError("Sprint not found", 404);

      // Prevent editing dates on a completed sprint
      if (existing.status === SprintStatus.COMPLETED) {
        const immutableFields = ["startDate", "endDate", "status"];
        const blocked = immutableFields.find((f) => data[f] !== undefined);
        if (blocked) {
          throw new ApiError(
            `Cannot edit "${blocked}" on a completed sprint`,
            422
          );
        }
      }

      // Validate date range
      const startDate = data.startDate ? new Date(data.startDate) : existing.startDate;
      const endDate = data.endDate ? new Date(data.endDate) : existing.endDate;
      if (startDate && endDate && startDate >= endDate) {
        throw new ApiError("startDate must be before endDate", 400);
      }

      const ALLOWED = ["title", "goal", "startDate", "endDate", "isArchived", "boardId"];
      const updatePayload = {};
      ALLOWED.forEach((f) => {
        if (data[f] !== undefined) updatePayload[f] = data[f];
      });

      const sprint = await SprintModel.findByIdAndUpdate(
        sprintId,
        { $set: updatePayload },
        { new: true, runValidators: true }
      );

      const sprintObj = sprint.toObject();

      await logSprintActivity({
        companyId: sprintObj.companyId,
        projectId: sprintObj.projectId.toString(),
        sprintId: sprintObj.id,
        userId,
        action: ActivityAction.UPDATE,
        title: `Sprint "${sprintObj.title}" updated`,
        metadata: { changes: Object.keys(updatePayload) },
      });

      return sprintObj;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to update sprint: ${error.message}`, 500);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  static async deleteSprint(sprintId, userId) {
    try {
      const sprint = await SprintModel.findByIdAndDelete(sprintId);
      if (!sprint) throw new ApiError("Sprint not found", 404);

      const sprintObj = sprint.toObject();

      await logSprintActivity({
        companyId: sprintObj.companyId,
        projectId: sprintObj.projectId.toString(),
        sprintId: sprintObj.id,
        userId,
        action: ActivityAction.DELETE,
        title: `Sprint "${sprintObj.title}" deleted`,
      });

      return { message: "Sprint deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to delete sprint: ${error.message}`, 500);
    }
  }

  // ── Start Sprint ──────────────────────────────────────────────────────────

  static async startSprint(sprintId, userId) {
    try {
      const sprint = await SprintModel.findById(sprintId).lean();
      if (!sprint) throw new ApiError("Sprint not found", 404);

      if (sprint.status === SprintStatus.ACTIVE) {
        throw new ApiError("Sprint is already active", 422);
      }
      if (sprint.status === SprintStatus.COMPLETED) {
        throw new ApiError("Cannot start a completed sprint", 422);
      }

      // Enforce: only one active sprint per project
      const alreadyActive = await SprintModel.findOne({
        projectId: sprint.projectId,
        status: SprintStatus.ACTIVE,
        _id: { $ne: sprintId },
      }).lean();
      if (alreadyActive) {
        throw new ApiError(
          `Sprint "${alreadyActive.title}" (#${alreadyActive.number}) is already active in this project. Complete it before starting a new one.`,
          422
        );
      }

      const updated = await SprintModel.findByIdAndUpdate(
        sprintId,
        {
          $set: {
            status: SprintStatus.ACTIVE,
            startDate: sprint.startDate || new Date(),
          },
        },
        { new: true }
      );

      const sprintObj = updated.toObject();

      await logSprintActivity({
        companyId: sprintObj.companyId,
        projectId: sprintObj.projectId.toString(),
        sprintId: sprintObj.id,
        userId,
        action: ActivityAction.CHANGE_STATUS,
        title: `Sprint "${sprintObj.title}" started`,
        metadata: { status: SprintStatus.ACTIVE },
      });

      return sprintObj;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to start sprint: ${error.message}`, 500);
    }
  }

  // ── Complete Sprint ───────────────────────────────────────────────────────

  static async completeSprint(sprintId, userId) {
    try {
      const sprint = await SprintModel.findById(sprintId).lean();
      if (!sprint) throw new ApiError("Sprint not found", 404);

      if (sprint.status === SprintStatus.COMPLETED) {
        throw new ApiError("Sprint is already completed", 422);
      }
      if (sprint.status === SprintStatus.PLANNING) {
        throw new ApiError("Cannot complete a sprint that has not been started", 422);
      }

      const completedAt = new Date();
      const updated = await SprintModel.findByIdAndUpdate(
        sprintId,
        {
          $set: {
            status: SprintStatus.COMPLETED,
            completedAt,
            endDate: sprint.endDate || completedAt,
          },
        },
        { new: true }
      );

      const sprintObj = updated.toObject();

      await logSprintActivity({
        companyId: sprintObj.companyId,
        projectId: sprintObj.projectId.toString(),
        sprintId: sprintObj.id,
        userId,
        action: ActivityAction.CHANGE_STATUS,
        title: `Sprint "${sprintObj.title}" completed`,
        metadata: { status: SprintStatus.COMPLETED, completedAt },
      });

      return sprintObj;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to complete sprint: ${error.message}`, 500);
    }
  }

  // ── Reorder Sprints ───────────────────────────────────────────────────────

  /**
   * @param {string} projectId
   * @param {Array<{ id: string, order: number }>} orderedItems
   * @param {string} userId
   */
  static async reorderSprints(projectId, orderedItems, userId) {
    try {
      if (!Array.isArray(orderedItems) || orderedItems.length === 0) {
        throw new ApiError("orderedItems must be a non-empty array", 400);
      }

      const ops = orderedItems.map((item) => ({
        updateOne: {
          filter: { _id: item.id, projectId },
          update: { $set: { order: item.order } },
        },
      }));

      await SprintModel.bulkWrite(ops);

      // Return the refreshed ordered list
      const sprints = await SprintModel.find({ projectId })
        .sort({ order: 1, number: 1 })
        .exec()
        .then(docs => docs.map(d => d.toObject()));

      // Get companyId from first sprint for the activity log
      if (sprints.length > 0) {
        await logSprintActivity({
          companyId: sprints[0].companyId,
          projectId,
          sprintId: projectId, // entity = the project itself for reorder actions
          userId,
          action: ActivityAction.UPDATE,
          title: "Sprints reordered",
          metadata: { projectId },
        });
      }

      return sprints;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to reorder sprints: ${error.message}`, 500);
    }
  }
}

module.exports = SprintService;
