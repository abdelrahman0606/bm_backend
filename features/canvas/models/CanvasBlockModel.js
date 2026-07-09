const mongoose = require("mongoose");
const { BlockType, BlockState } = require("../enums/canvasEnums");

const CanvasBlockSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, trim: true },
    projectId: { type: String, required: true, trim: true },
    pageId: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: BlockType,
      default: "note",
    },
    title: { type: String, trim: true, default: "" },
    content: { type: String, required: true, trim: true },
    createdBy: { type: String, required: true, trim: true },
    lastEditedBy: { type: String, trim: true, default: null },
    tags: { type: [String], default: [] },
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 300 },
    height: { type: Number, default: 200 },
    zIndex: { type: Number, default: 0 },
    isLocked: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    state: {
      type: String,
      enum: BlockState,
      default: "active",
    },
    backgroundColor: { type: String, trim: true, default: "#ffffff" },
    borderColor: { type: String, trim: true, default: "#e0e0e0" },
    comments: { type: [String], default: [] },
    references: { type: [String], default: [] },
    linkedTaskIds: { type: [String], default: [] },
    reactions: { type: Map, of: [String], default: new Map() },
    collaborators: { type: [String], default: [] },
    version: { type: Number, default: 1 },
    parentBlockId: { type: String, trim: true, default: null },
    childBlockIds: { type: [String], default: [] },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

CanvasBlockSchema.index({ workspaceId: 1, projectId: 1, pageId: 1 });
CanvasBlockSchema.index({ createdBy: 1 });
CanvasBlockSchema.index({ tags: 1 });
CanvasBlockSchema.index({ type: 1 });

module.exports = mongoose.model("CanvasBlock", CanvasBlockSchema);
