const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");

// ── Sprint Status Enum ────────────────────────────────────────────────────────
const SprintStatus = {
  PLANNING: "planning",
  ACTIVE: "active",
  COMPLETED: "completed",
};

// ── Schema ────────────────────────────────────────────────────────────────────
const SprintSchema = new mongoose.Schema(
  {
    companyId: {
      type: String,
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskProject",
      required: true,
      index: true,
    },
    // Auto-incremented sprint number scoped to the project (e.g. Sprint 1, Sprint 2)
    number: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    goal: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(SprintStatus),
      default: SprintStatus.PLANNING,
      index: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: String,
      required: true,
      index: true,
    },
    // Drag-and-drop ordering within a project
    order: {
      type: Number,
      default: 0,
      index: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    // Optional backward-compat: keep boardId as optional reference
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskBoard",
      default: null,
    },
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
    collection: "sprints",
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
SprintSchema.index({ projectId: 1, number: 1 }, { unique: true });
SprintSchema.index({ projectId: 1, status: 1 });
SprintSchema.index({ projectId: 1, order: 1 });
SprintSchema.index({ companyId: 1, projectId: 1, createdAt: -1 });

const SprintModel = tasksDb.model("TaskSprint", SprintSchema);

module.exports = SprintModel;
module.exports.SprintStatus = SprintStatus;
