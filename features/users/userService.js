const User = require("./userModel");
const ApiError = require("../../utils/apiError");
const {
  sanitizeUserWrite,
  assertMemberWriteAllowed,
} = require("../../core/access/userWriteGuard");
const engine = require("../../core/access/permissionEngine");
const {
  companyMembersFilter,
  mayListCompanyMembers,
  visibleUsersFilter,
} = require("../companies/companyMembers");

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

/**
 * The user directory, narrowed to what the caller may read.
 *
 * `companyId` asks for one company's members, and is honoured only for a
 * caller who belongs to that company — a master, its owner, an invited
 * employee, or somebody holding a grant naming it. Without `companyId` the
 * answer is the whole deployment for a master, and the caller's own companies
 * for everybody else: the listing used to ignore both the parameter and the
 * caller, so any account with a token could read every user of every company.
 *
 * `actor` left out keeps the old unnarrowed behaviour, for internal callers
 * that are not acting for a request.
 */
exports.getAllUsers = async (query = {}, actor = null) => {
  const { page = 0, limit = 10, role, status, search, companyId } = query;

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

  // The company scope and the search are both `$or`s, so they are composed
  // under `$and`: assigning either one to `filter.$or` would silently drop
  // the other.
  const conditions = [];

  if (search) {
    conditions.push({
      $or: [
        { email: { $regex: search, $options: "i" } },
        { fullName: { $regex: search, $options: "i" } },
      ],
    });
  }

  // `companyId` was accepted and ignored before this, so every company's
  // member list showed every account on the deployment.
  const askedCompanyId = String(companyId || "").trim();
  if (askedCompanyId !== "") {
    if (actor && !(await mayListCompanyMembers(actor, askedCompanyId))) {
      // Refused rather than answered with their own company's members: a
      // request naming a company they are not in is one we do not
      // understand, and quietly swapping it would hide the mistake.
      throw new ApiError("You do not have access to this company", 403);
    }
    conditions.push(await companyMembersFilter(askedCompanyId));
  }

  // And whatever the caller may see at all, so an unscoped listing is their
  // own companies rather than the whole deployment.
  if (actor) {
    const visible = await visibleUsersFilter(actor);
    if (visible) conditions.push(visible);
  }

  if (conditions.length > 0) {
    filter.$and = conditions;
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
