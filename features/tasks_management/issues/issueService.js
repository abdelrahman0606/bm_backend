const { v4: uuidv4 } = require("uuid");
const IssueModel = require("./issueModel");
const CommentModel = require("../models/commentModel");
const ChecklistItemModel = require("../models/checklistItemModel");
const WatcherModel = require("../models/watcherModel");
const ActivityModel = require("../models/activityModel");
const ApiError = require("../../../utils/apiError");

class IssueService {
  static async createIssue(issueData, userId) {
    try {
      const newIssue = new IssueModel({
        ...issueData,
        reporterId: userId,
      });

      await newIssue.save();
      
      await ActivityModel.create({
        issueId: newIssue._id,
        userId,
        action: "Issue Created",
        message: "Issue was created",
      });

      return newIssue;
    } catch (error) {
      throw new ApiError(500, `Failed to create issue: ${error.message}`);
    }
  }

  static async getIssues(filters = {}) {
    try {
      const {
        projectId,
        sprintId,
        statusId,
        priorityId,
        assigneeId,
        reporterId,
        search,
        page = 0,
        limit = 20,
      } = filters;

      const query = { deletedAt: null };
      if (projectId) query.projectId = projectId;
      if (sprintId) query.sprintId = sprintId;
      if (statusId) query.statusId = statusId;
      if (priorityId) query.priorityId = priorityId;
      if (assigneeId) query.assigneeId = assigneeId;
      if (reporterId) query.reporterId = reporterId;

      if (search) {
        const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        query.$or = [
          { title: searchRegex },
          { description: searchRegex }
        ];
      }

      const skip = page * limit;
      const issues = await IssueModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await IssueModel.countDocuments(query);

      return {
        issues,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new ApiError(500, `Failed to fetch issues: ${error.message}`);
    }
  }

  static async getIssueStats(filters = {}) {
    try {
      const { projectId } = filters;
      const baseQuery = { deletedAt: null };
      if (projectId) baseQuery.projectId = projectId;

      const allIssues = await IssueModel.find(baseQuery);
      const total = allIssues.length;
      const withAssignees = allIssues.filter(i => i.assigneeId).length;

      return {
        total,
        withAssignees,
      };
    } catch (error) {
      throw new ApiError(500, `Failed to get issue statistics: ${error.message}`);
    }
  }

  static async getIssueById(issueId) {
    try {
      const issue = await IssueModel.findById(issueId);
      if (!issue || issue.deletedAt) {
        throw new ApiError(404, "Issue not found");
      }
      return issue;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to fetch issue: ${error.message}`);
    }
  }

  static async updateIssue(issueId, updateData, userId) {
    try {
      const issue = await IssueModel.findById(issueId);
      if (!issue || issue.deletedAt) {
        throw new ApiError(404, "Issue not found");
      }

      Object.assign(issue, updateData);
      await issue.save();
      
      if (userId) {
        await ActivityModel.create({
          issueId: issue._id,
          userId,
          action: "Issue Updated",
          message: "Issue details were updated",
        });
      }
      return issue;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update issue: ${error.message}`);
    }
  }

  static async archiveIssue(issueId) {
    // We map archive to soft delete since archive field is removed
    return this.deleteIssue(issueId);
  }

