const { v4: uuidv4 } = require("uuid");
const CanvasCommentModel = require("../models/CanvasCommentModel");
const CanvasActivityModel = require("../models/CanvasActivityModel");
const ApiError = require("../../../utils/apiError");

class CanvasCommentService {
  // Create comment
  static async createComment(blockId, data, userId) {
    try {
      const comment = new CanvasCommentModel({
        blockId: blockId,
        userId: userId,
        message: data.message,
        mentions: data.mentions || [],
        attachments: data.attachments || [],
      });

      await comment.save();

      return comment;
    } catch (error) {
      throw new ApiError(500, `Failed to create comment: ${error.message}`);
    }
  }

  // Get comments for block
  static async getBlockComments(blockId) {
    try {
      const comments = await CanvasCommentModel.find({
        blockId: blockId,
        isDeleted: false,
      }).sort({ createdAt: -1 });

      return comments;
    } catch (error) {
      throw new ApiError(500, `Failed to fetch comments: ${error.message}`);
    }
  }

  // Update comment
  static async updateComment(commentId, message) {
    try {
      const comment = await CanvasCommentModel.findByIdAndUpdate(
        commentId,
        { message, updatedAt: new Date() },
        { new: true }
      );

      if (!comment) {
        throw new ApiError(404, "Comment not found");
      }

      return comment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to update comment: ${error.message}`);
    }
  }

  // Delete comment
  static async deleteComment(commentId) {
    try {
      const comment = await CanvasCommentModel.findByIdAndUpdate(
        commentId,
        { isDeleted: true, updatedAt: new Date() },
        { new: true }
      );

      if (!comment) {
        throw new ApiError(404, "Comment not found");
      }

      return comment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to delete comment: ${error.message}`);
    }
  }

  // Add reply
  static async addReply(commentId, userId, message) {
    try {
      const reply = {
        id: uuidv4(),
        userId: userId,
        message: message,
        createdAt: new Date(),
      };

      const comment = await CanvasCommentModel.findByIdAndUpdate(
        commentId,
        { $push: { replies: reply }, updatedAt: new Date() },
        { new: true }
      );

      if (!comment) {
        throw new ApiError(404, "Comment not found");
      }

      return comment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to add reply: ${error.message}`);
    }
  }

  // Pin comment
  static async pinComment(commentId) {
    try {
      const comment = await CanvasCommentModel.findByIdAndUpdate(
        commentId,
        { isPinned: true },
        { new: true }
      );

      if (!comment) {
        throw new ApiError(404, "Comment not found");
      }

      return comment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to pin comment: ${error.message}`);
    }
  }

  // Resolve comment
  static async resolveComment(commentId) {
    try {
      const comment = await CanvasCommentModel.findByIdAndUpdate(
        commentId,
        { isResolved: true },
        { new: true }
      );

      if (!comment) {
        throw new ApiError(404, "Comment not found");
      }

      return comment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to resolve comment: ${error.message}`);
    }
  }

  // Add reaction
  static async addReaction(commentId, emoji, userId) {
    try {
      const comment = await CanvasCommentModel.findById(commentId);
      if (!comment) {
        throw new ApiError(404, "Comment not found");
      }

      const reactions = comment.reactions || new Map();
      const reactionUsers = reactions.get(emoji) || [];

      if (!reactionUsers.includes(userId)) {
        reactionUsers.push(userId);
        reactions.set(emoji, reactionUsers);
      }

      comment.reactions = reactions;
      await comment.save();

      return comment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to add reaction: ${error.message}`);
    }
  }

  // Remove reaction
  static async removeReaction(commentId, emoji, userId) {
    try {
      const comment = await CanvasCommentModel.findById(commentId);
      if (!comment) {
        throw new ApiError(404, "Comment not found");
      }

      const reactions = comment.reactions || new Map();
      const reactionUsers = reactions.get(emoji) || [];

      const index = reactionUsers.indexOf(userId);
      if (index > -1) {
        reactionUsers.splice(index, 1);
      }

      if (reactionUsers.length === 0) {
        reactions.delete(emoji);
      } else {
        reactions.set(emoji, reactionUsers);
      }

      comment.reactions = reactions;
      await comment.save();

      return comment;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, `Failed to remove reaction: ${error.message}`);
    }
  }
}

module.exports = CanvasCommentService;
