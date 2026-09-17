const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    type: {
      type: String,
      enum: ["online", "offline"],
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    address: {
      type: String,
      default: null,
    },
    qrSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AttendanceQrSession",
      default: null,
    },
    photoUrl: {
      type: String,
      default: null,
    },
    photo: {
      type: Object,
      default: null,
    },
    similarity: {
      type: Number,
      default: null,
    },
    deviceId: {
      type: String,
      default: null,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    verificationMethod: {
      type: String,
      enum: ["qr", "face", "location"],
      required: true,
    },
    similarityPercentage: {
      type: Number,
      default: null,
    },
    extra: {
      type: Object,
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

// Optional: ensure user can only have one attendance per day if that is the business rule.
// We'll enforce this mostly at the service level or with a unique index on userId + date.

module.exports = mongoose.model("Attendance", attendanceSchema);
