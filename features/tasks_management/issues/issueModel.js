const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const IssueSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskProject", required: true },
    sprintId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskSprint", default: null },
    statusId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskStatus", default: null },
    priorityId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskPriority", default: null },
    assigneeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    reporterId: { type: mongoose.Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    estimate: { type: Number, default: 0 },
    storyPoints: { type: Number, default: null },
    dueDate: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

IssueSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

IssueSchema.set("versionKey", false);

// Indexes
IssueSchema.index({ projectId: 1 });
IssueSchema.index({ assigneeId: 1 });
IssueSchema.index({ reporterId: 1 });
IssueSchema.index({ statusId: 1 });

const IssueModel = tasksDb.model("Issue", IssueSchema);
module.exports = IssueModel;
