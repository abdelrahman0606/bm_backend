const ApiError = require("../../utils/apiError");
const engine = require("./permissionEngine");
const { scopeEnforced } = require("./accessConfig");

/**
 * The ceiling on what a user write may contain.
 *
 * Two different questions live here and they are enforced differently:
 *
 *  - *Scope* — may this actor touch this member at all? Staged behind
 *    `ACCESS_ENFORCE`, because no account carries grants yet.
 *  - *Escalation* — may this actor hand out this role or these permissions?
 *    Always enforced. It can only ever refuse an attempt to rise above the
 *    actor's own level, so it cannot interfere with ordinary work, and it is
 *    the check that makes the stored role and permission list trustworthy.
 *
 * Both are judged against what is *changing*. The client sends a whole user
 * object on every edit, so re-sending a role or a grant that is already
 * stored is not an escalation attempt and must not be refused — otherwise a
 * manager could not correct a colleague's phone number without also being
 * entitled to every grant that colleague already holds.
 */

/** The grant shape, normalized so two of them can be compared. */
const _grantKey = (permission) => {
  if (!permission || typeof permission !== "object") return "";
  const type = String(permission.resourceType ?? "").trim();
  const id = String(permission.resourceId ?? "").trim();
  const actions = (Array.isArray(permission.actions) ? permission.actions : [])
    .map((action) => String(action ?? "").trim())
    .filter(Boolean)
    .sort();
  // resourceName is a label, not authority, so it is left out of the key.
  return `${type}|${id}|${actions.join(",")}`;
};

const _grantKeys = (permissions) =>
  new Set((Array.isArray(permissions) ? permissions : []).map(_grantKey));

/**
 * Refuses a write that would raise the target above what the actor may give.
 *
 * `current` is the stored user being edited, or null for a create. Returns
 * the payload to persist, with fields the actor may not set removed.
 */
const sanitizeUserWrite = (actor, payload = {}, { current = null } = {}) => {
  if (!actor || !actor.isAuthenticated) {
    throw new ApiError("Authentication required", 401);
  }

  const next = { ...payload };
  const currentRole = current ? String(current.role ?? "").trim() : null;
  const currentGrantKeys = _grantKeys(current ? current.permissions : []);

  // A role is only ever accepted from someone who may assign it. A role that
  // is already stored is being re-sent, not granted.
  if (next.role !== undefined && next.role !== null) {
    const requested = String(next.role).trim();
    const unchanged = currentRole !== null && requested === currentRole;
    if (!unchanged && !engine.canAssignRole(actor, requested)) {
      throw new ApiError(`You may not assign the role "${requested}"`, 403);
    }
  }

  // Permissions are only ever accepted from someone who holds them. This is
  // what stops a user rewriting their own grants: an actor with no grants
  // satisfies canGrant for nothing, so they can only re-send what is stored.
  if (next.permissions !== undefined && next.permissions !== null) {
    if (!Array.isArray(next.permissions)) {
      throw new ApiError("permissions must be a list", 400);
    }
    const added = next.permissions.filter(
      (permission) => !currentGrantKeys.has(_grantKey(permission))
    );
    const beyond = added.filter(
      (permission) => !engine.canGrant(actor, permission)
    );
    if (beyond.length > 0) {
      throw new ApiError(
        "You may only grant access that you hold yourself",
        403
      );
    }
  }

  // The legacy `access` string list is the old, unvalidated form of the same
  // thing. Nobody but master may set it, so it cannot be a side door around
  // the checks above.
  if ("access" in next && !actor.isMaster) {
    delete next.access;
  }

  return next;
};

/**
 * Whether the actor may write to the member `targetId` at all.
 *
 * Editing yourself is always allowed — the privileged fields are handled by
 * [sanitizeUserWrite], so this governs the profile, not the authority.
 * Editing somebody else needs the grant, once scope enforcement is on.
 */
const assertMemberWriteAllowed = (actor, targetId, action = "update") => {
  if (!actor || !actor.isAuthenticated) {
    throw new ApiError("Authentication required", 401);
  }
  if (targetId !== null && String(targetId) === String(actor.id)) return;
  if (!scopeEnforced()) return;
  if (!engine.can(actor, "member", action, targetId)) {
    throw new ApiError(`You do not have ${action} access to this member`, 403);
  }
};

module.exports = {
  sanitizeUserWrite,
  assertMemberWriteAllowed,
  _grantKey,
};
