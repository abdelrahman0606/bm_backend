const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");
const { StatusType } = require("./statusEnums");

const StatusSchema = new mongoose.Schema(
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
    color: {
      type: String,
      default: "#E2E8F0",
    },
    icon: {
      type: mongoose.Schema.Types.Mixed, // Can be string identifier or code point
      default: null,
    },
    statusType: {
      type: String,
      enum: Object.values(StatusType),
      required: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    createdByUserId: {
      type: String,
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
    collection: "statuses",
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
StatusSchema.index({ companyId: 1 });
StatusSchema.index({ projectId: 1, order: 1 });
StatusSchema.index({ projectId: 1, title: 1 }, { unique: true }); // Prevent duplicate titles per project

const StatusModel = tasksDb.model("TaskStatus", StatusSchema);
module.exports = StatusModel;
