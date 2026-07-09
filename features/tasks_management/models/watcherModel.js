const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const WatcherSchema = new mongoose.Schema(
  {
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

WatcherSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

WatcherSchema.set("versionKey", false);

WatcherSchema.index({ issueId: 1, userId: 1 }, { unique: true });

const WatcherModel = tasksDb.model("TaskWatcher", WatcherSchema);
module.exports = WatcherModel;
