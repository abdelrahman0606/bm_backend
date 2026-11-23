const mongoose = require("mongoose");

const {
  CONTROL_KEYS,
  ENFORCEMENT_STATUSES,
} = require("./deviceControlConstants");

/** What the agent managed to do with one control section. */
const controlResultSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, enum: CONTROL_KEYS },
    status: { type: String, required: true, enum: ENFORCEMENT_STATUSES },
    /** Why, when it is not `applied`. Shown verbatim in the console. */
    message: { type: String, default: "", trim: true },
    /** Set only on `applied`, so "when did this actually take" is answerable. */
    appliedAt: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * One agent's account of applying one policy version.
 *
 * This collection is the only thing that may mark a policy applied. The
 * console reads enforcement state from the newest report for a device, not
 * from its assignment, because an assignment is a wish and a report is
 * evidence. A device that never reports stays visibly unenforced.
 *
 * Reports are kept rather than overwritten: the history is what shows a
 * control that applied on Monday and failed on Tuesday.
 */
const enforcementReportSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },
    deviceId: { type: String, required: true, index: true },

    policyId: { type: String, default: null },
    policyVersion: { type: Number, required: true },

    controls: { type: [controlResultSchema], default: [] },

    agentVersion: { type: String, default: "", trim: true },
    osVersion: { type: String, default: "", trim: true },

    reportedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

enforcementReportSchema.index({ deviceId: 1, reportedAt: -1 });

/**
 * The single status for a whole report.
 *
 * Deliberately pessimistic: anything short of every control applying is not
 * "applied". `unsupported` does not count as success, because a console that
 * shows green for a control the machine cannot enforce is worse than one that
 * shows nothing.
 */
enforcementReportSchema.methods.overallStatus = function overallStatus() {
  const statuses = (this.controls || []).map((control) => control.status);
  if (statuses.length === 0) return "pending";
  if (statuses.every((status) => status === "applied")) return "applied";
  if (statuses.some((status) => status === "failed")) return "failed";
  if (statuses.some((status) => status === "applied")) return "partial";
  if (statuses.every((status) => status === "unsupported")) return "unsupported";
  return "pending";
};

module.exports = mongoose.model(
  "DeviceControlEnforcementReport",
  enforcementReportSchema
);
