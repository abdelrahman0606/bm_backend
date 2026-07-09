const express = require("express");
const {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectStats,
} = require("./projectService");
const {
  getProjectValidator,
  createProjectValidator,
  updateProjectValidator,
  deleteProjectValidator,
} = require("./projectValidator");

const router = express.Router();

// GET /api/v1/tasks-management/projects
// POST /api/v1/tasks-management/projects
router.route("/").get(getProjects).post(createProjectValidator, createProject);

// GET /api/v1/tasks-management/projects/stats
router.get("/stats", getProjectStats);

// GET /api/v1/tasks-management/projects/:id
// PUT /api/v1/tasks-management/projects/:id
// DELETE /api/v1/tasks-management/projects/:id
router
  .route("/:id")
  .get(getProjectValidator, getProject)
  .put(updateProjectValidator, updateProject)
  .delete(deleteProjectValidator, deleteProject);

module.exports = router;
