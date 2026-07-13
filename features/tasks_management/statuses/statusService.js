const StatusModel = require("./statusModel");
const IssueModel = require("../issues/issueModel");
const ApiError = require("../../../utils/apiError");
const ActivityService = require("../activities/activityService");
const { ActivityEntityType, ActivityAction } = require("../activities/activityEnums");
const { StatusType } = require("./statusEnums");
const { ProjectType } = require("../projects/projectEnums");

class StatusService {
  /**
   * Generates default statuses for a newly created project based on projectType.
   */
  static async createDefaultStatuses(projectId, companyId, projectType, userId) {
    try {
      const defaultStatuses = [];

      if (projectType === ProjectType.SCRUM) {
        defaultStatuses.push(
          { title: "Backlog", statusType: StatusType.TODO, order: 0, isDefault: true },
          { title: "To Do", statusType: StatusType.TODO, order: 1, isDefault: true },
          { title: "In Progress", statusType: StatusType.IN_PROGRESS, order: 2, isDefault: true },
          { title: "Review", statusType: StatusType.IN_PROGRESS, order: 3, isDefault: true },
          { title: "Done", statusType: StatusType.DONE, order: 4, isDefault: true }
        );
      } else {
        // Kanban or default fallback
        defaultStatuses.push(
          { title: "To Do", statusType: StatusType.TODO, order: 0, isDefault: true },
          { title: "In Progress", statusType: StatusType.IN_PROGRESS, order: 1, isDefault: true },
          { title: "Done", statusType: StatusType.DONE, order: 2, isDefault: true }
        );
      }

      const statusesToInsert = defaultStatuses.map(s => ({
        ...s,
        projectId,
        companyId,
        createdByUserId: userId,
      }));

      const statuses = await StatusModel.insertMany(statusesToInsert);

      // Log activity
      await ActivityService.createActivity({
        companyId,
        projectId,
        userId,
        action: ActivityAction.CREATE,
        entityType: ActivityEntityType.PROJECT,
        entityId: projectId,
        title: "Default Statuses Generated",
        description: `Auto-generated ${statuses.length} default statuses for the project`,
      });

      return statuses.map(s => s.toObject());
    } catch (error) {
      console.error("[StatusService] Error creating default statuses:", error);
      // We don't throw to prevent failing the whole project creation
      return [];
    }
  }

  static async createStatus(data, userId) {
    try {
      const highestOrderStatus = await StatusModel.findOne({ projectId: data.projectId }).sort("-order");
      const nextOrder = highestOrderStatus ? highestOrderStatus.order + 1 : 0;

      const status = await StatusModel.create({
        ...data,
        order: data.order !== undefined ? data.order : nextOrder,
        createdByUserId: userId,
      });

      // Log activity
      await ActivityService.createActivity({
        companyId: status.companyId,
        projectId: status.projectId,
        userId,
        action: ActivityAction.CREATE,
        entityType: ActivityEntityType.COMPONENT, // using COMPONENT or an implied type, ideally we'd have STATUS type but we can use COMPONENT or add it. Let's use COMPONENT as a generic fallback since we can't change enums easily now, wait, I can just use Project entity type.
        entityId: status._id.toString(),
        title: "Status Created",
        description: `Status "${status.title}" was created`,
        metadata: { statusId: status._id.toString(), statusType: status.statusType }
      });

      return status.toObject();
    } catch (error) {
      if (error.code === 11000) {
        throw new ApiError("A status with this title already exists in this project", 400);
      }
      throw new ApiError(`Failed to create status: ${error.message}`, 500);
    }
  }

  static async getStatuses(filters, queryParams) {
    try {
      const page = parseInt(queryParams.page, 10) || 1;
      const limit = parseInt(queryParams.limit, 10) || 50;

      const query = { isArchived: false };
      if (filters.companyId) query.companyId = filters.companyId;
      if (filters.projectId) query.projectId = filters.projectId;
      if (filters.statusType) query.statusType = filters.statusType;

      const skip = (page - 1) * limit;
      
      const [statuses, total] = await Promise.all([
        StatusModel.find(query)
          .sort({ order: 1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .exec()
          .then(docs => docs.map(d => d.toObject())),
        StatusModel.countDocuments(query),
      ]);

      return {
        statuses,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(`Failed to fetch statuses: ${error.message}`, 500);
    }
  }

  static async getStatusById(statusId) {
    try {
      const doc = await StatusModel.findById(statusId);
      if (!doc) {
        throw new ApiError("Status not found", 404);
      }
      return doc.toObject();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to fetch status: ${error.message}`, 500);
    }
  }

  static async updateStatus(statusId, updateData, userId) {
    try {
      const status = await StatusModel.findById(statusId);
      if (!status) {
        throw new ApiError("Status not found", 404);
      }

      Object.assign(status, updateData);
      await status.save();

      await ActivityService.createActivity({
        companyId: status.companyId,
        projectId: status.projectId,
        userId,
        action: ActivityAction.UPDATE,
        entityType: ActivityEntityType.PROJECT,
        entityId: status._id.toString(),
        title: "Status Updated",
        description: `Status "${status.title}" was updated`,
      });

      return status.toObject();
    } catch (error) {
      if (error.code === 11000) {
        throw new ApiError("A status with this title already exists in this project", 400);
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to update status: ${error.message}`, 500);
    }
  }

  static async reorderStatuses(projectId, orderedIds, userId) {
    try {
      // Create bulk operations to update the order
      const bulkOps = orderedIds.map((id, index) => ({
        updateOne: {
          filter: { _id: id, projectId },
          update: { $set: { order: index } },
        },
      }));

      if (bulkOps.length > 0) {
        await StatusModel.bulkWrite(bulkOps);
      }

      const anyStatus = await StatusModel.findOne({ projectId });

      if (anyStatus) {
        await ActivityService.createActivity({
          companyId: anyStatus.companyId,
          projectId,
          userId,
          action: ActivityAction.UPDATE,
          entityType: ActivityEntityType.PROJECT,
          entityId: projectId,
          title: "Statuses Reordered",
          description: "Project statuses were reordered",
        });
      }

      return { message: "Statuses reordered successfully" };
    } catch (error) {
      throw new ApiError(`Failed to reorder statuses: ${error.message}`, 500);
    }
  }

  static async deleteStatus(statusId, userId) {
    try {
      const status = await StatusModel.findById(statusId);
      if (!status) {
        throw new ApiError("Status not found", 404);
      }

      // Check if any issues are assigned to this status
      const issuesCount = await IssueModel.countDocuments({ statusId: status._id });
      if (issuesCount > 0) {
        throw new ApiError(`Cannot delete status. ${issuesCount} issues are currently assigned to it. Move them first.`, 400);
      }

      await StatusModel.findByIdAndDelete(statusId);

      await ActivityService.createActivity({
        companyId: status.companyId,
        projectId: status.projectId,
        userId,
        action: ActivityAction.DELETE,
        entityType: ActivityEntityType.PROJECT,
        entityId: status._id.toString(),
        title: "Status Deleted",
        description: `Status "${status.title}" was deleted`,
      });

      return { message: "Status deleted successfully" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`Failed to delete status: ${error.message}`, 500);
    }
  }
}

module.exports = StatusService;
