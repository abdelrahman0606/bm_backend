const mongoose = require("mongoose");
const { WorkspaceRole } = require("../enums/canvasEnums");

const WorkspaceMemberSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true },
    role: {
      type: String,
      required: true,
      enum: WorkspaceRole,
      default: "viewer",
    },
    joinedAt: { type: Date, required: true, default: Date.now },
    isActive: { type: Boolean, default: true },
  },
  { _id: false },
);

const WorkspaceSettingsSchema = new mongoose.Schema(
  {
    allowPublicAccess: { type: Boolean, default: false },
    allowComments: { type: Boolean, default: true },
    allowCollaboration: { type: Boolean, default: true },
    maxBlocksPerPage: { type: Number, default: 1000 },
    enableVersionControl: { type: Boolean, default: true },
    enableAiAssistant: { type: Boolean, default: false },
  },
  { _id: false },
);

const WorkspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    image: { type: String, trim: true, default: null },
    ownerId: { type: String, required: true, trim: true },
    members: {
      type: [WorkspaceMemberSchema],
      default: [],
    },
    settings: {
      type: WorkspaceSettingsSchema,
      default: () => ({}),
    },
    isArchived: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Workspace", WorkspaceSchema);
