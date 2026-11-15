const mongoose = require("mongoose");
const User = require("../../features/users/userModel");
const Company = require("../../features/companies/companyModel");
const NotificationHelper = require("../../features/notifications/notificationHelper");
const engine = require("../access/permissionEngine");

/**
 * Notifies whoever actually holds a permission, rather than whoever holds a
 * title.
 *
 * Every approval flow needs the same thing: "tell the people entitled to
 * decide this, for this company". Written once here so a second flow cannot
 * invent its own answer and drift — and so the rule about who may decide is
 * stated in exactly one place.
 *
 * Two rules it keeps:
 *
 *  - **A role is not an entitlement.** Being an admin does not put somebody
 *    in a company's approval queue; holding a grant on *that company* does.
 *    Only two relationships bypass a grant, and neither is a bare role:
 *    master (unrestricted by definition), and the company's own creator.
 *  - **Payloads carry no sensitive data.** Callers pass a title, a body and
 *    ids. Face images, embeddings and other biometrics never reach a push
 *    payload, where they would be handed to a third-party transport and
 *    cached well beyond this system.
 */

const _asId = (value) => (value ? String(value) : null);

/**
 * The users entitled to [action] on [resource] for one company.
 *
 * `resource` is the permission's resource type and the company id is the
 * grant's entity, so a grant reads "update attendance for company X".
 *
 * Returns an array of lean user documents ({_id, fullName, role}).
 */
const approversFor = async ({ companyId, resource, action }) => {
  const company = _asId(companyId);
  if (!company || !mongoose.Types.ObjectId.isValid(company)) return [];

  // A grant on this company, or on every company of the type.
  const candidates = await User.find({
    status: { $ne: "blocked" },
    $or: [
      {
        permissions: {
          $elemMatch: {
            resourceType: resource,
            resourceId: { $in: [company, "*", ""] },
          },
        },
      },
      { role: "master" },
    ],
  }).select("_id fullName role permissions status");

  const entitled = candidates.filter((user) => {
    const actor = new engine.Actor({
      id: String(user._id),
      role: user.role,
      permissions: user.permissions || [],
    });
    // Re-checked through the engine rather than trusted from the query: the
    // query is a coarse pre-filter, and only the engine knows that
    // `fullAccess` implies the action and that an id must match exactly.
    return engine.can(actor, resource, action, company);
  });

  // The company's creator is entitled by relationship, not by role — they
  // own the thing being decided about. Added even with no grant, so a new
  // company is never left with an approval queue nobody can see.
  const owner = await Company.findById(company).select("createdBy");
  const ownerId = _asId(owner && owner.createdBy);
  if (ownerId && !entitled.some((user) => String(user._id) === ownerId)) {
    const ownerUser = await User.findById(ownerId).select("_id fullName role");
    if (ownerUser) entitled.push(ownerUser);
  }

  return entitled;
};

/**
 * Sends one notification to every user entitled to decide.
 *
 * `metadata` and `action` are passed through to the notification, so the
 * client can route to the right screen. Callers are responsible for keeping
 * them free of sensitive data; this adds nothing of its own.
 *
 * Delivery failures never fail the caller's operation: a request that was
 * recorded is recorded whether or not the push went out. The count of
 * notifications actually created is returned so a caller can log it.
 */
const notifyEntitled = async ({
  companyId,
  resource,
  action,
  type,
  title,
  body,
  priority = "normal",
  createdBy,
  notificationAction,
  metadata = {},
  excludeUserIds = [],
}) => {
  const excluded = new Set(excludeUserIds.map((id) => String(id)));
  const recipients = (
    await approversFor({ companyId, resource, action })
  ).filter((user) => !excluded.has(String(user._id)));

  const results = await Promise.all(
    recipients.map((user) =>
      NotificationHelper.send({
        companyId: String(companyId),
        userId: String(user._id),
        type,
        priority,
        title,
        body,
        createdBy: String(createdBy || ""),
        action: notificationAction,
        metadata,
      })
    )
  );

  return {
    recipients: recipients.map((user) => String(user._id)),
    delivered: results.filter(Boolean).length,
  };
};

/** Sends one notification to one person, with the same failure policy. */
const notifyUser = async ({
  companyId,
  userId,
  type,
  title,
  body,
  priority = "normal",
  createdBy,
  notificationAction,
  metadata = {},
}) => {
  const result = await NotificationHelper.send({
    companyId: String(companyId),
    userId: String(userId),
    type,
    priority,
    title,
    body,
    createdBy: String(createdBy || ""),
    action: notificationAction,
    metadata,
  });
  return { delivered: result ? 1 : 0 };
};

module.exports = {
  approversFor,
  notifyEntitled,
  notifyUser,
};
