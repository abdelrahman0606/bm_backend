const mongoose = require("mongoose");
const CommentModel = require("./commentModel");
const ApiError = require("../../../utils/apiError");

class CommentService {
  /**
   * Create a new comment.
   */
  static async createComment(data, userId) {
    const { companyId, projectId, issueId, parentCommentId, content, mentionedUsers } = data;

    const comment = await CommentModel.create({
      companyId,
      projectId,
      issueId,
      parentCommentId: parentCommentId || null,
      content,
      mentionedUsers: mentionedUsers || [],
      createdBy: userId,
    });

    return comment.toObject();
  }

  /**
   * Fetch comments for a specific issue.
   */
  static async getCommentsByIssue(issueId, projectId) {
    const query = { issueId: new mongoose.Types.ObjectId(issueId) };
    if (projectId) {
      query.projectId = new mongoose.Types.ObjectId(projectId);
    }

    const comments = await CommentModel.find(query).sort({ createdAt: 1 }).lean();
    return comments;
  }

  /**
   * Update an existing comment.
   */
  static async updateComment(commentId, updateData, userId) {
    const comment = await CommentModel.findById(commentId);
    if (!comment) {
      throw new ApiError("Comment not found", 404);
    }

    // Only allow the creator to update the comment
    if (comment.createdBy !== userId) {
      throw new ApiError("You don't have permission to update this comment", 403);
    }

    if (updateData.content !== undefined) {
      comment.content = updateData.content;
    }
    if (updateData.mentionedUsers !== undefined) {
      comment.mentionedUsers = updateData.mentionedUsers;
    }

    await comment.save();
    return comment.toObject();
  }

  /**
   * Delete a comment.
   */
  static async deleteComment(commentId, userId) {
    const comment = await CommentModel.findById(commentId);
    if (!comment) {
      throw new ApiError("Comment not found", 404);
    }

    // Only allow the creator to delete the comment
    if (comment.createdBy !== userId) {
      throw new ApiError("You don't have permission to delete this comment", 403);
    }

    // Also optionally delete all child comments if necessary
    await CommentModel.deleteMany({ parentCommentId: commentId });
    await comment.deleteOne();

    return { message: "Comment deleted successfully" };
  }
}

module.exports = CommentService;
