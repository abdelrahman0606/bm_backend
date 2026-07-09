const { body, param, query } = require("express-validator");
const { BlockType, WorkspaceRole } = require("../enums/canvasEnums");

// Workspace Validators
const createWorkspaceValidator = [
  body("name")
    .notEmpty()
    .withMessage("Workspace name is required")
    .isString()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage("Name must be between 3 and 100 characters"),
  body("description")
    .optional()
    .isString()
    .trim(),
];

const updateWorkspaceValidator = [
  param("workspaceId")
    .notEmpty()
    .withMessage("Workspace ID is required")
    .isString()
    .trim(),
  body("name")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 3, max: 100 }),
  body("description")
    .optional()
    .isString()
    .trim(),
];

// Canvas Page Validators
const createPageValidator = [
  body("workspaceId")
    .notEmpty()
    .withMessage("Workspace ID is required")
    .isString()
    .trim(),
  body("projectId")
    .notEmpty()
    .withMessage("Project ID is required")
    .isString()
    .trim(),
  body("title")
    .notEmpty()
    .withMessage("Page title is required")
    .isString()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage("Title must be between 1 and 200 characters"),
  body("description")
    .optional()
    .isString()
    .trim(),
  body("icon")
    .optional()
    .isString()
    .trim(),
];

const updatePageValidator = [
  param("pageId")
    .notEmpty()
    .withMessage("Page ID is required")
    .isString()
    .trim(),
  body("title")
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 200 }),
  body("description")
    .optional()
    .isString()
    .trim(),
  body("icon")
    .optional()
    .isString()
    .trim(),
  body("isFavorite")
    .optional()
    .isBoolean(),
];

// Canvas Block Validators
const createBlockValidator = [
  body("workspaceId")
    .notEmpty()
    .withMessage("Workspace ID is required")
    .isString()
    .trim(),
  body("projectId")
    .notEmpty()
    .withMessage("Project ID is required")
    .isString()
    .trim(),
  body("pageId")
    .notEmpty()
    .withMessage("Page ID is required")
    .isString()
    .trim(),
  body("content")
    .notEmpty()
    .withMessage("Content is required")
    .isString()
    .trim(),
  body("type")
    .optional()
    .isIn(BlockType)
    .withMessage(`Type must be one of: ${BlockType.join(", ")}`),
  body("title")
    .optional()
    .isString()
    .trim(),
  body("tags")
    .optional()
    .isArray(),
  body("x")
    .optional()
    .isNumeric(),
  body("y")
    .optional()
    .isNumeric(),
  body("width")
    .optional()
    .isNumeric(),
  body("height")
    .optional()
    .isNumeric(),
];

const updateBlockValidator = [
  param("blockId")
    .notEmpty()
    .withMessage("Block ID is required")
    .isString()
    .trim(),
  body("content")
    .optional()
    .isString()
    .trim(),
  body("title")
    .optional()
    .isString()
    .trim(),
  body("type")
    .optional()
    .isIn(BlockType),
  body("tags")
    .optional()
    .isArray(),
  body("x")
    .optional()
    .isNumeric(),
  body("y")
    .optional()
    .isNumeric(),
  body("width")
    .optional()
    .isNumeric(),
  body("height")
    .optional()
    .isNumeric(),
  body("isLocked")
    .optional()
    .isBoolean(),
];

const moveBlockValidator = [
  param("blockId")
    .notEmpty()
    .withMessage("Block ID is required"),
  body("x")
    .notEmpty()
    .withMessage("X coordinate is required")
    .isNumeric(),
  body("y")
    .notEmpty()
    .withMessage("Y coordinate is required")
    .isNumeric(),
];

const resizeBlockValidator = [
  param("blockId")
    .notEmpty()
    .withMessage("Block ID is required"),
  body("width")
    .notEmpty()
    .withMessage("Width is required")
    .isNumeric(),
  body("height")
    .notEmpty()
    .withMessage("Height is required")
    .isNumeric(),
];

const convertBlockValidator = [
  param("blockId")
    .notEmpty()
    .withMessage("Block ID is required"),
  body("targetType")
    .notEmpty()
    .withMessage("Target type is required")
    .isIn(BlockType),
];

// Canvas Connection Validators
const createConnectionValidator = [
  body("pageId")
    .notEmpty()
    .withMessage("Page ID is required")
    .isString()
    .trim(),
  body("fromBlockId")
    .notEmpty()
    .withMessage("From block ID is required")
    .isString()
    .trim(),
  body("toBlockId")
    .notEmpty()
    .withMessage("To block ID is required")
    .isString()
    .trim(),
  body("label")
    .optional()
    .isString()
    .trim(),
  body("connectionType")
    .optional()
    .isIn(["link", "reference", "depends_on", "relates_to"]),
];

// Canvas Comment Validators
const createCommentValidator = [
  param("blockId")
    .notEmpty()
    .withMessage("Block ID is required"),
  body("message")
    .notEmpty()
    .withMessage("Message is required")
    .isString()
    .trim()
    .isLength({ min: 1, max: 5000 }),
  body("mentions")
    .optional()
    .isArray(),
];

const updateCommentValidator = [
  param("commentId")
    .notEmpty()
    .withMessage("Comment ID is required"),
  body("message")
    .notEmpty()
    .withMessage("Message is required")
    .isString()
    .trim()
    .isLength({ min: 1, max: 5000 }),
];

// Query Validators
const blockQueryValidator = [
  query("pageId")
    .optional()
    .isString()
    .trim(),
  query("type")
    .optional()
    .isIn(BlockType),
  query("search")
    .optional()
    .isString()
    .trim(),
  query("page")
    .optional()
    .isInt({ min: 0 }),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 }),
];

const pageQueryValidator = [
  query("workspaceId")
    .optional()
    .isString()
    .trim(),
  query("projectId")
    .optional()
    .isString()
    .trim(),
  query("page")
    .optional()
    .isInt({ min: 0 }),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 }),
];

module.exports = {
  createWorkspaceValidator,
  updateWorkspaceValidator,
  createPageValidator,
  updatePageValidator,
  createBlockValidator,
  updateBlockValidator,
  moveBlockValidator,
  resizeBlockValidator,
  convertBlockValidator,
  createConnectionValidator,
  createCommentValidator,
  updateCommentValidator,
  blockQueryValidator,
  pageQueryValidator,
};
