const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const StatusCategory = {
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  DONE: "DONE",
};

const StatusSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskWorkspace", required: true },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: Object.values(StatusCategory),
      required: true,
    },
    color: { type: String, default: "#E2E8F0" },
    order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

StatusSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

StatusSchema.set("versionKey", false);

StatusSchema.index({ workspaceId: 1 });

const StatusModel = tasksDb.model("TaskStatus", StatusSchema);
module.exports = StatusModel;
