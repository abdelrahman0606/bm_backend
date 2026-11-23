const mongoose = require("mongoose");

const { POLICY_MODES } = require("./deviceControlConstants");

/**
 * One application rule.
 *
 * `kind` matters more than it looks. A rule by `path` is trivially defeated by
 * renaming or copying the executable, so it is offered for convenience and
 * reported as the weak option it is; `publisher` and `hash` are what App
 * Control can actually hold a machine to.
 */
const applicationRuleSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, enum: ["path", "publisher", "hash"] },
    value: { type: String, required: true, trim: true },
    label: { type: String, default: "", trim: true },
  },
  { _id: false }
);

/** One website rule: a bare domain, matched with or without its subdomains. */
const websiteRuleSchema = new mongoose.Schema(
  {
    domain: { type: String, required: true, trim: true, lowercase: true },
    includeSubdomains: { type: Boolean, default: true },
    label: { type: String, default: "", trim: true },
  },
  { _id: false }
);

/**
 * A reusable policy: five independent sections an administrator edits
 * together and the agent applies separately.
 *
 * `version` is bumped on every content change and is what the agent compares
 * against. It never goes backwards, so an older signed policy replayed at a
 * device is refused by the agent rather than quietly re-applied.
 */
const devicePolicySchema = new mongoose.Schema(
  {
    companyId: { type: String, required: true, index: true },

    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },

    version: { type: Number, required: true, default: 1 },

    applicationControl: {
      enabled: { type: Boolean, default: false },
      mode: { type: String, enum: POLICY_MODES, default: "blacklist" },
      /**
       * In whitelist mode these are the only applications allowed; in
       * blacklist mode they are the ones refused. One list, one mode: the
       * two can never both be live, which is what makes the policy
       * explainable to the person it restricts.
       */
      rules: { type: [applicationRuleSchema], default: [] },
    },

    websiteControl: {
      enabled: { type: Boolean, default: false },
      mode: { type: String, enum: POLICY_MODES, default: "blacklist" },
      rules: { type: [websiteRuleSchema], default: [] },
      /**
       * Secure DNS lets a browser resolve names past any local filter, so an
       * agent that relies on DNS must also turn it off. Kept as policy data
       * rather than an agent default: on a machine where website control is
       * off, there is no reason to touch the user's DNS settings.
       */
      disableSecureDns: { type: Boolean, default: true },
    },

    fileTransferControl: {
      enabled: { type: Boolean, default: false },
      blockDownloads: { type: Boolean, default: false },
      blockUploads: { type: Boolean, default: false },
      /** Domains the rules above apply to; empty means every site. */
      domains: { type: [String], default: [] },
    },

    usbControl: {
      enabled: { type: Boolean, default: false },
      blockStorage: { type: Boolean, default: false },
      denyRead: { type: Boolean, default: false },
      denyWrite: { type: Boolean, default: false },
      /** Windows device instance IDs allowed through despite the above. */
      approvedDeviceIds: { type: [String], default: [] },
    },

    systemRestrictions: {
      enabled: { type: Boolean, default: false },
      blockInstallers: { type: Boolean, default: false },
      blockAdminTools: { type: Boolean, default: false },
      restrictedPaths: { type: [String], default: [] },
    },

    createdBy: { type: String, required: true },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true }
);

devicePolicySchema.index({ companyId: 1, name: 1 });

module.exports = mongoose.model("DeviceControlPolicy", devicePolicySchema);
