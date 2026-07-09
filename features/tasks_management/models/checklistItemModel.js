const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const ChecklistItemSchema = new mongoose.Schema(
  {
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true },
    title: { type: String, required: true, trim: true },
    completed: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

ChecklistItemSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

ChecklistItemSchema.set("versionKey", false);

ChecklistItemSchema.index({ issueId: 1 });

const ChecklistItemModel = tasksDb.model("TaskChecklistItem", ChecklistItemSchema);
module.exports = ChecklistItemModel;
