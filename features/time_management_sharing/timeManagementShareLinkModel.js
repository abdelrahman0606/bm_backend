const mongoose = require("mongoose");

/**
 * A bearer link that exposes one time-usage report read-only.
 *
 * The token itself is never stored: only its SHA-256 hash, so a dump of this
 * collection cannot be replayed as working links. The link carries its own copy
 * of the report scope (owner, filter, date range) so possession of a share or
 * configuration id is never, on its own, authorization to read a report.
 */
const timeManagementShareLinkSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Configuration the link was generated from (for revocation and listing).
    shareId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimeManagementShare",
      required: true,
    },
    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Exactly what the link may show.
    filterId: {
      type: String,
      required: true,
    },
    reportTitle: {
      type: String,
      default: "Time report",
    },
    dateFrom: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    dateTo: {
      type: String, // YYYY-MM-DD
      required: true,
    },
    // Window titles can carry document names and other private details, so a
    // link only exposes them when the owner opted in.
    includeWindows: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    viewCount: {
      type: Number,
      default: 0,
    },
    lastViewedAt: {
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
        // Never hand the hash back to a client.
        delete ret.tokenHash;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.tokenHash;
        return ret;
      },
    },
  }
);

timeManagementShareLinkSchema.index({ shareId: 1, createdAt: -1 });
timeManagementShareLinkSchema.index({ ownerUserId: 1, createdAt: -1 });

timeManagementShareLinkSchema.virtual("isActive").get(function isActive() {
  return !this.revokedAt && this.expiresAt > new Date();
});

module.exports = mongoose.model(
  "TimeManagementShareLink",
  timeManagementShareLinkSchema
);
