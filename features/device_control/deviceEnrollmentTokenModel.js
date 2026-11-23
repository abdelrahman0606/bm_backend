const mongoose = require("mongoose");

/**
 * A one-time code that turns an unclaimed device record into an enrolled one.
 *
 * The token is the only moment the server trusts something that is not yet a
 * device, so it is deliberately weak in reach and short in life: it names the
 * company and the employee up front, it works once, and it expires. Anyone
 * replaying it after redemption gets nothing, because `usedAt` is set inside
 * the same update that claims it.
 *
 * Only the hash is stored. A leaked database therefore cannot be used to
 * enroll a device.
 */
const enrollmentTokenSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },
    employeeId: { type: String, required: true },

    /** Set when an administrator pre-creates the device record. */
    deviceId: { type: String, default: null },

    tokenHash: { type: String, required: true, unique: true },

    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    usedByDeviceId: { type: String, default: null },

    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

/**
 * Mongo removes the document once it expires.
 *
 * Expiry is already checked on redemption, so this is housekeeping rather
 * than a control: it stops unused codes accumulating for ever.
 */
enrollmentTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model(
  "DeviceControlEnrollmentToken",
  enrollmentTokenSchema
);
