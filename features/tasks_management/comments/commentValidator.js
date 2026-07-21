const { body, param, query } = require("express-validator");

const createCommentValidator = [
  body("companyId")
    .notEmpty().withMessage("companyId is required")
    .isString().withMessage("companyId must be a string"),
  body("projectId")
    .notEmpty().withMessage("projectId is required")
    .isMongoId().withMessage("projectId must be a valid ObjectId"),
  body("issueId")
    .notEmpty().withMessage("issueId is required")
    .isMongoId().withMessage("issueId must be a valid ObjectId"),
  body("parentCommentId")
    .optional({ nullable: true })
    .isMongoId().withMessage("parentCommentId must be a valid ObjectId"),
  body("content")
    .notEmpty().withMessage("content is required")
    .isString().trim(),
  body("mentionedUsers")
    .optional({ nullable: true })
    .isArray().withMessage("mentionedUsers must be an array"),
  body("mentionedUsers.*")
    .optional()
    .isString().withMessage("each mentionedUser must be a string userId"),
];

const updateCommentValidator = [
  param("commentId")
    .notEmpty().withMessage("commentId is required")
    .isMongoId().withMessage("commentId must be a valid ObjectId"),
  body("content")
    .notEmpty().withMessage("content is required")
    .isString().trim(),
  body("mentionedUsers")
    .optional({ nullable: true })
    .isArray().withMessage("mentionedUsers must be an array"),
  body("mentionedUsers.*")
    .optional()
    .isString().withMessage("each mentionedUser must be a string userId"),
];

const getCommentsValidator = [
  query("issueId")
    .notEmpty().withMessage("issueId is required")
    .isMongoId().withMessage("issueId must be a valid ObjectId"),
  query("projectId")
    .optional({ nullable: true })
    .isMongoId().withMessage("projectId must be a valid ObjectId"),
];

const commentIdValidator = [
  param("commentId")
    .notEmpty().withMessage("commentId is required")
    .isMongoId().withMessage("commentId must be a valid ObjectId"),
];

module.exports = {
  createCommentValidator,
  updateCommentValidator,
  getCommentsValidator,
  commentIdValidator,
};
