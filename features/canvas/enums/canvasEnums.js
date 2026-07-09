// Block Types
const BlockType = [
  "note",
  "code",
  "link",
  "image",
  "video",
  "file",
  "api",
  "documentation",
  "meeting",
  "checklist",
  "bookmark",
  "json",
];

// Block Actions
const BlockAction = [
  "create",
  "update",
  "delete",
  "move",
  "resize",
  "convert",
  "archive",
  "duplicate",
  "connect",
  "lock",
];

// Workspace Roles
const WorkspaceRole = ["owner", "admin", "editor", "viewer"];

// Page Access Levels
const PageAccess = ["public", "private", "shared"];

// Canvas Block States
const BlockState = ["active", "archived", "deleted"];

module.exports = {
  BlockType,
  BlockAction,
  WorkspaceRole,
  PageAccess,
  BlockState,
};
