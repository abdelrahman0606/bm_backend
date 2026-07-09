const mongoose = require("mongoose");
const { PageAccess } = require("../enums/canvasEnums");

const CanvasPageSchema = new mongoose.Schema(
  {
    workspaceId: { type: String, required: true, trim: true },
    projectId: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    icon: { type: String, trim: true, default: "📄" },
    coverImage: { type: String, trim: true, default: null },
    createdBy: { type: String, required: true, trim: true },
    access: {
      type: String,
      enum: PageAccess,
      default: "private",
    },
    isFavorite: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    parentPageId: { type: String, trim: true, default: null },
    blocksCount: { type: Number, default: 0 },
    collaborators: { type: [String], default: [] },
    tags: { type: [String], default: [] },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CanvasPage", CanvasPageSchema);
