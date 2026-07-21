const express = require("express");
const { validationResult } = require("express-validator");
const CommentController = require("./commentController");
const {
  createCommentValidator,
  updateCommentValidator,
  getCommentsValidator,
  commentIdValidator,
} = require("./commentValidator");

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }
  return next();
};

router.post(
  "/",
  createCommentValidator,
  validate,
  CommentController.createComment
);

router.get(
  "/",
  getCommentsValidator,
  validate,
  CommentController.getComments
);

router.patch(
  "/:commentId",
  updateCommentValidator,
  validate,
  CommentController.updateComment
);

router.delete(
  "/:commentId",
  commentIdValidator,
  validate,
  CommentController.deleteComment
);

module.exports = router;
