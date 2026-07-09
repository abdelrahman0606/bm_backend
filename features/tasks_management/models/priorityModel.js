const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const PrioritySchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskWorkspace", required: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: "#E2E8F0" },
    order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PrioritySchema.virtual("id").get(function () {
  return this._id.toHexString();
});

PrioritySchema.set("versionKey", false);

PrioritySchema.index({ workspaceId: 1 });

const PriorityModel = tasksDb.model("TaskPriority", PrioritySchema);
module.exports = PriorityModel;
