const ProjectVisibility = {
  PUBLIC: "public",
  PRIVATE: "private",
  WORKSPACE: "workspace",
};

const ProjectStatus = {
  PLANNED: "planned",
  ACTIVE: "active",
  ON_HOLD: "on_hold",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const ProjectMemberRole = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  VIEWER: "viewer",
  GUEST: "guest",
};

const ProjectType = {
  SCRUM: "scrum",
  KANBAN: "kanban",
  BUG_TRACKING: "bugTracking",
  TASK_MANAGEMENT: "taskManagement",
  SOFTWARE_DEVELOPMENT: "softwareDevelopment",
  MARKETING: "marketing",
  DESIGN: "design",
  HR: "hr",
  OPERATIONS: "operations",
  SALES: "sales",
  CUSTOM: "custom",
};

module.exports = {
  ProjectVisibility,
  ProjectStatus,
  ProjectMemberRole,
  ProjectType,
};
