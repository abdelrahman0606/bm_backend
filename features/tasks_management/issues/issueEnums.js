// ── Issue Enums ───────────────────────────────────────────────────────────────

/**
 * IssueType — every issue belongs to exactly one type.
 * Task is NOT a special entity; it is just one of the supported types.
 */
const IssueType = {
  TASK:        "task",
  BUG:         "bug",
  STORY:       "story",
  EPIC:        "epic",
  FEATURE:     "feature",
  IMPROVEMENT: "improvement",
  SUB_TASK:    "subTask",
};

/**
 * IssuePriority — a simple ordered enum stored directly on the issue.
 * Replaces the previous `priorityId` ObjectId reference.
 */
const IssuePriority = {
  LOWEST:   "lowest",
  LOW:      "low",
  MEDIUM:   "medium",
  HIGH:     "high",
  HIGHEST:  "highest",
  CRITICAL: "critical",
};

/**
 * IssueVisibility — controls who can see the issue.
 */
const IssueVisibility = {
  PUBLIC:  "public",
  PRIVATE: "private",
  TEAM:    "team",
};

module.exports = {
  IssueType,
  IssuePriority,
  IssueVisibility,
};
