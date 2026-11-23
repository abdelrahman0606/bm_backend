const mongoose = require("mongoose");
const Company = require("./companyModel");
const Invitation = require("../invitations/invitationModel");
const User = require("../users/userModel");
const { ALL_ENTITIES } = require("../../core/access/permissionModel");
const { companiesForUser } = require("../../core/access/companyResolver");

/**
 * Who counts as being "in" a company, for listing purposes.
 *
 * The user document has no company field, so membership has to be read from
 * the relationships that do exist. Three of them attach a person to a
 * company, and the directory shows exactly those:
 *
 *  1. a permission grant naming the company (`permissions`, resource type
 *     `company`, resource id the company's id) — the grants the permission
 *     engine evaluates, which is what "has permissions to this company"
 *     means everywhere else in the code;
 *  2. a grant scoped to every company (`*`, or the empty id the engine reads
 *     the same way) — such a user can reach this company too;
 *  3. owning the company (`Company.createdBy`), or having registered with an
 *     invitation this company issued (`User.regiCode` →
 *     `Invitation.regiCode`) — the same two links `companyResolver` treats as
 *     authoritative. Without these an owner or a freshly invited employee
 *     would be missing from their own company's member list until somebody
 *     opened the permission editor on them.
 *
 * Everything else is left out, which is the point: before this, `/users`
 * ignored `companyId` entirely and every account on the deployment showed up
 * in every company's member list.
 */

/// The scope values that mean "every company" to the permission engine.
const _ALL_COMPANY_SCOPES = [ALL_ENTITIES, "all", ""];

/**
 * The mongo filter that selects the users attached to `companyId`.
 *
 * An id that is not an ObjectId matches nobody rather than everybody: a
 * malformed parameter must not widen the directory back out to every user.
 */
const companyMembersFilter = async (companyId) => {
  const id = String(companyId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return { _id: { $in: [] } };
  }

  const or = [
    {
      permissions: {
        $elemMatch: {
          resourceType: "company",
          resourceId: { $in: [id, ..._ALL_COMPANY_SCOPES] },
        },
      },
    },
  ];

  const company = await Company.findById(id).select("createdBy");
  const owner = company && company.createdBy ? String(company.createdBy) : "";
  if (mongoose.Types.ObjectId.isValid(owner)) {
    or.push({ _id: owner });
  }

  const invitations = await Invitation.find({ companyId: id }).select(
    "regiCode"
  );
  const codes = [
    ...new Set(
      invitations
        .map((invitation) => String(invitation.regiCode || "").trim())
        .filter((code) => code !== "")
    ),
  ];
  if (codes.length > 0) {
    or.push({ regiCode: { $in: codes } });
  }

  return { $or: or };
};

/**
 * The company ids `actor` holds a `company` grant for.
 *
 * `null` means "every company": a grant scoped to `*` reaches all of them, so
 * there is nothing to narrow.
 */
const _grantedCompanyIds = (actor) => {
  const grants = (actor && actor.permissions) || [];
  const companyGrants = grants.filter(
    (grant) =>
      grant && String(grant.resourceType || "").trim().toLowerCase() === "company"
  );

  const reachesAll = companyGrants.some((grant) => {
    const id = String(grant.resourceId || "").trim();
    return _ALL_COMPANY_SCOPES.includes(id) || id.toLowerCase() === "all";
  });
  if (reachesAll) return null;

  return [
    ...new Set(
      companyGrants
        .map((grant) => String(grant.resourceId || "").trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
    ),
  ];
};

/**
 * Whether `actor` may read `companyId`'s member list.
 *
 * The question is answered with the same definition the list itself uses: an
 * actor may read a company's members when they are one of them. So an owner,
 * an invited employee and a grant holder all pass, and nobody else does —
 * without needing a second, parallel notion of "belongs to".
 *
 * Not staged behind `ACCESS_ENFORCE`: this is about whose directory a caller
 * reads, and answering with another company's staff is the leak being closed,
 * not an entity scope being tightened.
 */
const mayListCompanyMembers = async (actor, companyId) => {
  if (actor && actor.isMaster) return true;

  const actorId = actor && actor.id ? String(actor.id) : "";
  if (!mongoose.Types.ObjectId.isValid(actorId)) return false;

  const filter = await companyMembersFilter(companyId);
  const found = await User.exists({ $and: [{ _id: actorId }, filter] });
  return Boolean(found);
};

/**
 * The filter narrowing a user listing to what `actor` may see, or `null` when
 * nothing should be narrowed.
 *
 * `null` is returned for a master, and for an actor holding a company grant
 * scoped to every company — both of those reach every company already, so
 * every member of every company is theirs to read.
 *
 * Anybody else sees the members of the companies they are attached to, plus
 * themselves. The unscoped directory used to answer with every account on the
 * deployment to anyone holding a token, which is what the member pickers and
 * collaborator search were quietly built on.
 */
const visibleUsersFilter = async (actor) => {
  if (actor && actor.isMaster) return null;

  const actorId = actor && actor.id ? String(actor.id) : "";
  if (!mongoose.Types.ObjectId.isValid(actorId)) {
    return { _id: { $in: [] } };
  }

  const granted = _grantedCompanyIds(actor);
  if (granted === null) return null;

  const attached = await companiesForUser(actorId);
  const companyIds = [...new Set([...granted, ...attached])];

  // Always themselves: a user with no company yet must not vanish from a
  // picker that is showing them their own account.
  const or = [{ _id: actorId }];
  for (const companyId of companyIds) {
    or.push(await companyMembersFilter(companyId));
  }

  return { $or: or };
};

module.exports = {
  companyMembersFilter,
  mayListCompanyMembers,
  visibleUsersFilter,
};
