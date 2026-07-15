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
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: Object.values(ProjectMemberRole),
      default: ProjectMemberRole.MEMBER,
      required: true,
    },
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    isStarred: {
      type: Boolean,
      default: false,
    },
    isMuted: {
      type: Boolean,
      default: false,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    lastSeenAt: {
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
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret) => {
        ret.id = ret._id;
        delete ret._id;
        return ret;
      },
    },
    collection: "project_members",
  }
);

ProjectMemberSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

ProjectMemberSchema.virtual("fullName").get(function () {
  return this.userId?.fullName;
});

ProjectMemberSchema.virtual("phone").get(function () {
  return this.userId?.phone;
});

ProjectMemberSchema.virtual("email").get(function () {
  return this.userId?.email;
});

ProjectMemberSchema.virtual("photo").get(function () {
  return this.userId?.photo;
});

ProjectMemberSchema.set("versionKey", false);

ProjectMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true });
ProjectMemberSchema.index({ userId: 1 });
ProjectMemberSchema.index({ projectId: 1 });

const ProjectMemberModel = tasksDb.model("TaskProjectMember", ProjectMemberSchema);
module.exports = ProjectMemberModel;
