const express = require("express");
const { validationResult } = require("express-validator");
const SprintController = require("./sprintController");
const {
  createSprintValidator,
  updateSprintValidator,
  getSprintValidator,
  deleteSprintValidator,
  startSprintValidator,
  completeSprintValidator,
  listSprintValidator,
  reorderSprintsValidator,
} = require("./sprintValidator");

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

// POST /api/v1/tasks-management/sprints          — Create sprint
// GET  /api/v1/tasks-management/sprints          — List sprints (paginated, filterable)
router
  .route("/")
  .post(createSprintValidator, handleValidationErrors, SprintController.createSprint)
  .get(listSprintValidator, handleValidationErrors, SprintController.getSprints);

// POST /api/v1/tasks-management/sprints/reorder  — Reorder sprints (drag-and-drop)
// Must be before /:sprintId to avoid route conflict
router.post(
  "/reorder",
  reorderSprintsValidator,
  handleValidationErrors,
  SprintController.reorderSprints
);

// GET    /api/v1/tasks-management/sprints/:sprintId  — Get single sprint
// PUT    /api/v1/tasks-management/sprints/:sprintId  — Update sprint
// DELETE /api/v1/tasks-management/sprints/:sprintId  — Delete sprint
router
  .route("/:sprintId")
  .get(getSprintValidator, handleValidationErrors, SprintController.getSprint)
  .put(updateSprintValidator, handleValidationErrors, SprintController.updateSprint)
  .delete(deleteSprintValidator, handleValidationErrors, SprintController.deleteSprint);

// PATCH /api/v1/tasks-management/sprints/:sprintId/start     — Start sprint
router.patch(
  "/:sprintId/start",
  startSprintValidator,
  handleValidationErrors,
  SprintController.startSprint
);

// PATCH /api/v1/tasks-management/sprints/:sprintId/complete  — Complete sprint
router.patch(
  "/:sprintId/complete",
  completeSprintValidator,
  handleValidationErrors,
  SprintController.completeSprint
);

module.exports = router;
