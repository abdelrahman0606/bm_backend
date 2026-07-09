const mongoose = require("mongoose");

const CanvasConnectionSchema = new mongoose.Schema(
  {
    pageId: { type: String, required: true, trim: true },
    fromBlockId: { type: String, required: true, trim: true },
    toBlockId: { type: String, required: true, trim: true },
    label: { type: String, trim: true, default: "" },
    connectionType: {
      type: String,
      enum: ["link", "reference", "depends_on", "relates_to"],
      default: "link",
    },
    style: {
      type: String,
      enum: ["straight", "curved", "bezier"],
      default: "curved",
    },
    createdBy: { type: String, required: true, trim: true },
    isDeleted: { type: Boolean, default: false },
    metadata: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

CanvasConnectionSchema.index({ pageId: 1 });
CanvasConnectionSchema.index({ fromBlockId: 1 });
CanvasConnectionSchema.index({ toBlockId: 1 });

module.exports = mongoose.model("CanvasConnection", CanvasConnectionSchema);
