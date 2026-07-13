const { body, param, query } = require("express-validator");
const { StatusType } = require("./statusEnums");

const createStatusValidator = [
  body("companyId")
    .notEmpty()
    .withMessage("companyId is required")
    .isString(),
  body("projectId")
    .notEmpty()
    .withMessage("projectId is required")
    .isString(),
  body("title")
    .notEmpty()
    .withMessage("title is required")
    .isString()
    .trim(),
  body("description")
    .optional()
    .isString()
    .trim(),
  body("color")
    .optional()
    .isString(),
  body("icon")
    .optional(),
  body("statusType")
    .notEmpty()
    .withMessage("statusType is required")
    .isIn(Object.values(StatusType))
    .withMessage(`statusType must be one of: ${Object.values(StatusType).join(", ")}`),
  body("order")
    .optional()
    .isNumeric(),
];

const updateStatusValidator = [
  param("id").isMongoId().withMessage("Invalid status ID"),
  body("title").optional().isString().trim(),
  body("description").optional().isString().trim(),
  body("color").optional().isString(),
  body("icon").optional(),
  body("statusType")
    .optional()
    .isIn(Object.values(StatusType))
    .withMessage(`statusType must be one of: ${Object.values(StatusType).join(", ")}`),
  body("isArchived").optional().isBoolean(),
];

const reorderStatusesValidator = [
  body("projectId").notEmpty().withMessage("projectId is required").isString(),
  body("orderedIds")
    .isArray({ min: 1 })
    .withMessage("orderedIds must be a non-empty array of status IDs"),
  body("orderedIds.*").isMongoId().withMessage("Each item in orderedIds must be a valid status ID"),
];

const getStatusesValidator = [
  query("companyId").optional().isString(),
  query("projectId").optional().isString(),
  query("statusType").optional().isIn(Object.values(StatusType)),
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
];

const getStatusByIdValidator = [
  param("id").isMongoId().withMessage("Invalid status ID"),
];

const deleteStatusValidator = [
  param("id").isMongoId().withMessage("Invalid status ID"),
];

module.exports = {
  createStatusValidator,
  updateStatusValidator,
  reorderStatusesValidator,
  getStatusesValidator,
  getStatusByIdValidator,
  deleteStatusValidator,
};
