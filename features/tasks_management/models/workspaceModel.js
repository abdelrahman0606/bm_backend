const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const WorkspaceSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    logoFileId: { type: mongoose.Schema.Types.ObjectId, default: null },
    coverFileId: { type: mongoose.Schema.Types.ObjectId, default: null },
    timezone: { type: String, default: "UTC" },
    locale: { type: String, default: "en" },
    currency: { type: String, default: "USD" },
    archived: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

WorkspaceSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

WorkspaceSchema.set("versionKey", false);

WorkspaceSchema.index({ ownerId: 1 });
WorkspaceSchema.index({ archived: 1 });

const WorkspaceModel = tasksDb.model("TaskWorkspace", WorkspaceSchema);
module.exports = WorkspaceModel;
