const mongoose = require("mongoose");
const { Schema } = mongoose;

const CommentSchema = new Schema(
  {
    companyId: {
      type: String,
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
      index: true,
    },
    issueId: {
      type: Schema.Types.ObjectId,
      ref: "Issue",
      required: true,
      index: true,
    },
    parentCommentId: {
      type: Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    mentionedUsers: {
      type: [String],
      default: [],
    },
    createdBy: {
      type: String,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true, // Automatically adds createdAt and updatedAt
  }
);

// Optional: Add indexes for faster queries
CommentSchema.index({ issueId: 1, createdAt: 1 });
CommentSchema.index({ companyId: 1, projectId: 1, issueId: 1 });

const CommentModel = mongoose.model("Comment", CommentSchema);

module.exports = CommentModel;
