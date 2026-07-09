const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const TimeLogSchema = new mongoose.Schema(
  {
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    minutes: { type: Number, required: true, min: 1 },
    description: { type: String, trim: true, default: "" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

TimeLogSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

TimeLogSchema.set("versionKey", false);

TimeLogSchema.index({ issueId: 1 });
TimeLogSchema.index({ userId: 1 });

const TimeLogModel = tasksDb.model("TaskTimeLog", TimeLogSchema);
module.exports = TimeLogModel;
