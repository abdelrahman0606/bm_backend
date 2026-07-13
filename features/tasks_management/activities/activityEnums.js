const ActivityEntityType = {
  PROJECT: "project",
  ISSUE: "issue",
  SPRINT: "sprint",
  COMMENT: "comment",
  ATTACHMENT: "attachment",
  MEMBER: "member",
  LABEL: "label",
  VERSION: "version",
  COMPONENT: "component",
  CHECKLIST: "checklist",
  TIMELOG: "timelog",
};

const ActivityAction = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  ARCHIVE: "archive",
  RESTORE: "restore",
  MOVE: "move",
  ASSIGN: "assign",
  UNASSIGN: "unassign",
  CHANGE_STATUS: "change_status",
  CHANGE_PRIORITY: "change_priority",
  ADD_MEMBER: "add_member",
  REMOVE_MEMBER: "remove_member",
  UPLOAD_FILE: "upload_file",
  REMOVE_FILE: "remove_file",
  CREATE_COMMENT: "create_comment",
  UPDATE_COMMENT: "update_comment",
  DELETE_COMMENT: "delete_comment",
};

module.exports = {
  ActivityEntityType,
  ActivityAction,
};
