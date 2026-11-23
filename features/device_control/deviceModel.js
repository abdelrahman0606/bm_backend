const mongoose = require("mongoose");

const {
  DEVICE_PLATFORMS,
  DEVICE_STATUSES,
} = require("./deviceControlConstants");

/**
 * One enrolled machine.
 *
 * The device is an authentication principal in its own right: it holds a
 * secret of its own and talks to the API whether or not its owner is signed
 * in anywhere. That is the whole point — enforcement has to continue when the
 * Flutter app is closed.
 *
 * `appliedPolicyVersion` is written only from an enforcement report, never
 * when a policy is assigned. An assignment states an intention; only the
 * agent can say what the operating system actually accepted.
 */
const deviceSchema = new mongoose.Schema(
  {
    companyId: {
      type: String,
      required: true,
      index: true,
    },

    /** The user this device belongs to. Administrators enroll their own too. */
    employeeId: {
      type: String,
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    platform: {
      type: String,
      required: true,
      enum: DEVICE_PLATFORMS,
    },

    osVersion: { type: String, default: "", trim: true },
    agentVersion: { type: String, default: "", trim: true },

    status: {
      type: String,
      required: true,
      default: "pending",
      enum: DEVICE_STATUSES,
    },

    /**
     * bcrypt hash of the secret handed out once at enrollment.
     *
     * `select: false` so the hash never rides along in an ordinary read and
     * cannot be returned to a console client by accident.
     */
    secretHash: {
      type: String,
      default: null,
      select: false,
    },

    /**
     * Rotated on every re-enrollment, and compared on token issue.
     *
     * Without it, a secret captured before a re-enrollment would keep working
     * against the new record.
     */
    credentialVersion: { type: Number, default: 0 },

    enrolledAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },

    assignedPolicyId: { type: String, default: null },

    /** Confirmed by the agent, not by the assignment. Zero means nothing applied. */
    appliedPolicyVersion: { type: Number, default: 0 },

    /**
     * The id Time Management already uses for this machine.
     *
     * Time Management identifies a device by a UUID it generates and caches
     * locally; Device Control identifies it by this record. They are different
     * values for one PC, so the agent reports the former at enrollment and it
     * is stored here. Without it the device detail page cannot show that
     * machine's usage.
     */
    timeManagementDeviceId: { type: String, default: null, index: true },

    /** Free-form facts the agent reports: machine name, edition, build. */
    systemInfo: { type: mongoose.Schema.Types.Mixed, default: {} },

    createdBy: { type: String, default: null },
  },
  { timestamps: true }
);

// The console lists a company's devices by status; this is that query.
deviceSchema.index({ companyId: 1, status: 1 });
// An employee opening their own page asks for exactly this.
deviceSchema.index({ companyId: 1, employeeId: 1 });

module.exports = mongoose.model("DeviceControlDevice", deviceSchema);
