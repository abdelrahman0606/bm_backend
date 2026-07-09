const { body, param, query } = require("express-validator");

const createWorkspaceValidator = [
  body("name")
    .notEmpty()
    .withMessage("Workspace name is required")
    .isString()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage("Name must be between 3 and 100 characters"),
  body("description").optional().isString().trim(),
  body("timezone").optional().isString().trim(),
  body("locale").optional().isString().trim(),
  body("currency").optional().isString().trim(),
];

const updateWorkspaceValidator = [
  param("workspaceId").isMongoId().withMessage("Invalid Workspace ID"),
  body("name").optional().isString().trim().isLength({ min: 3, max: 100 }),
  body("description").optional().isString().trim(),
  body("timezone").optional().isString().trim(),
  body("locale").optional().isString().trim(),
  body("currency").optional().isString().trim(),
];

const getWorkspaceValidator = [
  param("workspaceId").isMongoId().withMessage("Invalid Workspace ID"),
];

const deleteWorkspaceValidator = [
  param("workspaceId").isMongoId().withMessage("Invalid Workspace ID"),
];

const listWorkspaceValidator = [
  query("page").optional().isInt({ min: 0 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("search").optional().isString().trim(),
];

const addMemberValidator = [
  param("workspaceId").isMongoId().withMessage("Invalid Workspace ID"),
  body("userId").isMongoId().withMessage("Invalid User ID"),
  body("role").optional().isString().trim(),
];

const removeMemberValidator = [
  param("workspaceId").isMongoId().withMessage("Invalid Workspace ID"),
  param("userId").isMongoId().withMessage("Invalid User ID"),
];

module.exports = {
  createWorkspaceValidator,
  updateWorkspaceValidator,
  getWorkspaceValidator,
  deleteWorkspaceValidator,
  listWorkspaceValidator,
  addMemberValidator,
  removeMemberValidator,
};
