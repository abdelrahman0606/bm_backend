const mongoose = require("mongoose");
const tasksDb  = require("../tasksDatabase");
const { IssueType, IssuePriority, IssueVisibility } = require("./issueEnums");

// ── Embedded Sub-Schemas ──────────────────────────────────────────────────────

const ChecklistItemSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true, trim: true },
    completed:   { type: Boolean, default: false },
    completedBy: { type: String, default: null },  // userId string
    order:       { type: Number, default: 0 },
  },
  { _id: true, timestamps: true }
);

const LinkSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: "" },
    url:   { type: String, required: true, trim: true },
  },
  { _id: false }
);

const TimeTrackingSchema = new mongoose.Schema(
  {
    estimate:  { type: Number, default: 0 },  // minutes
    logged:    { type: Number, default: 0 },  // minutes
    remaining: { type: Number, default: 0 },  // minutes
  },
  { _id: false }
);

// ── Main Issue Schema ─────────────────────────────────────────────────────────

const IssueSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────────────────
    companyId: {
      type:     String,
      required: true,
      index:    true,
    },
    projectId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      "TaskProject",
      required: true,
      index:    true,
    },

    // ── Classification ────────────────────────────────────────────────────
    type: {
      type:    String,
      enum:    Object.values(IssueType),
      default: IssueType.TASK,
      index:   true,
    },
    priority: {
      type:    String,
      enum:    Object.values(IssuePriority),
      default: IssuePriority.MEDIUM,
      index:   true,
    },
    visibility: {
      type:    String,
      enum:    Object.values(IssueVisibility),
      default: IssueVisibility.TEAM,
    },

    // ── Core Content ──────────────────────────────────────────────────────
    title: {
      type:     String,
      required: true,
      trim:     true,
    },
    description: {
      type:    String,
      trim:    true,
      default: "",
    },

    // ── People ────────────────────────────────────────────────────────────
    /** User who created the issue (stored as string to decouple from User DB) */
    createdBy: {
      type:     String,
      required: true,
      index:    true,
    },
    /** Single assignee — replaces the old array `assignedTo` */
    assignedTo: {
      type:    String,
      default: null,
      index:   true,
    },
    /** Watchers are stored in the separate WatcherModel collection */
    // watchers are NOT embedded here; use WatcherModel

    // ── Hierarchy ─────────────────────────────────────────────────────────
    parentId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Issue",
      default: null,
      index:   true,
    },

    // ── Status & Sprint ───────────────────────────────────────────────────
    statusId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "TaskStatus",
      default: null,
      index:   true,
    },
    sprintId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "TaskSprint",
      default: null,
      index:   true,
    },
    milestoneId: {
      type:    mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // ── Tags & Labels ─────────────────────────────────────────────────────
    tags: {
      type:    [String],
      default: [],
      index:   true,
    },

    // ── Links & Relationships ─────────────────────────────────────────────
    links: {
      type:    [LinkSchema],
      default: [],
    },
    dependencies: {
      type:    [mongoose.Schema.Types.ObjectId],
      ref:     "Issue",
      default: [],
    },
    blockedBy: {
      type:    [mongoose.Schema.Types.ObjectId],
      ref:     "Issue",
      default: [],
    },
    nextTaskIds: {
      type:    [mongoose.Schema.Types.ObjectId],
      ref:     "Issue",
      default: [],
    },

    // ── Checklist (embedded) ──────────────────────────────────────────────
    checklist: {
      type:    [ChecklistItemSchema],
      default: [],
    },

    // ── Time Tracking ─────────────────────────────────────────────────────
    timeTracking: {
      type:    TimeTrackingSchema,
      default: () => ({}),
    },

    // ── Metrics ───────────────────────────────────────────────────────────
    storyPoints: {
      type:    Number,
      default: null,
    },
    progress: {
      type:    Number,
      default: 0,
      min:     0,
      max:     100,
    },
    order: {
      type:    Number,
      default: 0,
      index:   true,
    },

    // ── Dates ─────────────────────────────────────────────────────────────
    startDate:      { type: Date, default: null },
    dueDate:        { type: Date, default: null, index: true },
    completedAt:    { type: Date, default: null },
    lastActivityAt: { type: Date, default: null },
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
    collection: "issues",
  }
);

// ── Backward-Compat Virtuals ──────────────────────────────────────────────────

/** Legacy alias: reporterId → createdBy */
IssueSchema.virtual("reporterId").get(function () {
  return this.createdBy;
});

/** Legacy alias: assigneeId → assignedTo */
IssueSchema.virtual("assigneeId").get(function () {
  return this.assignedTo;
});

/** Convenience flag */
IssueSchema.virtual("isArchived").get(function () {
  return this.archivedAt !== null;
});

IssueSchema.virtual("isDeleted").get(function () {
  return this.deletedAt !== null;
});

// ── Indexes ───────────────────────────────────────────────────────────────────

// Compound indexes for the most common query patterns
IssueSchema.index({ companyId: 1, projectId: 1, deletedAt: 1, archivedAt: 1 });
IssueSchema.index({ companyId: 1, projectId: 1, statusId: 1, order: 1 });
IssueSchema.index({ companyId: 1, projectId: 1, sprintId: 1 });
IssueSchema.index({ companyId: 1, projectId: 1, type: 1 });
IssueSchema.index({ companyId: 1, projectId: 1, priority: 1 });
IssueSchema.index({ companyId: 1, projectId: 1, dueDate: 1 });
IssueSchema.index({ companyId: 1, assignedTo: 1 });
IssueSchema.index({ createdBy: 1 });
IssueSchema.index({ parentId: 1 });
IssueSchema.index({ tags: 1 });
IssueSchema.index({ title: "text", description: "text" }); // full-text search

IssueSchema.set("versionKey", false);

const IssueModel = tasksDb.model("Issue", IssueSchema);
module.exports = IssueModel;
