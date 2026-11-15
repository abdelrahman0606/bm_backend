const mongoose = require("mongoose");
const {
  localMongoConnection,
} = require("../../infrastructure/database/database.manager");

/**
 * One device's contribution of application usage for one application and one
 * local day.
 *
 * This is the per-device half of multi-device aggregation: the document holds
 * the **cumulative total that this device recorded**, not a running cloud
 * total. A device replaces its own contribution with every snapshot, so
 * re-sending the same snapshot — or a snapshot the backend already applied —
 * can never increase the aggregate. Totals across devices are produced by
 * summing contributions at read time.
 *
 * `revision` is the device's monotonic local change sequence for the record. A
 * snapshot is only applied when it carries a higher revision than the stored
 * one, which makes a late or out-of-order retry a no-op instead of a
 * regression. Timestamps are not used for this: several changes can land in
 * the same millisecond and device clocks differ.
 */
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

const timeManagementDeviceUsageSchema = new mongoose.Schema(
  {
    // Taken from the verified auth context, never from the request body.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Stable per installation, generated and persisted by the client.
    deviceId: {
      type: String,
      required: true,
      trim: true,
    },
    deviceName: {
      type: String,
      default: null,
      trim: true,
    },
    platform: {
      type: String,
      default: null,
      trim: true,
    },
    // The client's own identity for the record: the application name exactly
    // as that device recorded it. One client record maps to exactly one
    // document, which is what keeps acknowledgements and retries unambiguous.
    appKey: {
      type: String,
      required: true,
      trim: true,
    },
    // Aggregation identity, normalized server-side from `appName`, so the same
    // application reported as "Code.exe" and "code" from two devices is summed
    // under one application at read time. Not part of the document identity:
    // two devices (or two differently spelled local records) contribute two
    // documents that add up, instead of overwriting each other.
    appId: {
      type: String,
      required: true,
      trim: true,
    },
    // Original name, preserved for display.
    appName: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: String, // YYYY-MM-DD, the device's local day
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    // The device's offset when it recorded the day, so a report can explain a
    // timezone boundary instead of guessing.
    timezoneOffsetMinutes: {
      type: Number,
      min: -840,
      max: 840,
      default: 0,
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
    // True when the device had more window titles than one batch may carry.
    // `totalDuration` is still that device's exact total, so only the window
    // breakdown is partial — recorded rather than hidden.
    windowsTruncated: {
      type: Boolean,
      default: false,
    },
    // Device's local change sequence for this record; -1 means "never synced".
    revision: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
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

// The document identity: one row per user, device, local record and day. Unique,
// so two devices can never overwrite each other's contribution and one device
// can never hold two rows for the same record and day.
timeManagementDeviceUsageSchema.index(
  { userId: 1, deviceId: 1, appKey: 1, date: 1 },
  { unique: true }
);
// Report over a date range, across every device of the user.
timeManagementDeviceUsageSchema.index({ userId: 1, date: 1 });
// Usage of one application over time, by its aggregation identity.
timeManagementDeviceUsageSchema.index({ userId: 1, appId: 1, date: 1 });

/** Registered on local MongoDB — see `timeManagementShareModel.js`. */
function createTimeManagementDeviceUsageModel(
  connection = localMongoConnection
) {
  return (
    connection.models.TimeManagementDeviceUsage ||
    connection.model(
      "TimeManagementDeviceUsage",
      timeManagementDeviceUsageSchema
    )
  );
}

module.exports = createTimeManagementDeviceUsageModel();
module.exports.createTimeManagementDeviceUsageModel =
  createTimeManagementDeviceUsageModel;
