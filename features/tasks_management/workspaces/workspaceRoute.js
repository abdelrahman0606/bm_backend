const express = require("express");
const { validationResult } = require("express-validator");
const WorkspaceController = require("./workspaceController");
const {
  createWorkspaceValidator,
  updateWorkspaceValidator,
  getWorkspaceValidator,
  deleteWorkspaceValidator,
  listWorkspaceValidator,
  addMemberValidator,
  removeMemberValidator,
} = require("./workspaceValidator");

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

router.post("/", createWorkspaceValidator, handleValidationErrors, WorkspaceController.createWorkspace);
router.get("/", listWorkspaceValidator, handleValidationErrors, WorkspaceController.getWorkspaces);
router.get("/:workspaceId", getWorkspaceValidator, handleValidationErrors, WorkspaceController.getWorkspace);
router.put("/:workspaceId", updateWorkspaceValidator, handleValidationErrors, WorkspaceController.updateWorkspace);
router.delete("/:workspaceId", deleteWorkspaceValidator, handleValidationErrors, WorkspaceController.deleteWorkspace);

router.post("/:workspaceId/members", addMemberValidator, handleValidationErrors, WorkspaceController.addMember);
router.get("/:workspaceId/members", getWorkspaceValidator, handleValidationErrors, WorkspaceController.getMembers);
router.delete("/:workspaceId/members/:userId", removeMemberValidator, handleValidationErrors, WorkspaceController.removeMember);

module.exports = router;
