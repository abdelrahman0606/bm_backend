const { check } = require("express-validator");
const validatorMiddleware = require("../../../middlewares/validatorMiddleware");
const {
  ProjectVisibility,
  ProjectStatus,
  ProjectPriority,
} = require("./projectEnums");

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

function isValidNullableDate(value, allowNull) {
  if (value === null) return allowNull;
  if (value === undefined || value === "") return true;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

exports.getProjectValidator = [
  check("id").isMongoId().withMessage("Invalid project id"),
  validatorMiddleware,
];

exports.createProjectValidator = [
  check("workspaceId")
    .notEmpty()
    .withMessage("workspaceId is required")
    .isString(),
  check("createdBy").notEmpty().withMessage("createdBy is required").isString(),
  check("title")
    .notEmpty()
    .withMessage("title is required")
    .isLength({ min: 3, max: 128 }),
  check("description")
    .notEmpty()
    .withMessage("description is required")
    .isString(),
  check("coverImage").optional().isString(),
  check("emoji").optional().isString(),
  check("icon").optional().isString(),
  check("colorValue").optional().isInt(),
  check("privacy")
    .notEmpty()
    .withMessage("privacy is required")
    .isIn(Object.values(ProjectVisibility)),
  check("status")
    .notEmpty()
    .withMessage("status is required")
    .isIn(Object.values(ProjectStatus)),
  check("priority")
    .notEmpty()
    .withMessage("priority is required")
    .isIn(Object.values(ProjectPriority)),
  check("isFavorite").optional().isBoolean(),
  check("isArchived").optional().isBoolean(),
  check("isTemplate").optional().isBoolean(),
  check("isDeleted").optional().isBoolean(),
  check("tags").optional().isArray(),
  check("attachments").optional().isArray(),
  check("links").optional().isArray(),
  check("members").optional().isArray(),
  check("settings")
    .optional()
    .custom(
      (value) =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    )
    .withMessage("settings must be an object"),
  check("analytics")
    .optional()
    .custom(
      (value) =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    )
    .withMessage("analytics must be an object"),
  check("archivedAt")
    .optional({ nullable: true })
    .custom((value, { req }) => {
      const isArchived = parseBoolean(req.body.isArchived);
      return isValidNullableDate(value, !isArchived);
    })
    .withMessage(
      "archivedAt must be a valid ISO date or null when isArchived is false",
    ),
  check("deletedAt")
    .optional({ nullable: true })
    .custom((value, { req }) => {
      const isDeleted = parseBoolean(req.body.isDeleted);
      return isValidNullableDate(value, !isDeleted);
    })
    .withMessage(
      "deletedAt must be a valid ISO date or null when isDeleted is false",
    ),
  check("startDate").optional().isISO8601(),
  check("dueDate").optional().isISO8601(),
  check("lastActivityAt").optional().isISO8601(),
  validatorMiddleware,
];

exports.updateProjectValidator = [
  check("id").isMongoId().withMessage("Invalid project id"),
  check("workspaceId").optional().isString(),
  check("createdBy").optional().isString(),
  check("title").optional().isLength({ min: 3, max: 128 }),
  check("description").optional().isString(),
  check("coverImage").optional().isString(),
  check("emoji").optional().isString(),
  check("icon").optional().isString(),
  check("colorValue").optional().isInt(),
  check("privacy").optional().isIn(Object.values(ProjectVisibility)),
  check("status").optional().isIn(Object.values(ProjectStatus)),
  check("priority").optional().isIn(Object.values(ProjectPriority)),
  check("isFavorite").optional().isBoolean(),
  check("isArchived").optional().isBoolean(),
  check("isTemplate").optional().isBoolean(),
  check("isDeleted").optional().isBoolean(),
  check("tags").optional().isArray(),
  check("attachments").optional().isArray(),
  check("links").optional().isArray(),
  check("members").optional().isArray(),
  check("settings")
    .optional()
    .custom(
      (value) =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    )
    .withMessage("settings must be an object"),
  check("analytics")
    .optional()
    .custom(
      (value) =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    )
    .withMessage("analytics must be an object"),
  check("archivedAt")
    .optional({ nullable: true })
    .custom((value, { req }) => {
      const isArchived = parseBoolean(req.body.isArchived);
      return isValidNullableDate(value, !isArchived);
    })
    .withMessage(
      "archivedAt must be a valid ISO date or null when isArchived is false",
    ),
  check("deletedAt")
    .optional({ nullable: true })
    .custom((value, { req }) => {
      const isDeleted = parseBoolean(req.body.isDeleted);
      return isValidNullableDate(value, !isDeleted);
    })
    .withMessage(
      "deletedAt must be a valid ISO date or null when isDeleted is false",
    ),
  check("startDate").optional().isISO8601(),
  check("dueDate").optional().isISO8601(),
  check("lastActivityAt").optional().isISO8601(),
  validatorMiddleware,
];

exports.deleteProjectValidator = [
  check("id").isMongoId().withMessage("Invalid project id"),
  validatorMiddleware,
];
