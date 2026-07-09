const mongoose = require("mongoose");

const CanvasCommentSchema = new mongoose.Schema(
  {
    blockId: { type: String, required: true, trim: true },
    userId: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    attachments: { type: [String], default: [] },
    mentions: { type: [String], default: [] },
    reactions: { type: Map, of: [String], default: new Map() },
    replies: [
      {
        id: { type: String, required: true },
        userId: { type: String, required: true },
        message: { type: String, required: true },
        createdAt: { type: Date, required: true, default: Date.now },
        updatedAt: { type: Date, default: null },
      },
    ],
    isPinned: { type: Boolean, default: false },
    isResolved: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

CanvasCommentSchema.index({ blockId: 1 });
CanvasCommentSchema.index({ userId: 1 });

module.exports = mongoose.model("CanvasComment", CanvasCommentSchema);
