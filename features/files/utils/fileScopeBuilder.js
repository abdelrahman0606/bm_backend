const ApiError = require("../../../utils/apiError");

/**
 * Builds the hierarchical scope for a given entity type and ID.
 * The scope always contains the complete hierarchy from the root down to the direct entity.
 */
const buildFileScope = async (entityType, entityId) => {
  const scope = {};
  
  if (!entityType || !entityId) {
    return scope;
  }

  // Ensure entityType is consistent
  const type = entityType.toString();
  scope[type] = entityId.toString();

  try {
    if (type === "company") {
      // Root level, nothing else to fetch
      return scope;
    }
    
    if (type === "project") {
      const ProjectModel = require("../../tasks_management/projects/projectModel");
      const project = await ProjectModel.findById(entityId).lean();
      if (!project) throw new ApiError("Project not found", 404);
      
      if (project.companyId) scope.company = project.companyId.toString();
      return scope;
    }
    
    if (type === "issue" || type === "subTask") {
      const IssueModel = require("../../tasks_management/issues/issueModel");
      const issue = await IssueModel.findById(entityId).lean();
      if (!issue) throw new ApiError("Issue not found", 404);
      
      if (issue.companyId) scope.company = issue.companyId.toString();
      if (issue.projectId) scope.project = issue.projectId.toString();
      if (issue.sprintId) scope.sprint = issue.sprintId.toString();
      if (issue.milestoneId) scope.milestone = issue.milestoneId.toString();
      
      // If it has a parentId, the current entity might be a subTask
      if (issue.parentId && type === "subTask") {
        scope.issue = issue.parentId.toString();
      } else if (issue.parentId && type === "issue") {
        scope.parentIssue = issue.parentId.toString();
      }

      return scope;
    }
    
    if (type === "comment") {
      const CommentModel = require("../../tasks_management/comments/commentModel");
      const comment = await CommentModel.findById(entityId).lean();
      if (!comment) throw new ApiError("Comment not found", 404);
      
      if (comment.companyId) scope.company = comment.companyId.toString();
      if (comment.projectId) scope.project = comment.projectId.toString();
      if (comment.issueId) scope.issue = comment.issueId.toString();
      
      return scope;
    }

    if (type === "sprint") {
      const SprintModel = require("../../tasks_management/models/sprintModel");
      const sprint = await SprintModel.findById(entityId).lean();
      if (!sprint) throw new ApiError("Sprint not found", 404);
      
      if (sprint.companyId) scope.company = sprint.companyId.toString();
      if (sprint.projectId) scope.project = sprint.projectId.toString();
      
      return scope;
    }

    // Default fallback if we don't know how to resolve the hierarchy yet.
    return scope;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(`Failed to build file scope: ${err.message}`, 500);
  }
};

module.exports = { buildFileScope };
