const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const AttachmentSchema = new mongoose.Schema(
  {
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fileUrl: { type: String, required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: "" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

AttachmentSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

AttachmentSchema.set("versionKey", false);

AttachmentSchema.index({ issueId: 1 });

const AttachmentModel = tasksDb.model("TaskAttachment", AttachmentSchema);
module.exports = AttachmentModel;
