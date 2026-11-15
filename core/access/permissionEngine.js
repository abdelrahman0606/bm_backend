const {
  RESOURCE_TYPES,
  PERMISSION_ACTIONS,
  ALL_ENTITIES,
} = require("./permissionModel");

/**
 * The server-side permission engine.
 *
 * It answers the same questions as the Flutter engine
 * (lib/app/domain/access/permission_engine.dart) and by the same rules, but it
 * is the one that decides. The client's checks only shape what a user is
 * offered; nothing here trusts a role, a company id or a permission list that
 * arrived in a request.
 *
 * Every answer is fail-closed: no actor, no role, an unparsable grant or an
 * unknown action all read as "no".
 */

/**
 * The roles that form a chain of seniority, most senior first.
 *
 * `trainer` is deliberately absent: it sits outside the chain and inherits
 * nothing, because the business rule for where it belongs was never stated.
 */
const ROLE_CHAIN = [
  "master",
  "admin",
  "manager",
  "supervisor",
  "departmentHead",
  "senior",
  "midLevel",
  "junior",
];

const MASTER = "master";

/** Whether `role` is at least as senior as `minimum`. */
const isAtLeast = (role, minimum) => {
  if (!role) return false;
  // Master outranks everybody, including roles off the chain.
  if (role === MASTER) return true;
  if (role === minimum) return true;
  const roleRank = ROLE_CHAIN.indexOf(role);
  const minimumRank = ROLE_CHAIN.indexOf(minimum);
  if (roleRank < 0 || minimumRank < 0) return false;
  return roleRank <= minimumRank;
};

/** Whether `role` may hand out or assign `target` — strictly more senior. */
const canManageRole = (role, target) => {
  if (!role) return false;
  if (role === MASTER) return true;
  if (role === target) return false;
  const roleRank = ROLE_CHAIN.indexOf(role);
  const targetRank = ROLE_CHAIN.indexOf(target);
  if (roleRank < 0 || targetRank < 0) return false;
  return roleRank < targetRank;
};

/**
 * An actor the engine can reason about: the authenticated user's own role and
 * stored grants, loaded from the database — never from the request.
 */
class Actor {
  constructor({ id, role, permissions } = {}) {
    this.id = id || null;
    this.role = typeof role === "string" && role.trim() ? role.trim() : null;
    this.permissions = Array.isArray(permissions) ? permissions : [];
  }

  /** An actor standing for "nobody is signed in": refused everything. */
  static anonymous() {
    return new Actor({ id: null, role: null, permissions: [] });
  }

  get isAuthenticated() {
    return Boolean(this.id);
  }

  get isMaster() {
    return this.isAuthenticated && this.role === MASTER;
  }
}

const _normalize = (value) =>
  typeof value === "string" ? value.trim() : "";

/** The grants that name `resource`, ignoring anything malformed. */
const _matching = (actor, resource) => {
  if (!RESOURCE_TYPES.includes(resource)) return [];
  return actor.permissions.filter((permission) => {
    if (!permission || typeof permission !== "object") return false;
    return _normalize(permission.resourceType) === resource;
  });
};

const _idOf = (permission) => _normalize(permission.resourceId);

/**
 * Whether a grant covers every entity of its type.
 *
 * An empty id is treated as all-entities for the same reason the Flutter
 * engine does: a grant with no entity was only ever stored type-wide.
 */
const _isAllScope = (permission) => {
  const id = _idOf(permission);
  return id === ALL_ENTITIES || id === "";
};

/** Whether a grant permits `action`. `fullAccess` implies the rest. */
const _grantsAction = (permission, action) => {
  if (!PERMISSION_ACTIONS.includes(action)) return false;
  const actions = Array.isArray(permission.actions) ? permission.actions : [];
  const normalized = actions.map(_normalize);
  return normalized.includes(action) || normalized.includes("fullAccess");
};

