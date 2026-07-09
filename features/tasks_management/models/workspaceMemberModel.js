const mongoose = require("mongoose");
const tasksDb = require("../tasksDatabase");


const WorkspaceMemberRole = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

const WorkspaceMemberSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "TaskWorkspace", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: {
      type: String,
      enum: Object.values(WorkspaceMemberRole),
      default: WorkspaceMemberRole.MEMBER,
      required: true,
    },
    joinedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

WorkspaceMemberSchema.virtual("id").get(function () {
  return this._id.toHexString();
});

WorkspaceMemberSchema.set("versionKey", false);

WorkspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
WorkspaceMemberSchema.index({ userId: 1 });

const WorkspaceMemberModel = tasksDb.model("TaskWorkspaceMember", WorkspaceMemberSchema);
module.exports = WorkspaceMemberModel;
