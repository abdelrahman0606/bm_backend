const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const ActivityAction = {
  ISSUE_CREATED: "Issue Created",
  ISSUE_UPDATED: "Issue Updated",
  STATUS_CHANGED: "Status Changed",
  PRIORITY_CHANGED: "Priority Changed",
  COMMENT_ADDED: "Comment Added",
  ATTACHMENT_ADDED: "Attachment Added",
  ASSIGNMENT_CHANGED: "Assignment Changed",
};

const ActivitySchema = new mongoose.Schema(
  {
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    action: {
      type: String,
      enum: Object.values(ActivityAction),
      required: true,
    },
    message: { type: String, required: true, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ActivitySchema.virtual("id").get(function () {
  return this._id.toHexString();
});

ActivitySchema.set("versionKey", false);

ActivitySchema.index({ issueId: 1 });

const ActivityModel = tasksDb.model("TaskActivity", ActivitySchema);
module.exports = ActivityModel;
