const mongoose = require("mongoose");
const {
  localMongoConnection,
} = require("../../infrastructure/database/database.manager");

const windowUsageSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    durationMs: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { _id: false }
);

const appUsageSchema = new mongoose.Schema(
  {
    appName: {
      type: String,
      required: true,
      trim: true,
    },
    totalDuration: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    windows: {
      type: [windowUsageSchema],
      default: [],
    },
  },
  { _id: false }
);

const timeManagementUsageSchema = new mongoose.Schema(
  {
    shareId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimeManagementShare",
      required: true,
    },
    senderUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    filterId: {
      type: String,
      required: true,
    },
    date: {
      type: String, // YYYY-MM-DD
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    totalDuration: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    apps: {
      type: [appUsageSchema],
      default: [],
    },
    lastSyncAt: {
      type: Date,
      default: Date.now,
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
  }
);

// Unique compound index: one daily record per sender, recipient, filter, and date
timeManagementUsageSchema.index(
  { senderUserId: 1, recipientUserId: 1, filterId: 1, date: 1 },
  { unique: true }
);

// Supporting query indexes
timeManagementUsageSchema.index({ recipientUserId: 1, date: 1 });
timeManagementUsageSchema.index({ senderUserId: 1, date: 1 });
timeManagementUsageSchema.index({ shareId: 1, date: 1 });
timeManagementUsageSchema.index({ filterId: 1 });

/** Registered on local MongoDB — see `timeManagementShareModel.js`. */
function createTimeManagementUsageModel(connection = localMongoConnection) {
  return (
    connection.models.TimeManagementUsage ||
    connection.model("TimeManagementUsage", timeManagementUsageSchema)
  );
}

module.exports = createTimeManagementUsageModel();
module.exports.createTimeManagementUsageModel = createTimeManagementUsageModel;
