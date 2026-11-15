const mongoose = require("mongoose");
const {
  localMongoConnection,
} = require("../../infrastructure/database/database.manager");

const scheduleSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["hourly", "daily", "weekly", "monthly"],
      default: "daily",
    },
    // For hourly schedules these two describe the interval between runs,
    // for the other types the local time of day the run happens at.
    hour: {
      type: Number,
      min: 0,
      max: 23,
      default: 0,
    },
    minute: {
      type: Number,
      min: 0,
      max: 59,
      default: 0,
    },
    // 1 = Saturday … 7 = Friday, matching the client week order.
    dayOfWeek: {
      type: Number,
      min: 1,
      max: 7,
      default: 1,
    },
    dayOfMonth: {
      type: Number,
      min: 1,
      max: 31,
      default: 1,
    },
    // Offset of the owner's local time from UTC, in minutes, so a "daily at
    // 09:00" schedule fires at 09:00 for the user who configured it.
    timezoneOffsetMinutes: {
      type: Number,
      min: -840,
      max: 840,
      default: 0,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const timeManagementShareSchema = new mongoose.Schema(
  {
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
    // Who the saved configuration is shared with:
    //  * personal — the owner only (recipient is the owner himself)
    //  * company  — bound to `companyId`, readable by authorized members
    //  * person   — one other user, who must accept the request first
    shareScope: {
      type: String,
      enum: ["personal", "company", "person"],
      default: "person",
    },
    companyId: {
      type: String,
      default: null,
    },
    // Manual: the owner triggers each delivery. Automatic: the backend
    // scheduler delivers on `schedule`.
    shareMode: {
      type: String,
      enum: ["manual", "automatic"],
      default: "manual",
    },
    schedule: {
      type: scheduleSchema,
      default: null,
    },
    // Next scheduled delivery (UTC). Null whenever the configuration is not
    // eligible: manual mode, disabled schedule, or an inactive relationship.
    nextRunAt: {
      type: Date,
      default: null,
    },
    lastRunAt: {
      type: Date,
      default: null,
    },
    // Occurrence currently claimed by a scheduler worker, used to keep two
    // workers from delivering the same occurrence.
    lockedAt: {
      type: Date,
      default: null,
    },
    filterId: {
      type: String,
      required: true,
    },
    filterName: {
      type: String,
      required: true,
      trim: true,
    },
    filterDefinition: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
      validate: {
        validator: (v) => v !== null && v !== undefined && typeof v === "object",
        message: "filterDefinition is required and must be an object",
      },
    },
    schemaVersion: {
      type: Number,
      default: 1,
    },
    scops: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    invitationLink: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "rejected",
        "revoked",
        "disconnected",
        "cancelled",
      ],
      default: "pending",
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    disconnectedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
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
  }
);

// Indexes for common queries
timeManagementShareSchema.index({ senderUserId: 1 });
timeManagementShareSchema.index({ recipientUserId: 1 });
timeManagementShareSchema.index({ senderUserId: 1, recipientUserId: 1, filterId: 1 });
timeManagementShareSchema.index({ status: 1 });
timeManagementShareSchema.index({ createdAt: -1 });
timeManagementShareSchema.index({ companyId: 1, status: 1 });
// Drives the scheduler's "what is due now" query.
timeManagementShareSchema.index({ shareMode: 1, status: 1, nextRunAt: 1 });

/**
 * Registers the model on the local MongoDB connection.
 *
 * Time Management data lives in local MongoDB, never in Atlas, so the model is
 * bound to `localMongoConnection` instead of `mongoose.model(...)` — which
 * would bind it to Mongoose's default (Atlas) connection. The `models` guard
 * keeps a repeated require or a module reload from recompiling the model.
 */
function createTimeManagementShareModel(connection = localMongoConnection) {
  return (
    connection.models.TimeManagementShare ||
    connection.model("TimeManagementShare", timeManagementShareSchema)
  );
}

module.exports = createTimeManagementShareModel();
module.exports.createTimeManagementShareModel = createTimeManagementShareModel;
