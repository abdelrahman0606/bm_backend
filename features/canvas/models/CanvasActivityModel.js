const mongoose = require("mongoose");
const { BlockAction } = require("../enums/canvasEnums");

const CanvasActivitySchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, trim: true },
    projectId: { type: String, required: true, trim: true },
    pageId: { type: String, trim: true, default: null },
    blockId: { type: String, trim: true, default: null },
    connectionId: { type: String, trim: true, default: null },
    userId: { type: String, required: true, trim: true },
    action: {
      type: String,
      required: true,
      enum: BlockAction,
    },
    entityType: {
      type: String,
      enum: ["workspace", "page", "block", "connection", "comment"],
      default: "block",
    },
    title: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
    changes: {
      before: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
      after: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
    },
    ipAddress: { type: String, trim: true, default: null },
    userAgent: { type: String, trim: true, default: null },
    isSystemAction: { type: Boolean, default: false },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false },
);

CanvasActivitySchema.index({ workspaceId: 1, createdAt: -1 });
CanvasActivitySchema.index({ projectId: 1, createdAt: -1 });
CanvasActivitySchema.index({ pageId: 1, createdAt: -1 });
CanvasActivitySchema.index({ blockId: 1, createdAt: -1 });
CanvasActivitySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("CanvasActivity", CanvasActivitySchema);
