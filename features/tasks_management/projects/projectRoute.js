const express = require("express");
const { validationResult } = require("express-validator");
const ProjectController = require("./projectController");
const {
  createProjectValidator,
  updateProjectValidator,
  getProjectValidator,
  deleteProjectValidator,
  archiveProjectValidator,
  restoreProjectValidator,
  listProjectValidator,
  updateProjectConfigValidator,
  getProjectStatsValidator,
} = require("./projectValidator");

const router = express.Router();

// ── Validation handler ────────────────────────────────────────────────────────

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  return next();
};

// ── Routes ────────────────────────────────────────────────────────────────────

// GET  /api/v1/tasks-management/projects         — list (paginated, filterable)
// POST /api/v1/tasks-management/projects         — create
router
  .route("/")
  .get(listProjectValidator, handleValidationErrors, ProjectController.getProjects)
  .post(createProjectValidator, handleValidationErrors, ProjectController.createProject);

// GET /api/v1/tasks-management/projects/stats    — dynamic analytics
// (must be registered before /:projectId to avoid route conflict)
router.get(
  "/stats",
  getProjectStatsValidator,
  handleValidationErrors,
  ProjectController.getProjectStats
);

// GET    /api/v1/tasks-management/projects/:projectId  — single project (with members)
// PUT    /api/v1/tasks-management/projects/:projectId  — update
// DELETE /api/v1/tasks-management/projects/:projectId  — soft delete
router
  .route("/:projectId")
  .get(getProjectValidator, handleValidationErrors, ProjectController.getProject)
  .put(updateProjectValidator, handleValidationErrors, ProjectController.updateProject)
  .delete(deleteProjectValidator, handleValidationErrors, ProjectController.deleteProject);

// PATCH /api/v1/tasks-management/projects/:projectId/archive  — archive
router.patch(
  "/:projectId/archive",
  archiveProjectValidator,
  handleValidationErrors,
  ProjectController.archiveProject
);

// PATCH /api/v1/tasks-management/projects/:projectId/restore  — restore
router.patch(
  "/:projectId/restore",
  restoreProjectValidator,
  handleValidationErrors,
  ProjectController.restoreProject
);

// GET /api/v1/tasks-management/projects/:projectId/config  — get configuration
// PUT /api/v1/tasks-management/projects/:projectId/config  — update configuration
router
  .route("/:projectId/config")
  .get(getProjectValidator, handleValidationErrors, ProjectController.getProjectConfiguration)
  .put(
    updateProjectConfigValidator,
    handleValidationErrors,
    ProjectController.updateProjectConfiguration
  );

module.exports = router;
