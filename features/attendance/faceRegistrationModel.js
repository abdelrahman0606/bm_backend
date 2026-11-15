const mongoose = require("mongoose");

/**
 * Where a person's face registration stands for one company.
 *
 * There are four states the application cares about, and only three of them
 * are stored: `notRegistered` is the *absence* of a document. That is
 * deliberate — it means a user can never be left in a half-created record
 * that reads as registered, and "has this person applied?" is one lookup.
 *
 * The biometric data is not here. Enrollment lives on the face-recognition
 * service; this record holds the decision and a reference to the photo the
 * reviewer looked at. Keeping embeddings out of it means an approval queue,
 * a notification payload or a leaked log cannot carry biometrics.
 */
const FACE_REGISTRATION_STATUSES = ["pending", "approved", "rejected"];

/**
 * One decision in the record's history.
 *
 * Kept as an append-only list so a re-application after a rejection does not
 * erase why it was refused the first time.
 */
const decisionSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: FACE_REGISTRATION_STATUSES,
      required: true,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: {
      type: Date,
      default: Date.now,
    },
    reason: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { _id: false }
);

const faceRegistrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Always resolved on the server from the user's own relationships. A
    // company id that arrived in a request is never written here.
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    status: {
      type: String,
      enum: FACE_REGISTRATION_STATUSES,
      required: true,
      default: "pending",
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
      trim: true,
    },
    // The photo reference the reviewer sees — a file descriptor from the
    // upload service, never an embedding or raw image data.
    photo: {
      type: Object,
      default: null,
    },
    modelVersion: {
      type: String,
      default: null,
    },
    // How many times this person has applied. A rejection can be appealed by
    // applying again, and the count is what makes that visible.
    attempts: {
      type: Number,
      default: 1,
    },
    history: {
      type: [decisionSchema],
      default: [],
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

// One record per person per company: the state is a property of that pair,
// and the unique index is what makes a double submission impossible rather
// than merely unlikely.
faceRegistrationSchema.index({ userId: 1, companyId: 1 }, { unique: true });

// The approver queue reads by company and status.
faceRegistrationSchema.index({ companyId: 1, status: 1, requestedAt: -1 });

const FaceRegistration = mongoose.model(
  "FaceRegistration",
  faceRegistrationSchema
);

module.exports = FaceRegistration;
module.exports.FACE_REGISTRATION_STATUSES = FACE_REGISTRATION_STATUSES;