/** Whether the actor may do `action` to the one entity `entityId`. */
const can = (actor, resource, action, entityId) => {
  if (!actor || !actor.isAuthenticated) return false;
  if (actor.isMaster) return true;
  const id = _normalize(entityId);
  // An action on no particular entity is refused, never waved through.
  if (!id) return false;
  return _matching(actor, resource).some(
    (permission) =>
      _grantsAction(permission, action) &&
      (_isAllScope(permission) || _idOf(permission) === id)
  );
};

/** Whether the actor may do `action` to at least one entity of `resource`. */
const canAny = (actor, resource, action) => {
  if (!actor || !actor.isAuthenticated) return false;
  if (actor.isMaster) return true;
  return _matching(actor, resource).some((permission) =>
    _grantsAction(permission, action)
  );
};

/** Whether the actor may do `action` to *every* entity of `resource`. */
const canAll = (actor, resource, action) => {
  if (!actor || !actor.isAuthenticated) return false;
  if (actor.isMaster) return true;
  return _matching(actor, resource).some(
    (permission) => _isAllScope(permission) && _grantsAction(permission, action)
  );
};

/**
 * The entity ids the actor may reach, or `null` for "no restriction".
 *
 * `null` means unrestricted; an array — including an empty one — is a limit.
 * The asymmetry is the point: an actor with no grants gets `[]`, which must
 * narrow a query to nothing, never widen it to everything.
 */
const visibleEntityIds = (actor, resource, action) => {
  // The session is checked before the master short-circuit, so a request
  // without a verified user never reads as "no restriction".
  if (!actor || !actor.isAuthenticated) return [];
  if (actor.isMaster) return null;
  if (canAll(actor, resource, action)) return null;
  const ids = _matching(actor, resource)
    .filter((permission) => _grantsAction(permission, action))
    .map(_idOf)
    .filter((id) => id !== "" && id !== ALL_ENTITIES);
  return [...new Set(ids)];
};

/**
 * A Mongo filter fragment restricting a query to what the actor may reach.
 *
 * Returns `{}` when the actor is unrestricted, so it can always be spread
 * into a filter. `field` defaults to `_id`.
 */
const scopeFilter = (actor, resource, action, { field = "_id" } = {}) => {
  const ids = visibleEntityIds(actor, resource, action);
  if (ids === null) return {};
  return { [field]: { $in: ids } };
};

/**
 * Whether the actor may hand out `permission` to somebody else.
 *
 * A user may never grant access they do not hold themselves: an all-entities
 * grant may only be given by someone who holds the whole type, and a grant on
 * one entity only by someone who holds that entity. Every action in the grant
 * is checked, so a viewer cannot hand out `delete`.
 */
const canGrant = (actor, permission) => {
  if (!actor || !actor.isAuthenticated) return false;
  if (actor.isMaster) return true;
  if (!permission || typeof permission !== "object") return false;

  const resource = _normalize(permission.resourceType);
  if (!RESOURCE_TYPES.includes(resource)) return false;

  const actions = Array.isArray(permission.actions) ? permission.actions : [];
  // A grant that carries no action grants nothing, and is not a way in.
  if (actions.length === 0) return false;
  if (actions.some((action) => !PERMISSION_ACTIONS.includes(_normalize(action)))) {
    return false;
  }

  const id = _idOf(permission);
  const allScope = id === ALL_ENTITIES || id === "";

  return actions.every((action) =>
    allScope
      ? canAll(actor, resource, _normalize(action))
      : can(actor, resource, _normalize(action), id)
  );
};

/**
 * Whether the actor may create or promote somebody into `role`.
 *
 * Strictly more senior only, so nobody can clone or exceed their own level.
 */
const canAssignRole = (actor, role) => {
  if (!actor || !actor.isAuthenticated) return false;
  if (actor.isMaster) return true;
  return canManageRole(actor.role, _normalize(role));
};

module.exports = {
  Actor,
  ROLE_CHAIN,
  MASTER,
  ALL_ENTITIES,
  isAtLeast,
  canManageRole,
  canGrant,
  canAssignRole,
  can,
  canAny,
  canAll,
  visibleEntityIds,
  scopeFilter,
};
