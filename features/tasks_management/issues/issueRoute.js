const express = require("express");
const { validationResult } = require("express-validator");
const IssueController = require("./issueController");
const {
  createIssueValidator,
  updateIssueValidator,
  moveStatusValidator,
  moveSprintValidator,
  reorderIssuesValidator,
  checklistItemValidator,
  updateChecklistItemValidator,
  issueIdValidator,
  issueQueryValidator,
  projectStatsValidator,
  assignIssueValidator,
} = require("./issueValidator");

const router = express.Router();

// ── Validation middleware ─────────────────────────────────────────────────────

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors:  errors.array(),
    });
  }
  return next();
};

// ── Issue CRUD ────────────────────────────────────────────────────────────────

/**
 * POST /issues
 * Create a new issue.
 */
router.post(
  "/",
  createIssueValidator,
  validate,
  IssueController.createIssue
);

/**
 * GET /issues
 * Get all issues with filters, pagination and sorting.
 */
router.get(
  "/",
  issueQueryValidator,
  validate,
  IssueController.getIssues
);

/**
 * PATCH /issues/reorder
 * Bulk reorder issues within a status column.
 * NOTE: must be defined before /:issueId routes.
 */
router.patch(
  "/reorder",
  reorderIssuesValidator,
  validate,
  IssueController.reorderIssues
);

/**
 * GET /issues/project/:projectId/stats
 * Get issue statistics for a specific project.
 */
router.get(
  "/project/:projectId/stats",
  projectStatsValidator,
  validate,
  IssueController.getProjectIssueStats
);

/**
 * GET /issues/:issueId
 * Get a single issue by ID.
 */
router.get(
  "/:issueId",
  issueIdValidator,
  validate,
  IssueController.getIssueById
);

/**
 * PUT /issues/:issueId
 * Update issue fields.
 */
router.put(
  "/:issueId",
  updateIssueValidator,
  validate,
  IssueController.updateIssue
);

/**
 * DELETE /issues/:issueId
 * Soft-delete an issue.
 */
router.delete(
  "/:issueId",
  issueIdValidator,
  validate,
  IssueController.deleteIssue
);

// ── Specialized Actions ───────────────────────────────────────────────────────

/**
 * PATCH /issues/:issueId/archive
 * Archive an issue.
 */
router.patch(
  "/:issueId/archive",
  issueIdValidator,
  validate,
  IssueController.archiveIssue
);

/**
 * PATCH /issues/:issueId/restore
 * Restore a deleted or archived issue.
 */
router.patch(
  "/:issueId/restore",
  issueIdValidator,
  validate,
  IssueController.restoreIssue
);

/**
 * POST /issues/:issueId/duplicate
 * Duplicate an issue.
 */
router.post(
  "/:issueId/duplicate",
  issueIdValidator,
  validate,
  IssueController.duplicateIssue
);

/**
 * PATCH /issues/:issueId/status
 * Move an issue to a different status column.
 */
router.patch(
  "/:issueId/status",
  moveStatusValidator,
  validate,
  IssueController.moveStatus
);

/**
 * PATCH /issues/:issueId/sprint
 * Move an issue to a different sprint (or backlog when sprintId is null).
 */
router.patch(
  "/:issueId/sprint",
  moveSprintValidator,
  validate,
  IssueController.moveSprint
);

// ── Watchers ──────────────────────────────────────────────────────────────────

/**
 * PATCH /issues/:issueId/assignee
 * Change the assigned user of an issue.
 */
router.patch(
  "/:issueId/assignee",
  assignIssueValidator,
  validate,
  IssueController.assignIssue
);

/**
 * GET /issues/:issueId/watchers
 * Get all watchers for an issue.
 */
router.get(
  "/:issueId/watchers",
  issueIdValidator,
  validate,
  IssueController.getWatchers
);

/**
 * POST /issues/:issueId/watchers
 * Add a watcher to an issue.
 */
router.post(
  "/:issueId/watchers",
  issueIdValidator,
  validate,
  IssueController.addWatcher
);

/**
 * DELETE /issues/:issueId/watchers/:userId
 * Remove a watcher from an issue.
 */
router.delete(
  "/:issueId/watchers/:userId",
  issueIdValidator,
  validate,
  IssueController.removeWatcher
);

// ── Checklist ─────────────────────────────────────────────────────────────────

/**
 * POST /issues/:issueId/checklist
 * Add a checklist item to an issue.
 */
router.post(
  "/:issueId/checklist",
  checklistItemValidator,
  validate,
  IssueController.addChecklistItem
);

/**
 * PUT /issues/:issueId/checklist/:itemId
 * Update a checklist item.
 */
router.put(
  "/:issueId/checklist/:itemId",
  updateChecklistItemValidator,
  validate,
  IssueController.updateChecklistItem
);

/**
 * DELETE /issues/:issueId/checklist/:itemId
 * Delete a checklist item.
 */
router.delete(
  "/:issueId/checklist/:itemId",
  issueIdValidator,
  validate,
  IssueController.deleteChecklistItem
);

// ── Legacy route aliases ──────────────────────────────────────────────────────
// Support old /watch routes for backward compatibility
router.post("/:issueId/watch",         issueIdValidator, validate, IssueController.addWatcher);
router.delete("/:issueId/watch/:userId", issueIdValidator, validate, IssueController.removeWatcher);

module.exports = router;
