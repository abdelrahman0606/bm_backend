const mongoose = require("mongoose");

const {
  REQUEST_CATEGORIES,
  REQUEST_STATUSES,
} = require("./deviceControlConstants");

/**
 * An employee asking for one restricted thing.
 *
 * The requester is taken from the verified token, never from the body, and
 * the reviewer is checked against it on decision: nobody approves their own
 * request, whatever their role. An administrator who needs an exception on
 * their own machine still files one and another administrator decides it.
 *
 * `requestedUntil` is what the employee asked for; `expiresAt` on the
 * resulting exception is what the reviewer granted. They are kept apart so a
 * reviewer can shorten a request without the record losing what was asked.
 */
const accessRequestSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },

    requesterId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true, index: true },

    category: { type: String, required: true, enum: REQUEST_CATEGORIES },
    resource: { type: String, required: true, trim: true },
    reason: { type: String, required: true, trim: true },

    requestedUntil: { type: Date, default: null },

    status: {
      type: String,
      required: true,
      default: "pending",
      enum: REQUEST_STATUSES,
    },

    reviewerId: { type: String, default: null },
    decisionNote: { type: String, default: "", trim: true },
    decidedAt: { type: Date, default: null },

    /** Set when an approval produced an exception, so the two stay linked. */
    exceptionId: { type: String, default: null },
  },
  { timestamps: true }
);

// The reviewer's queue, and the employee's own list.
accessRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
accessRequestSchema.index({ companyId: 1, requesterId: 1, createdAt: -1 });

module.exports = mongoose.model(
  "DeviceControlAccessRequest",
  accessRequestSchema
);
