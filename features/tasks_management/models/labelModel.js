const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const LabelSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskWorkspace", required: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: "#E2E8F0" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

LabelSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

LabelSchema.set("versionKey", false);

LabelSchema.index({ workspaceId: 1 });

const LabelModel = tasksDb.model("TaskLabel", LabelSchema);
module.exports = LabelModel;
