const { check } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

// Upload photo validator
exports.uploadPhotoValidator = [
  check("chatId").optional().isString().withMessage("chatId must be a string"),
  check("photoNetworkUrl")
    .optional()
    .isURL()
    .withMessage("photoNetworkUrl must be a valid URL"),
  check("file_name")
    .optional()
    .isString()
    .withMessage("file_name must be a string"),
  check("caption")
    .optional()
    .isString()
    .withMessage("caption must be a string"),
  check("parseMode")
    .optional()
    .isIn(["Markdown", "HTML"])
    .withMessage("parseMode must be Markdown or HTML"),
  validatorMiddleware,
];

// Fetch image validator
exports.fetchImageValidator = [
  check("url").isURL().withMessage("url must be a valid URL"),
  validatorMiddleware,
];

// Fetch video validator
exports.fetchVideoValidator = [
  check("url").isURL().withMessage("url must be a valid URL"),
  validatorMiddleware,
];

// Get video info validator
exports.getVideoInfoValidator = [
  check("fileId").notEmpty().withMessage("fileId is required").isString(),
  validatorMiddleware,
];

// Get updates validator
exports.getUpdatesValidator = [
  check("offset")
    .optional()
    .isInt({ min: 0 })
    .withMessage("offset must be a non-negative integer"),
  check("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100"),
  check("timeout")
    .optional()
    .isInt({ min: 0 })
    .withMessage("timeout must be a non-negative integer"),
  check("allowedUpdates")
    .optional()
    .isArray()
    .withMessage("allowedUpdates must be an array"),
  validatorMiddleware,
];

// Send message validator
exports.sendMessageValidator = [
  check("chatId").notEmpty().withMessage("chatId is required").isString(),
  check("text").notEmpty().withMessage("text is required").isString(),
  check("parseMode")
    .optional()
    .isIn(["Markdown", "HTML"])
    .withMessage("parseMode must be Markdown or HTML"),
  validatorMiddleware,
];

// Download file validator
exports.downloadFileValidator = [
  check("url").notEmpty().withMessage("url is required").isString(),
  validatorMiddleware,
];

// Get chat image validator
exports.getChatImageValidator = [
  check("chatId").notEmpty().withMessage("chatId is required").isString(),
  validatorMiddleware,
];

// Upload video validator
exports.uploadVideoValidator = [
  check("chatId").optional().isString().withMessage("chatId must be a string"),
  check("videoNetworkUrl")
    .optional()
    .isURL()
    .withMessage("videoNetworkUrl must be a valid URL"),
  check("file_name")
    .optional()
    .isString()
    .withMessage("file_name must be a string"),
  check("caption")
    .optional()
    .isString()
    .withMessage("caption must be a string"),
  check("parseMode")
    .optional()
    .isIn(["Markdown", "HTML"])
    .withMessage("parseMode must be Markdown or HTML"),
  validatorMiddleware,
];

// Upload document validator
exports.uploadDocumentValidator = [
  check("chatId").optional().isString().withMessage("chatId must be a string"),
  check("documentNetworkUrl")
    .optional()
    .isURL()
    .withMessage("documentNetworkUrl must be a valid URL"),
  check("file_name")
    .optional()
    .isString()
    .withMessage("file_name must be a string"),
  check("caption")
    .optional()
    .isString()
    .withMessage("caption must be a string"),
  check("parseMode")
    .optional()
    .isIn(["Markdown", "HTML"])
    .withMessage("parseMode must be Markdown or HTML"),
  validatorMiddleware,
];
