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
  if (new Date() > new Date(invitation.expiredAt)) {
    await invitationRepository.deleteById(invitation.id);
    throw new ApiError("Invitation expired", 400);
  }
  return invitation;
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
  if (status) filter.status = status;
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
  await checkExpirationAndCleanup(invitation);

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

  await checkExpirationAndCleanup(invitation);

  return invitation;
};
