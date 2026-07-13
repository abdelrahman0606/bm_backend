const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");

/**
 * Project Configuration
 *
 * Stored in its own `project_configurations` collection.
 * Each project has exactly one configuration document (1:1 relationship).
 * Settings use a flexible Mixed type so future feature flags can be added
 * without schema migrations.
 */
const ProjectConfigurationSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskProject",
      required: true,
      unique: true,
    },

    /**
     * Feature flags — all optional, default to false unless noted.
     * Add new feature flags here without altering the model.
     */
    settings: {
      timeTracking: {
        enabled: { type: Boolean, default: false },
      },
      ai: {
        enabled: { type: Boolean, default: false },
      },
      watchers: {
        enabled: { type: Boolean, default: true },
      },
      components: {
        enabled: { type: Boolean, default: false },
      },
      versions: {
        enabled: { type: Boolean, default: false },
      },
      sprints: {
        enabled: { type: Boolean, default: false },
      },
      activityLogs: {
        enabled: { type: Boolean, default: true },
      },
      notifications: {
        enabled: { type: Boolean, default: true },
      },
      guestAccess: {
        enabled: { type: Boolean, default: false },
      },
      fileUploads: {
        enabled: { type: Boolean, default: true },
      },
      comments: {
        enabled: { type: Boolean, default: true },
      },
      automation: {
        enabled: { type: Boolean, default: false },
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    collection: "project_configurations",
  }
);

ProjectConfigurationSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

ProjectConfigurationSchema.set("versionKey", false);

// Unique index — one config per project
ProjectConfigurationSchema.index({ projectId: 1 }, { unique: true });

const ProjectConfigurationModel = tasksDb.model(
  "TaskProjectConfiguration",
  ProjectConfigurationSchema
);
module.exports = ProjectConfigurationModel;
