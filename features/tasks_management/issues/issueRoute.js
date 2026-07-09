const express = require("express");
const { validationResult } = require("express-validator");
const IssueService = require("./issueService");
const ApiError = require("../../../utils/apiError");
const {
  createIssueValidator,
  updateIssueValidator,
  issueIdValidator,
  issueQueryValidator,
} = require("./issueValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post(
  "/",
  createIssueValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.reporterId;
      const issue = await IssueService.createIssue(req.body, userId);
      res.status(201).json({
        success: true,
        message: "Issue created successfully",
        data: issue,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.get(
  "/",
  issueQueryValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await IssueService.getIssues(req.query);
      res.status(200).json({
        success: true,
        message: "Issues fetched successfully",
        data: result.issues,
        pagination: result.pagination,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.get(
  "/stats",
  issueQueryValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const stats = await IssueService.getIssueStats(req.query);
      res.status(200).json({
        success: true,
        message: "Issue statistics fetched successfully",
        data: stats,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.get(
  "/:issueId",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const issue = await IssueService.getIssueById(req.params.issueId);
      res.status(200).json({
        success: true,
        message: "Issue fetched successfully",
        data: issue,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.put(
  "/:issueId",
  updateIssueValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      const issue = await IssueService.updateIssue(req.params.issueId, req.body, userId);
      res.status(200).json({
        success: true,
        message: "Issue updated successfully",
        data: issue,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.patch(
  "/:issueId/archive",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const issue = await IssueService.archiveIssue(req.params.issueId);
      res.status(200).json({
        success: true,
        message: "Issue archived successfully",
        data: issue,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.patch(
  "/:issueId/restore",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const issue = await IssueService.restoreIssue(req.params.issueId);
      res.status(200).json({
        success: true,
        message: "Issue restored successfully",
        data: issue,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.delete(
  "/:issueId",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const issue = await IssueService.deleteIssue(req.params.issueId);
      res.status(200).json({
        success: true,
        message: "Issue deleted successfully",
        data: issue,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.delete(
  "/:issueId/permanent",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await IssueService.permanentlyDeleteIssue(req.params.issueId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

router.post(
  "/:issueId/checklist",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      const item = await IssueService.addChecklistItem(req.params.issueId, req.body, userId);
      res.status(201).json({
        success: true,
        message: "Checklist item added",
        data: item,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.put(
  "/:issueId/checklist/:itemId",
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      const item = await IssueService.updateChecklistItem(req.params.issueId, req.params.itemId, { ...req.body, completedBy: userId }, userId);
      res.status(200).json({
        success: true,
        message: "Checklist item updated",
        data: item,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.delete(
  "/:issueId/checklist/:itemId",
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await IssueService.deleteChecklistItem(req.params.issueId, req.params.itemId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.post(
  "/:issueId/comments",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      const comment = await IssueService.addComment(req.params.issueId, req.body, userId);
      res.status(201).json({
        success: true,
        message: "Comment added",
        data: comment,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.put(
  "/:issueId/comments/:commentId",
  handleValidationErrors,
  async (req, res) => {
    try {
      const comment = await IssueService.updateComment(req.params.issueId, req.params.commentId, req.body);
      res.status(200).json({
        success: true,
        message: "Comment updated",
        data: comment,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.delete(
  "/:issueId/comments/:commentId",
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await IssueService.deleteComment(req.params.issueId, req.params.commentId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.patch(
  "/:issueId/progress",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { progress } = req.body;
      const issue = await IssueService.updateTaskProgress(req.params.issueId, progress);
      res.status(200).json({
        success: true,
        message: "Progress updated",
        data: issue,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.post(
  "/:issueId/assign",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const { userIds } = req.body;
      const currentUserId = req.user?.id;
      const issue = await IssueService.assignUsers(req.params.issueId, userIds, currentUserId);
      res.status(200).json({
        success: true,
        message: "Users assigned",
        data: issue,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.delete(
  "/:issueId/assign/:userId",
  handleValidationErrors,
  async (req, res) => {
    try {
      const issue = await IssueService.removeAssignment(req.params.issueId, req.params.userId);
      res.status(200).json({
        success: true,
        message: "Assignment removed",
        data: issue,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.post(
  "/:issueId/watch",
  issueIdValidator,
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user?.id || req.body.userId;
      const watcher = await IssueService.addWatcher(req.params.issueId, userId);
      res.status(200).json({
        success: true,
        message: "Watcher added",
        data: watcher,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.delete(
  "/:issueId/watch/:userId",
  handleValidationErrors,
  async (req, res) => {
    try {
      const result = await IssueService.removeWatcher(req.params.issueId, req.params.userId);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.statusCode).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// Map /taskId paths to issueId to support older clients perfectly without breaking them.
router.param("taskId", (req, res, next, id) => {
  req.params.issueId = id;
  next();
});

module.exports = router;
