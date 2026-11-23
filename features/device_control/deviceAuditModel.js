const mongoose = require("mongoose");

const { ACTOR_KINDS, AUDIT_ACTIONS } = require("./deviceControlConstants");

/**
 * An append-only record of who changed what.
 *
 * Device Control decides what a person may run on their own machine, so every
 * change to that answer is written here before the caller is told it
 * succeeded. Nothing in the feature updates or deletes these rows.
 *
 * `before` and `after` hold only the fields that changed, not whole
 * documents: an audit trail that copies a policy wholesale on every edit
 * becomes unreadable by the time anyone needs it.
 */
const deviceAuditSchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },

    actorId: { type: String, default: null },
    actorKind: { type: String, required: true, enum: ACTOR_KINDS },

    action: { type: String, required: true, enum: AUDIT_ACTIONS },

    targetType: { type: String, required: true, trim: true },
    targetId: { type: String, required: true, trim: true },

    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },

    /** Free note for context a diff cannot carry, such as a decision reason. */
    note: { type: String, default: "", trim: true },

    at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: false }
);

deviceAuditSchema.index({ companyId: 1, at: -1 });
deviceAuditSchema.index({ companyId: 1, targetType: 1, targetId: 1, at: -1 });

module.exports = mongoose.model("DeviceControlAuditEvent", deviceAuditSchema);
