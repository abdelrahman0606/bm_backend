const mongoose = require("mongoose");
const {
  localMongoConnection,
} = require("../../infrastructure/database/database.manager");

/**
 * The acknowledgement of one device usage synchronization batch.
 *
 * Its job is to answer a *repeated* request with the identical acknowledgement
 * the client may never have received — the case where the backend processed the
 * batch and the response was lost to a timeout. It is written only after the
 * contributions have been durably applied.
 *
 * It is deliberately **not** the mechanism that prevents double counting: that
 * property comes from the snapshot writes themselves, which set a device's
 * contribution instead of adding to it. So a ledger entry expiring (see the TTL
 * index below) can never make a replay double-count; it only costs one
 * redundant re-apply.
 */
const syncResultSchema = new mongoose.Schema(
  {
    // The client's own record id, echoed back untouched: it is how the client
    // marks exactly the right local records without having to reproduce the
    // backend's application-id normalization.
    localId: { type: String, default: null },
    appKey: { type: String, default: null },
    // Null for an item that was rejected because no application id could be
    // derived from its name.
    appId: { type: String, default: null },
    date: { type: String, required: true },
    revision: { type: Number, required: true },
    // applied  — stored as this device's contribution
    // stale    — the stored revision was newer, nothing changed
    // rejected — the item could not be processed (see `reason`)
    status: {
      type: String,
      enum: ["applied", "stale", "rejected"],
      required: true,
    },
    reason: { type: String, default: null },
  },
  { _id: false }
);

const timeManagementDeviceSyncBatchSchema = new mongoose.Schema(
  {
    // Client-generated and derived from the batch content, so a retry of the
    // same batch carries the same id.
    batchId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
    },
    itemCount: { type: Number, required: true, min: 0 },
    appliedCount: { type: Number, default: 0, min: 0 },
    staleCount: { type: Number, default: 0, min: 0 },
    rejectedCount: { type: Number, default: 0, min: 0 },
    dates: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["completed", "partial", "failed"],
      default: "completed",
    },
    // Per-item acknowledgement, so the client can mark exactly the items the
    // backend accepted and leave the rest pending.
    results: { type: [syncResultSchema], default: [] },
    processedAt: { type: Date, default: Date.now },
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

timeManagementDeviceSyncBatchSchema.index({ userId: 1, deviceId: 1, createdAt: -1 });
// The ledger only has to cover the retry window of a client, so entries expire
// instead of growing without bound. Safe because idempotency does not depend on
// them (see the comment above).
timeManagementDeviceSyncBatchSchema.index(
  { processedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 }
);

/** Registered on local MongoDB — see `timeManagementShareModel.js`. */
function createTimeManagementDeviceSyncBatchModel(
  connection = localMongoConnection
) {
  return (
    connection.models.TimeManagementDeviceSyncBatch ||
    connection.model(
      "TimeManagementDeviceSyncBatch",
      timeManagementDeviceSyncBatchSchema
    )
  );
}

module.exports = createTimeManagementDeviceSyncBatchModel();
module.exports.createTimeManagementDeviceSyncBatchModel =
  createTimeManagementDeviceSyncBatchModel;
