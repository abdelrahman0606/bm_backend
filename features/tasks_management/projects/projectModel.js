const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");
const { ProjectVisibility, ProjectStatus, ProjectType } = require("./projectEnums");

// ── Analytics Sub-Schema ───────────────────────────────────────────────────
const ProjectAnalyticsSchema = new mongoose.Schema(
  {
    tasksCount:          { type: Number, default: 0 },
    completedTasksCount: { type: Number, default: 0 },
    overdueTasksCount:   { type: Number, default: 0 },
    membersCount:        { type: Number, default: 0 },
    filesCount:          { type: Number, default: 0 },
    commentsCount:       { type: Number, default: 0 },
    progress:            { type: Number, default: 0.0 },
  },
  { _id: false }
);

// ── Project Schema ─────────────────────────────────────────────────────────
const ProjectSchema = new mongoose.Schema(
  {
    // ── Identity & Core References ─────────────────────────────────────
    companyId: {
      type: String,
      required: true,
      index: true,
    },
    createdBy: {
      type: String,
      required: true,
      index: true,
    },

    // ── Info ───────────────────────────────────────────────────────────
    title:       { type: String, required: true, trim: true },
    key:         { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: "" },

    // ── Assets & Styling ───────────────────────────────────────────────
    logo:  { type: Object, default: null },
    color: { type: Number, default: null },

    // ── Classification & Configuration ─────────────────────────────────
    privacy: {
      type: String,
      enum: Object.values(ProjectVisibility),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(ProjectStatus),
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(ProjectType),
      required: true,
    },

    // ── Flags ──────────────────────────────────────────────────────────
    isFavorite: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    isDeleted:  { type: Boolean, default: false },

    // ── Analytics ──────────────────────────────────────────────────────
    analytics: {
      type: ProjectAnalyticsSchema,
      default: () => ({}),
    },

    // ── Dates ──────────────────────────────────────────────────────────
    startDate:      { type: Date, default: null },
    dueDate:        { type: Date, default: null },
    lastActivityAt: { type: Date, default: null, index: true },
    archivedAt:     { type: Date, default: null },
    deletedAt:      { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    collection: "projects",
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
ProjectSchema.index({ companyId: 1, isDeleted: 1 });
ProjectSchema.index({ companyId: 1, status: 1 });
ProjectSchema.index({ companyId: 1, privacy: 1 });
ProjectSchema.index({ createdBy: 1 });
ProjectSchema.index({ updatedAt: -1 });
ProjectSchema.index({ lastActivityAt: -1 });
ProjectSchema.index({ isDeleted: 1, isArchived: 1 });

const ProjectModel = tasksDb.model("TaskProject", ProjectSchema);
module.exports = ProjectModel;
