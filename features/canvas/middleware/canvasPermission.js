const { v4: uuidv4 } = require("uuid");
const WorkspaceModel = require("../models/WorkspaceModel");
const CanvasPageModel = require("../models/CanvasPageModel");
const CanvasBlockModel = require("../models/CanvasBlockModel");
const ApiError = require("../../../utils/apiError");

// Check workspace permission
const checkWorkspacePermission = async (req, res, next) => {
  try {
    const { workspaceId } = req.params;
    const userId = req.user?.id || req.body.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID is required",
      });
    }

    const workspace = await WorkspaceModel.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: "Workspace not found",
      });
    }

    const member = workspace.members.find((m) => m.userId === userId);
    const isOwner = workspace.ownerId === userId;

    if (!member && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this workspace",
      });
    }

    req.userRole = member?.role || "owner";
    req.workspace = workspace;

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Error checking workspace permission: ${error.message}`,
    });
  }
};

// Check page permission
const checkPagePermission = async (req, res, next) => {
  try {
    const { pageId } = req.params;
    const userId = req.user?.id || req.body.userId;

    const page = await CanvasPageModel.findById(pageId);
    if (!page) {
      return res.status(404).json({
        success: false,
        message: "Page not found",
      });
    }

    // Check workspace access first
    const workspace = await WorkspaceModel.findById(page.workspaceId);
    const member = workspace.members.find((m) => m.userId === userId);
    const isOwner = workspace.ownerId === userId;

    if (!member && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this workspace",
      });
    }

    // Check page access
    if (page.access === "private" && page.createdBy !== userId && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this page",
      });
    }

    req.userRole = member?.role || "owner";
    req.page = page;

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Error checking page permission: ${error.message}`,
    });
  }
};

// Check block permission
const checkBlockPermission = async (req, res, next) => {
  try {
    const { blockId } = req.params;
    const userId = req.user?.id || req.body.userId;

    const block = await CanvasBlockModel.findById(blockId);
    if (!block) {
      return res.status(404).json({
        success: false,
        message: "Block not found",
      });
    }

    const workspace = await WorkspaceModel.findById(block.workspaceId);
    const member = workspace.members.find((m) => m.userId === userId);
    const isOwner = workspace.ownerId === userId;

    if (!member && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this workspace",
      });
    }

    req.userRole = member?.role || "owner";
    req.block = block;

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: `Error checking block permission: ${error.message}`,
    });
  }
};

// Role-based access control
const requireRole = (requiredRoles) => {
  return (req, res, next) => {
    const userRole = req.userRole || "viewer";

    const roleHierarchy = {
      owner: 4,
      admin: 3,
      editor: 2,
      viewer: 1,
    };

    const userLevel = roleHierarchy[userRole] || 0;
    const requiredLevel = Math.max(
      ...requiredRoles.map((role) => roleHierarchy[role] || 0)
    );

    if (userLevel < requiredLevel) {
      return res.status(403).json({
        success: false,
        message: `This action requires ${requiredRoles.join(" or ")} role`,
      });
    }

    next();
  };
};

// Check if user can edit
const canEdit = (req, res, next) => {
  const userRole = req.userRole || "viewer";
  if (!["owner", "admin", "editor"].includes(userRole)) {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to edit",
    });
  }
  next();
};

// Check if user can delete
const canDelete = (req, res, next) => {
  const userRole = req.userRole || "viewer";
  if (!["owner", "admin"].includes(userRole)) {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to delete",
    });
  }
  next();
};

// Check if user can manage workspace
const canManageWorkspace = (req, res, next) => {
  const userRole = req.userRole || "viewer";
  if (userRole !== "owner" && userRole !== "admin") {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to manage workspace",
    });
  }
  next();
};

module.exports = {
  checkWorkspacePermission,
  checkPagePermission,
  checkBlockPermission,
  requireRole,
  canEdit,
  canDelete,
  canManageWorkspace,
};
