const User = require("./userModel");
const ApiError = require("../../utils/apiError");
const {
  sanitizeUserWrite,
  assertMemberWriteAllowed,
} = require("../../core/access/userWriteGuard");
const engine = require("../../core/access/permissionEngine");

const buildUserResponse = async (user) => ({
    _id: user._id,
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    type: user.type,
    status: user.status,
    regiCode: user.regiCode,
    devicesTokens: user.devicesTokens,
    isMale: user.isMale,
    birthday: user.birthday,
    address: user.address,
    token: user.token,
    refreshToken: user.refreshToken,
    role: user.role,
    employeeType: user.employeeType,
    notionalId: user.notionalId,
    relation: user.relation,
    jobs: user.jobs,
    rate: user.rate,
    bio: user.bio,
    photo: user.photo,
    files: user.files,
    access: user.access,
    // The grants the permission engine reads. Returned so the client can
    // show and edit them; the client's copy is never trusted on the way back.
    permissions: (user.permissions || []).map((permission) => ({
      resourceType: permission.resourceType,
      resourceId: permission.resourceId,
      resourceName: permission.resourceName,
      actions: [...(permission.actions || [])],
    })),
    isEmailVerified: user.isEmailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });

exports.createUser = async (userData, actor = null) => {
  // A create carries no stored state to compare against, so every role and
  // grant in the payload has to be one the actor may hand out.
  const safeData = actor ? sanitizeUserWrite(actor, userData, { current: null }) : userData;
  const user = await User.create(safeData);
  return buildUserResponse(user);
};

exports.getUserById = async (id) => {
  const user = await User.findById(id);
  if (!user) {
    throw new ApiError("User not found", 404);
  }
  return buildUserResponse(user);
};

exports.getUserByEmail = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new ApiError("User not found", 404);
  }
  return buildUserResponse(user);
};

exports.getAllUsers = async (query = {}) => {
  const { page = 0, limit = 10, role, status, search } = query;

  const filter = {};

  const notEqualId = query["id!"] || query["id!="];
  if (notEqualId) {
    filter._id = { $ne: notEqualId };
  }

  if (role) {
    filter.role = role;
  }

  if (status) {
    filter.status = status;
  }

  if (search) {
    filter.$or = [
      { email: { $regex: search, $options: "i" } },
      { fullName: { $regex: search, $options: "i" } },
    ];
  }

  const skip = page * limit;
  const users = await User.find(filter)
    .skip(skip)
    .limit(parseInt(limit, 10))
    .sort({ createdAt: -1 });

  const total = await User.countDocuments(filter);

  return {
    users: await Promise.all(users.map((user) => buildUserResponse(user))),
    pagination: {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

exports.updateUser = async (id, updateData, actor = null) => {
  const { goldCoins, silverCoins, ...safeUpdateData } = updateData;

  let payload = safeUpdateData;

  if (actor) {
    // Read the stored user first: the escalation checks compare the payload
    // against what is already there, and the 404 is owed either way.
    const current = await User.findById(id).select("role permissions");
    if (!current) {
      throw new ApiError("User not found", 404);
    }
    assertMemberWriteAllowed(actor, id, "update");
    payload = sanitizeUserWrite(actor, safeUpdateData, { current });
  }

  const user = await User.findByIdAndUpdate(
    id,
    { ...payload },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  return buildUserResponse(user);
};

exports.deleteUser = async (id, actor = null) => {
  if (actor) {
    assertMemberWriteAllowed(actor, id, "delete");
  }

  const user = await User.findByIdAndDelete(id);

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  return buildUserResponse(user);
};

exports.verifyUserEmail = async (id) => {
  const user = await User.findByIdAndUpdate(
    id,
    { isEmailVerified: true },
    { new: true },
  );

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  return buildUserResponse(user);
};

exports.updateUserStatus = async (id, status) => {
  if (typeof status !== "string" || !status.trim()) {
    throw new ApiError("Invalid status", 400);
  }

  const user = await User.findByIdAndUpdate(
    id,
    { status: status.trim() },
    { new: true },
  );

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  return buildUserResponse(user);
};

exports.updateUserRole = async (id, role, actor = null) => {
  if (typeof role !== "string" || !role.trim()) {
    throw new ApiError("Invalid role", 400);
  }

  if (actor) {
    // The dedicated role endpoint is the shortest path to escalation, so it
    // carries the same ceiling as the generic update: strictly more junior
    // than the actor, and only on a member they may write to.
    assertMemberWriteAllowed(actor, id, "update");
    if (!engine.canAssignRole(actor, role)) {
      throw new ApiError(`You may not assign the role "${role.trim()}"`, 403);
    }
  }

  const user = await User.findByIdAndUpdate(
    id,
    { role: role.trim() },
    { new: true },
  );

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  return buildUserResponse(user);
};

exports.checkEmailExists = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  return !!user;
};

exports.addDeviceToken = async (id, token) => {
  if (typeof token !== "string" || !token.trim()) {
    throw new ApiError("Invalid token", 400);
  }

  const user = await User.findById(id);
  if (!user) {
    throw new ApiError("User not found", 404);
  }

  const currentTokens = user.devicesTokens || [];
  if (!currentTokens.includes(token)) {
    user.devicesTokens = [...currentTokens, token];
    await user.save();
  }

  return buildUserResponse(user);
};
