const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const ProjectSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskWorkspace", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    icon: { type: String, trim: true, default: null },
    archived: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ProjectSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

ProjectSchema.set("versionKey", false);

ProjectSchema.index({ workspaceId: 1 });
ProjectSchema.index({ archived: 1 });

const ProjectModel = tasksDb.model("TaskProject", ProjectSchema);
module.exports = ProjectModel;
