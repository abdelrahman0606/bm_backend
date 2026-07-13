const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");
const { ProjectMemberRole } = require("./projectEnums");

/**
 * Project Member
 *
 * Stored in its own `project_members` collection.
 * Never embedded inside the Project document.
 * Aggregated/populated into the project response for frontend convenience.
 */
const ProjectMemberSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TaskProject",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    role: {
      type: String,
      enum: Object.values(ProjectMemberRole),
      default: ProjectMemberRole.MEMBER,
      required: true,
    },
    joinedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    collection: "project_members",
  }
);

ProjectMemberSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

ProjectMemberSchema.set("versionKey", false);

ProjectMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true });
ProjectMemberSchema.index({ userId: 1 });
ProjectMemberSchema.index({ projectId: 1 });

const ProjectMemberModel = tasksDb.model("TaskProjectMember", ProjectMemberSchema);
module.exports = ProjectMemberModel;
