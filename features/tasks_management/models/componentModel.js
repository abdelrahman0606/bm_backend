const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const ComponentSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ComponentSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

ComponentSchema.set("versionKey", false);

ComponentSchema.index({ projectId: 1 });

const ComponentModel = tasksDb.model("TaskComponent", ComponentSchema);
module.exports = ComponentModel;