  static async restoreIssue(issueId) {
    try {
      const issue = await IssueModel.findById(issueId);
      if (!issue) {
        throw new ApiError(404, "Issue not found");
      }
      issue.deletedAt = null;
      await issue.save();
      return issue;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to restore issue: ${error.message}`);
    }
  }

  static async deleteIssue(issueId) {
    try {
      const issue = await IssueModel.findById(issueId);
      if (!issue) {
        throw new ApiError(404, "Issue not found");
      }
      issue.deletedAt = new Date();
      await issue.save();
      return issue;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete issue: ${error.message}`);
    }
  }

  static async permanentlyDeleteIssue(issueId) {
    try {
      const result = await IssueModel.findByIdAndDelete(issueId);
      if (!result) {
        throw new ApiError(404, "Issue not found");
      }
      return { message: "Issue permanently deleted" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to permanently delete issue: ${error.message}`);
    }
  }

  static async addChecklistItem(issueId, itemData, userId) {
    try {
      const issue = await IssueModel.findById(issueId);
      if (!issue || issue.deletedAt) {
        throw new ApiError(404, "Issue not found");
      }
      const newItem = await ChecklistItemModel.create({
        issueId,
        title: itemData.title,
        order: itemData.order || 0
      });
      return newItem;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to add checklist item: ${error.message}`);
    }
  }

  static async updateChecklistItem(issueId, itemId, updateData, userId) {
    try {
      const item = await ChecklistItemModel.findOne({ _id: itemId, issueId });
      if (!item) {
        throw new ApiError(404, "Checklist item not found");
      }
      Object.assign(item, updateData);
      await item.save();
      return item;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update checklist item: ${error.message}`);
    }
  }

  static async deleteChecklistItem(issueId, itemId) {
    try {
      const result = await ChecklistItemModel.findOneAndDelete({ _id: itemId, issueId });
      if (!result) {
        throw new ApiError(404, "Checklist item not found");
      }
      return { message: "Checklist item deleted" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete checklist item: ${error.message}`);
    }
  }

  static async addComment(issueId, commentData, userId) {
    try {
      const issue = await IssueModel.findById(issueId);
      if (!issue || issue.deletedAt) {
        throw new ApiError(404, "Issue not found");
      }
      const newComment = await CommentModel.create({
        issueId,
        userId,
        message: commentData.message
      });
      
      await ActivityModel.create({
        issueId,
        userId,
        action: "Comment Added",
        message: "Added a comment",
      });
      
      return newComment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to add comment: ${error.message}`);
    }
  }

  static async updateComment(issueId, commentId, updateData) {
    try {
      const comment = await CommentModel.findOne({ _id: commentId, issueId });
      if (!comment) {
        throw new ApiError(404, "Comment not found");
      }
      Object.assign(comment, updateData);
      await comment.save();
      return comment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update comment: ${error.message}`);
    }
  }

  static async deleteComment(issueId, commentId) {
    try {
      const result = await CommentModel.findOneAndDelete({ _id: commentId, issueId });
      if (!result) {
        throw new ApiError(404, "Comment not found");
      }
      return { message: "Comment deleted" };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete comment: ${error.message}`);
    }
  }

  static async updateTaskProgress(issueId, progress) {
    // Not directly supported in new issue schema unless mapped to a status
    return { message: "Progress is now managed via status" };
  }

  static async assignUsers(issueId, userIds, currentUserId) {
    try {
      const issue = await IssueModel.findById(issueId);
      if (!issue || issue.deletedAt) {
        throw new ApiError(404, "Issue not found");
      }
      // Assuming assigneeId is singular now, we just assign the first user in array
      if (userIds.length > 0) {
        issue.assigneeId = userIds[0];
        await issue.save();
        if (currentUserId) {
          await ActivityModel.create({
            issueId,
            userId: currentUserId,
            action: "Assignment Changed",
            message: "Changed assignment",
          });
        }
      }
      return issue;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to assign users: ${error.message}`);
    }
  }

  static async removeAssignment(issueId, userId) {
    try {
      const issue = await IssueModel.findById(issueId);
      if (!issue || issue.deletedAt) {
        throw new ApiError(404, "Issue not found");
      }
      if (issue.assigneeId && issue.assigneeId.toString() === userId.toString()) {
        issue.assigneeId = null;
        await issue.save();
      }
      return issue;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to remove assignment: ${error.message}`);
    }
  }

  static async addWatcher(issueId, userId) {
    try {
      const watcher = await WatcherModel.findOneAndUpdate(
        { issueId, userId },
        { issueId, userId },
        { upsert: true, new: true }
      );
      return watcher;
    } catch (error) {
      throw new ApiError(500, `Failed to add watcher: ${error.message}`);
    }
  }

  static async removeWatcher(issueId, userId) {
    try {
      await WatcherModel.findOneAndDelete({ issueId, userId });
      return { message: "Watcher removed" };
    } catch (error) {
      throw new ApiError(500, `Failed to remove watcher: ${error.message}`);
    }
  }
}

module.exports = IssueService;
