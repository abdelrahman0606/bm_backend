const mongoose = require("mongoose");
const User = require("../../features/users/userModel");
const ApiError = require("../../utils/apiError");
const engine = require("./permissionEngine");

/**
 * Express glue for the permission engine.
 *
 * The actor is always loaded from the database by the id the verified token
 * carried. A role or permission list in the request body is ignored, so a
 * client that edits its own stored copy gains nothing.
 */

/**
 * Loads the authenticated user's role and grants onto `req.actor`.
 *
 * Runs after `verifyAuthToken`, caches for the request, and leaves an
 * anonymous actor behind when the user cannot be found — refused everything
 * rather than treated as unrestricted.
 */
const attachActor = async (req, res, next) => {
  try {
    if (req.actor) return next();

    if (!req.userId) {
      req.actor = engine.Actor.anonymous();
      return next();
    }

    const user = await User.findById(req.userId).select("role permissions");

    req.actor = user
      ? new engine.Actor({
          id: String(user._id),
          role: user.role,
          permissions: (user.permissions || []).map((permission) => ({
            resourceType: permission.resourceType,
            resourceId: permission.resourceId,
            resourceName: permission.resourceName,
            actions: [...(permission.actions || [])],
          })),
        })
      : engine.Actor.anonymous();

    return next();
  } catch (error) {
    return next(error);
  }
};

/** The actor for a request, or an anonymous one if nothing was attached. */
const actorOf = (req) => req.actor || engine.Actor.anonymous();

/**
 * Refuses a request whose actor may not do `action` to `resource`.
 *
 * With `entityIdFrom` the check is against that one entity, taken from the
 * route parameters or the body; without it, the actor need only reach some
 * entity of the type — the right question for a list or a create.
 */
const requirePermission = (resource, action, { entityIdFrom } = {}) =>
  async function permissionGate(req, res, next) {
    try {
      if (!req.actor) await new Promise((resolve) => attachActor(req, res, resolve));

      const actor = actorOf(req);

      if (!actor.isAuthenticated) {
        return next(new ApiError("Authentication required", 401));
      }

      if (entityIdFrom) {
        const entityId = req.params?.[entityIdFrom] ?? req.body?.[entityIdFrom];
        if (!engine.can(actor, resource, action, entityId)) {
          return next(
            new ApiError(`You do not have ${action} access to this ${resource}`, 403)
          );
        }
        return next();
      }

      if (!engine.canAny(actor, resource, action)) {
        return next(
          new ApiError(`You do not have ${action} access to any ${resource}`, 403)
        );
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };

/**
 * A Mongo filter restricting a query to the entities the actor may reach,
 * with ids that are not valid ObjectIds dropped.
 *
 * A stored grant can name an id that is not an ObjectId at all; casting it
 * would throw and take the whole request down. Dropping it narrows the result
 * instead, which is the safe direction.
 */
const objectIdScopeFilter = (actor, resource, action, { field = "_id" } = {}) => {
  const ids = engine.visibleEntityIds(actor, resource, action);
  if (ids === null) return {};
  const valid = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  return { [field]: { $in: valid } };
};

module.exports = {
  attachActor,
  actorOf,
  requirePermission,
  objectIdScopeFilter,
};
