const mongoose = require("mongoose");

const { REQUEST_CATEGORIES } = require("./deviceControlConstants");

/**
 * A narrow, expiring hole in an otherwise unchanged policy.
 *
 * An approval never edits the policy, because a policy is shared and an
 * approval is not: letting one person's request rewrite the rule everyone
 * else is under is how an approval workflow quietly becomes a privilege
 * escalation. So an approval writes one of these instead — one category, one
 * resource, one device, with an end date.
 *
 * An exception can only widen the category it names. Nothing here can relax a
 * different control.
 */
const policyExceptionSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },

    /** Pinned to one device. An exception is never company-wide. */
    deviceId: { type: String, required: true, index: true },

    category: { type: String, required: true, enum: REQUEST_CATEGORIES },

    /** The one application, domain or path this exception covers. */
    resource: { type: String, required: true, trim: true },

    grantedBy: { type: String, required: true },
    requestId: { type: String, default: null },

    /** Null means it stands until revoked; a date means it lapses on its own. */
    expiresAt: { type: Date, default: null },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: String, default: null },
  },
  { timestamps: true }
);

policyExceptionSchema.index({ companyId: 1, deviceId: 1, revokedAt: 1 });

/** Whether this exception counts right now. */
policyExceptionSchema.methods.isLive = function isLive(now = new Date()) {
  if (this.revokedAt) return false;
  if (this.expiresAt && this.expiresAt <= now) return false;
  return true;
};

module.exports = mongoose.model(
  "DeviceControlPolicyException",
  policyExceptionSchema
);
