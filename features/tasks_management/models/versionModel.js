const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const VersionSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true, trim: true },
    releaseDate: { type: Date, default: null },
    released: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

VersionSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

VersionSchema.set("versionKey", false);

VersionSchema.index({ projectId: 1 });

const VersionModel = tasksDb.model("TaskVersion", VersionSchema);
module.exports = VersionModel;
