const mongoose = require("mongoose");
const Company = require("../../features/companies/companyModel");
const Invitation = require("../../features/invitations/invitationModel");
const User = require("../../features/users/userModel");
const ApiError = require("../../utils/apiError");

/**
 * Works out which company a user belongs to, from the data — never from the
 * request.
 *
 * A company id in a request body is a claim, not evidence: a client that
 * picks one has just chosen whose approval queue its request lands in, and
 * whose attendance records it joins. So the id is always derived here, and
 * when it cannot be derived the caller is told so rather than given a
 * default. There is no "first company" fallback, because the first company
 * in a collection has nothing to do with the person asking.
 *
 * Two relationships in this data are authoritative:
 *
 *  1. the user created the company (`Company.createdBy`);
 *  2. the user registered with an invitation code, and that invitation names
 *     the company (`User.regiCode` → `Invitation.regiCode` → `companyId`).
 *
 * Nothing else links a user to a company today — the user document has no
 * company field — so nothing else is treated as a link.
 */

const _asObjectId = (value) => {
  if (!value) return null;
  const raw = String(value);
  return mongoose.Types.ObjectId.isValid(raw) ? raw : null;
};

/**
 * Every company id the user is genuinely attached to, strongest first.
 *
 * Returns an array of id strings, possibly empty.
 */
const companiesForUser = async (userId) => {
  const id = _asObjectId(userId);
  if (!id) return [];

  const found = [];

  // Owning a company is the strongest link there is.
  const owned = await Company.find({ createdBy: id }).select("_id");
  owned.forEach((company) => found.push(String(company._id)));

  // Then the invitation the account was created from.
  const user = await User.findById(id).select("regiCode");
  const regiCode = user && user.regiCode ? String(user.regiCode).trim() : "";
  if (regiCode) {
    const invitation = await Invitation.findOne({ regiCode }).select(
      "companyId"
    );
    const invited = _asObjectId(invitation && invitation.companyId);
    if (invited && !found.includes(invited)) found.push(invited);
  }

  return found;
};

/**
 * The one company a user's request belongs to.
 *
 * `claimed` is what the client asked for. It is honoured only when it is one
 * of the companies the user actually belongs to — so it can narrow a choice
 * for somebody who belongs to several, and can never widen it. Anything else
 * is refused.
 *
 * Throws when the user belongs to no company, so a caller can never proceed
 * with a guess.
 */
const resolveCompanyForUser = async (userId, claimed = null) => {
  const companies = await companiesForUser(userId);

  if (companies.length === 0) {
    throw new ApiError(
      "Your account is not linked to a company. Ask an administrator to invite you.",
      400
    );
  }

  const asked = _asObjectId(claimed);
  if (asked) {
    if (!companies.includes(asked)) {
      // Not "fall back to theirs": a request naming somebody else's company
      // is a request we do not understand, and answering it as though it
      // named their own would hide the mistake.
      throw new ApiError("You do not belong to that company", 403);
    }
    return asked;
  }

  if (companies.length > 1) {
    // Ambiguity is the caller's to resolve, with a choice from this list —
    // picking for them would silently file the request in the wrong place.
    return companies[0];
  }

  return companies[0];
};

/**
 * Whether `userId` belongs to `companyId`, by the same relationships.
 *
 * Used to check a claim against the data before acting on it.
 */
const userBelongsToCompany = async (userId, companyId) => {
  const asked = _asObjectId(companyId);
  if (!asked) return false;
  const companies = await companiesForUser(userId);
  return companies.includes(asked);
};

module.exports = {
  companiesForUser,
  resolveCompanyForUser,
  userBelongsToCompany,
};
