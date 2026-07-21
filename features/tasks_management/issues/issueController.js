const IssueService = require("./issueService");
const ApiError     = require("../../../utils/apiError");

// ── Response helpers ──────────────────────────────────────────────────────────

const sendSuccess = (res, data, { message = "Success", statusCode = 200, meta = undefined } = {}) => {
  const body = { success: true, message, data };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
};

const sendError = (res, error) => {
  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  console.error("[IssueController] Unhandled error:", error);
  return res.status(500).json({ success: false, message: error.message || "Internal server error" });
};

// ── Controller methods ────────────────────────────────────────────────────────

const IssueController = {

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async createIssue(req, res) {
    try {
      const userId = req.user?.id || req.body.createdBy;
      const issue  = await IssueService.createIssue(req.body, userId);
      return sendSuccess(res, issue, { message: "Issue created successfully", statusCode: 201 });
    } catch (err) { return sendError(res, err); }
  },

  async getIssues(req, res) {
    try {
      const result = await IssueService.getIssues(req.query);
      return res.status(200).json({
        success:    true,
        message:    "Issues fetched successfully",
        data:       result.issues,
        pagination: result.pagination,
      });
    } catch (err) { return sendError(res, err); }
  },

  async getProjectIssueStats(req, res) {
    try {
      const userId = req.user?.id;
      const stats = await IssueService.getProjectIssueStats(req.params.projectId, userId);
      return sendSuccess(res, stats, { message: "Project issue stats fetched successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async getIssueById(req, res) {
    try {
      const issue = await IssueService.getIssueById(req.params.issueId);
      return sendSuccess(res, issue, { message: "Issue fetched successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async updateIssue(req, res) {
    try {
      const userId = req.user?.id;
      const issue  = await IssueService.updateIssue(req.params.issueId, req.body, userId);
      return sendSuccess(res, issue, { message: "Issue updated successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async deleteIssue(req, res) {
    try {
      const userId = req.user?.id;
      const issue  = await IssueService.deleteIssue(req.params.issueId, userId);
      return sendSuccess(res, issue, { message: "Issue deleted successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async archiveIssue(req, res) {
    try {
      const userId = req.user?.id;
      const issue  = await IssueService.archiveIssue(req.params.issueId, userId);
      return sendSuccess(res, issue, { message: "Issue archived successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async restoreIssue(req, res) {
    try {
      const userId = req.user?.id;
      const issue  = await IssueService.restoreIssue(req.params.issueId, userId);
      return sendSuccess(res, issue, { message: "Issue restored successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async duplicateIssue(req, res) {
    try {
      const userId = req.user?.id;
      const issue  = await IssueService.duplicateIssue(req.params.issueId, userId);
      return sendSuccess(res, issue, { message: "Issue duplicated successfully", statusCode: 201 });
    } catch (err) { return sendError(res, err); }
  },

  // ── Specialized Actions ───────────────────────────────────────────────────

  async moveStatus(req, res) {
    try {
      const userId = req.user?.id;
      const issue  = await IssueService.moveStatus(req.params.issueId, req.body.statusId, userId);
      return sendSuccess(res, issue, { message: "Issue status updated successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async moveSprint(req, res) {
    try {
      const userId = req.user?.id;
      const issue  = await IssueService.moveSprint(req.params.issueId, req.body.sprintId, userId);
      return sendSuccess(res, issue, { message: "Issue sprint updated successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async reorderIssues(req, res) {
    try {
      const userId = req.user?.id;
      const result = await IssueService.reorderIssues(req.body.items, userId);
      return sendSuccess(res, result, { message: "Issues reordered successfully" });
    } catch (err) { return sendError(res, err); }
  },

  // ── Watchers ──────────────────────────────────────────────────────────────

  async getWatchers(req, res) {
    try {
      const watchers = await IssueService.getWatchers(req.params.issueId);
      return sendSuccess(res, watchers, { message: "Watchers fetched successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async addWatcher(req, res) {
    try {
      const currentUserId = req.user?.id;
      const watcherUserId = req.body.userId || currentUserId;
      const watcher       = await IssueService.addWatcher(req.params.issueId, watcherUserId, currentUserId);
      return sendSuccess(res, watcher, { message: "Watcher added successfully" });
    } catch (err) { return sendError(res, err); }
  },

  async removeWatcher(req, res) {
    try {
      const currentUserId = req.user?.id;
      const result        = await IssueService.removeWatcher(req.params.issueId, req.params.userId, currentUserId);
      return sendSuccess(res, null, { message: result.message });
    } catch (err) { return sendError(res, err); }
  },

  // ── Assignee ────────────────────────────────────────────────────────────────

  async assignIssue(req, res) {
    try {
      const userId = req.user?.id;
      const issue  = await IssueService.assignIssue(req.params.issueId, req.body.assignedTo, userId);
      return sendSuccess(res, issue, { message: "Issue assignee updated" });
    } catch (err) { return sendError(res, err); }
  },

  // ── Checklist ─────────────────────────────────────────────────────────────

  async addChecklistItem(req, res) {
    try {
      const userId = req.user?.id;
      const item   = await IssueService.addChecklistItem(req.params.issueId, req.body, userId);
      return sendSuccess(res, item, { message: "Checklist item added", statusCode: 201 });
    } catch (err) { return sendError(res, err); }
  },

  async updateChecklistItem(req, res) {
    try {
      const userId = req.user?.id;
      const item   = await IssueService.updateChecklistItem(
        req.params.issueId, req.params.itemId, req.body, userId
      );
      return sendSuccess(res, item, { message: "Checklist item updated" });
    } catch (err) { return sendError(res, err); }
  },

  async deleteChecklistItem(req, res) {
    try {
      const userId = req.user?.id;
      const result = await IssueService.deleteChecklistItem(req.params.issueId, req.params.itemId, userId);
      return sendSuccess(res, null, { message: result.message });
    } catch (err) { return sendError(res, err); }
  },
};

module.exports = IssueController;
