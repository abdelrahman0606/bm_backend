const mongoose = require("mongoose");

/**
 * One delivery of a Share Time configuration to its recipient.
 *
 * A delivery is the unit the recipient sees ("user X shared their tracked time
 * for 2026-10-19"). `occurrenceKey` identifies the scheduled occurrence (or the
 * manual trigger) that produced it and is unique per share, which is what makes
 * the scheduler safe to retry: running the same occurrence twice cannot create
 * two deliveries.
 */
const timeManagementShareDeliverySchema = new mongoose.Schema(
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
    // "manual:<iso>" for owner-triggered deliveries, the occurrence timestamp
    // (ISO string) for scheduled ones.
    occurrenceKey: {
      type: String,
      required: true,
    },
    trigger: {
      type: String,
      enum: ["manual", "scheduled"],
      default: "manual",
    },
    // Inclusive date range (YYYY-MM-DD) the delivered usage covers.
    dateFrom: {
      type: String,
      default: null,
    },
    dateTo: {
      type: String,
      default: null,
    },
    totalDuration: {
      type: Number,
      default: 0,
      min: 0,
    },
    appCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    dayCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["delivered", "empty", "failed"],
      default: "delivered",
    },
    error: {
      type: String,
      default: null,
    },
    deliveredAt: {
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

// Duplicate-delivery guard for repeated scheduler execution.
timeManagementShareDeliverySchema.index(
  { shareId: 1, occurrenceKey: 1 },
  { unique: true }
);
timeManagementShareDeliverySchema.index({ recipientUserId: 1, createdAt: -1 });
timeManagementShareDeliverySchema.index({ senderUserId: 1, createdAt: -1 });

module.exports = mongoose.model(
  "TimeManagementShareDelivery",
  timeManagementShareDeliverySchema
);
