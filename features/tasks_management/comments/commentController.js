const CommentService = require("./commentService");
const ApiError = require("../../../utils/apiError");

const sendSuccess = (res, data, { message = "Success", statusCode = 200, meta = undefined } = {}) => {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
};

const sendError = (res, error) => {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  console.error("[CommentController] Unhandled error:", error);
  return res.status(500).json({ success: false, message: error.message || "Internal server error" });
};

class CommentController {
  static async createComment(req, res) {
    try {
      const userId = req.user?.id;
      const comment = await CommentService.createComment(req.body, userId);
      return sendSuccess(res, comment, { message: "Comment created successfully", statusCode: 201 });
    } catch (err) {
      return sendError(res, err);
    }
  }

  static async getComments(req, res) {
    try {
      const { issueId, projectId } = req.query;
      const comments = await CommentService.getCommentsByIssue(issueId, projectId);
      return sendSuccess(res, comments, { message: "Comments retrieved successfully" });
    } catch (err) {
      return sendError(res, err);
    }
  }

  static async updateComment(req, res) {
    try {
      const userId = req.user?.id;
      const comment = await CommentService.updateComment(req.params.commentId, req.body, userId);
      return sendSuccess(res, comment, { message: "Comment updated successfully" });
    } catch (err) {
      return sendError(res, err);
    }
  }

  static async deleteComment(req, res) {
    try {
      const userId = req.user?.id;
      const result = await CommentService.deleteComment(req.params.commentId, userId);
      return sendSuccess(res, null, { message: result.message });
    } catch (err) {
      return sendError(res, err);
    }
  }
}

module.exports = CommentController;
