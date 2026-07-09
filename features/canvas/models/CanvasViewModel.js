const mongoose = require("mongoose");

const CanvasViewSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true, trim: true },
    userId: { type: String, required: true, trim: true },
    zoom: { type: Number, default: 1, min: 0.25, max: 4 },
    offsetX: { type: Number, default: 0 },
    offsetY: { type: Number, default: 0 },
    selectedBlockId: { type: String, trim: true, default: null },
    viewMode: {
      type: String,
      enum: ["grid", "free", "outline"],
      default: "free",
    },
    showGrid: { type: Boolean, default: true },
    gridSize: { type: Number, default: 20 },
    snapToGrid: { type: Boolean, default: false },
    showMinimap: { type: Boolean, default: true },
    showConnections: { type: Boolean, default: true },
    hiddenBlockIds: { type: [String], default: [] },
    focusMode: { type: Boolean, default: false },
    theme: { type: String, enum: ["light", "dark"], default: "light" },
    lastViewedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

CanvasViewSchema.index({ pageId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("CanvasView", CanvasViewSchema);
