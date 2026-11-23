const mongoose = require("mongoose");

/**
 * Which policy applies to whom.
 *
 * Three scopes, resolved most specific first: a policy pinned to one device
 * beats one given to that employee, which beats the company default. Ties
 * inside a scope are broken by `priority`, highest first, so an administrator
 * can layer a temporary policy over a standing one without deleting it.
 */
const policyAssignmentSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },
    policyId: { type: String, required: true, index: true },

    scope: {
      type: String,
      required: true,
      enum: ["device", "employee", "company"],
    },

    /** The device or employee id; null for a company-wide assignment. */
    scopeId: { type: String, default: null },

    priority: { type: Number, default: 0 },

    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

policyAssignmentSchema.index({ companyId: 1, scope: 1, scopeId: 1 });

module.exports = mongoose.model(
  "DeviceControlPolicyAssignment",
  policyAssignmentSchema
);
