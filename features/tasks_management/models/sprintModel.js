const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const SprintSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    boardId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskBoard", required: true },
    name: { type: String, required: true, trim: true },
    goal: { type: String, trim: true, default: "" },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    state: { type: String, default: "active", enum: ["active", "completed", "planned"] },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

SprintSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

SprintSchema.set("versionKey", false);

SprintSchema.index({ projectId: 1 });
SprintSchema.index({ boardId: 1 });

const SprintModel = tasksDb.model("TaskSprint", SprintSchema);
module.exports = SprintModel;
