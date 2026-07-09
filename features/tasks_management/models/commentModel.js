const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const CommentSchema = new mongoose.Schema(
  {
    issueId: { type: mongoose.Schema.Types.ObjectId, ref: "Issue", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    message: { type: String, required: true, trim: true },
    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "TaskAttachment" }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

CommentSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

CommentSchema.set("versionKey", false);

CommentSchema.index({ issueId: 1 });

const CommentModel = tasksDb.model("TaskComment", CommentSchema);
module.exports = CommentModel;
