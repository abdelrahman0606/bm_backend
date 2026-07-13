const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");
const { ActivityEntityType, ActivityAction } = require("./activityEnums");

const ActivitySchema = new mongoose.Schema(
  {
    companyId: {
      type: String,
      required: true,
      index: true,
    },
    projectId: {
      type: String,
      required: true,
      index: true,
    },
    issueId: {
      type: String,
      default: null,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: Object.values(ActivityAction),
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: Object.values(ActivityEntityType),
      required: true,
      index: true,
    },
    entityId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
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
    collection: "activities",
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
ActivitySchema.index({ companyId: 1, projectId: 1, createdAt: -1 }); // Timeline query optimization
ActivitySchema.index({ companyId: 1, issueId: 1, createdAt: -1 });
ActivitySchema.index({ companyId: 1, userId: 1, createdAt: -1 });

const ActivityModel = tasksDb.model("Activity", ActivitySchema);
module.exports = ActivityModel;
