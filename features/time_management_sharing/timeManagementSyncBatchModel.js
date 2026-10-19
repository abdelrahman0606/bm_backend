const mongoose = require("mongoose");

const timeManagementSyncBatchSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
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
    syncType: {
      type: String,
      // delta: the payload is added to the stored daily totals
      // absolute: the payload replaces the stored daily totals
      enum: ["delta", "absolute"],
      default: "delta",
    },
    totalDuration: {
      type: Number,
      required: true,
      min: 0,
    },
    appCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["processing", "completed", "failed"],
      default: "completed",
    },
    processedAt: {
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

timeManagementSyncBatchSchema.index({ shareId: 1, batchId: 1 });
timeManagementSyncBatchSchema.index({ senderUserId: 1, createdAt: -1 });

module.exports = mongoose.model(
  "TimeManagementSyncBatch",
  timeManagementSyncBatchSchema
);
