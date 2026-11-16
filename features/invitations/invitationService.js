const crypto = require("crypto");
const invitationRepository = require("./invitationRepository");
const ApiError = require("../../utils/apiError");

const generateRegiCode = async () => {
  let isUnique = false;
  let code;
  while (!isUnique) {
    // Generate a random 8-character hex string as registration code
    code = crypto.randomBytes(4).toString("hex").toUpperCase();
    isUnique = await invitationRepository.isRegiCodeUnique(code);
  }
  return code;
};

const checkExpirationAndCleanup = async (invitation) => {
  if (!invitation) return null;
  // Only a pending invitation can expire out of existence. Once accepted the
  // row is the record linking its user to a company
  // (core/access/companyResolver.js), so deleting it here — on any read,
  // weeks later — would quietly cut somebody off from the company they
  // registered into. An accepted invitation has already done its job; its
  // expiry date no longer means anything.
  if (invitation.status !== "pending") return invitation;
  if (new Date() > new Date(invitation.expiredAt)) {
    await invitationRepository.deleteById(invitation.id);
    throw new ApiError("Invitation expired", 400);
  }
  return invitation;
};

/** Whether `data` moves the expiry date into the future. */
const _isRenewal = (data) => {
  if (!data || !data.expiredAt) return false;
  const renewedUntil = new Date(data.expiredAt);
  if (Number.isNaN(renewedUntil.getTime())) return false;
  return renewedUntil > new Date();
};

exports.createInvitation = async (data) => {
  const regiCode = await generateRegiCode();
  const invitation = await invitationRepository.create({ ...data, regiCode });
  return invitation;
};

exports.getInvitations = async (query = {}) => {
  const { page = 0, limit = 10, search, type, status, role, companyId } = query;
  const filter = {};

  if (search) {
    filter.$or = [
      { regiCode: { $regex: search, $options: "i" } },
      { role: { $regex: search, $options: "i" } },
    ];
  }
  if (companyId) filter.companyId = companyId;
  if (type) filter.type = type;
  if (status) {
    filter.status = status;
  } else {
    // An accepted invitation is kept for the company link, not because
    // anybody wants a used code in the invitations list — it used to vanish
    // on registration, and the clients still expect that. `?status=accepted`
    // reaches them when the history is what you want.
    filter.status = { $ne: "accepted" };
  }
  if (role) filter.role = role;

  const skip = parseInt(page, 10) * parseInt(limit, 10);
  const invitations = await invitationRepository.find(
    filter,
    skip,
    parseInt(limit, 10),
    { createdAt: -1 }
  );
  const total = await invitationRepository.count(filter);

  return {
    invitations,
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

exports.getInvitationById = async (id) => {
  const invitation = await invitationRepository.findById(id);
  if (!invitation) {
    throw new ApiError("Invitation not found", 404);
  }
  await checkExpirationAndCleanup(invitation);
  return invitation;
};

exports.updateInvitation = async (id, data) => {
  let invitation = await invitationRepository.findById(id);
  if (!invitation) {
    throw new ApiError("Invitation not found", 404);
  }

  // An edit that pushes the expiry into the future is a renewal, and it is
  // the one change an expired invitation actually needs. Sweeping first would
  // delete the row and answer "Invitation expired" to somebody who was
  // fixing exactly that.
  if (!_isRenewal(data)) {
    await checkExpirationAndCleanup(invitation);
  }

  invitation = await invitationRepository.updateById(id, data);
  return invitation;
};

exports.deleteInvitation = async (id) => {
  const invitation = await invitationRepository.deleteById(id);
  if (!invitation) {
    throw new ApiError("Invitation not found", 404);
  }
  return invitation;
};

exports.validateRegiCode = async (regiCode) => {
  const invitation = await invitationRepository.findByRegiCode(regiCode);
  if (!invitation) {
    throw new ApiError("Invalid registration code", 404);
  }

  // A code is good once. Deleting the invitation on registration used to be
  // what enforced that; now that the row is kept as the user's link to their
  // company, the status is. Without this check, keeping the row would hand
  // the same access to everybody who got hold of the code.
  if (invitation.status !== "pending") {
    throw new ApiError(
      invitation.status === "accepted"
        ? "This registration code has already been used"
        : "This invitation is no longer valid",
      409
    );
  }

  await checkExpirationAndCleanup(invitation);

  return invitation;
};

/**
 * Marks the invitation as consumed by the account just created from it.
 *
 * Replaces deleting it: `companyResolver` reads
 * `User.regiCode` -> `Invitation.regiCode` -> `companyId` to work out which
 * company a user belongs to, so the row has to outlive the registration or
 * the user it created belongs nowhere.
 */
exports.acceptInvitation = async (id) => {
  const invitation = await invitationRepository.updateById(id, {
    status: "accepted",
  });
  if (!invitation) {
    throw new ApiError("Invitation not found", 404);
  }
  return invitation;
};
