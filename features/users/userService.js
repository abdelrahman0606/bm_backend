const User = require("./userModel");
const ApiError = require("../../utils/apiError");

const buildUserResponse = async (user) => {
  const wallet = await walletService.ensureWallet(user._id);

  return {
    _id: user._id,
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    type: user.type,
    status: user.status,
    regiCode: user.regiCode,
    deviceToken: user.deviceToken,
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
    isEmailVerified: user.isEmailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    goldCoins: wallet.goldCoins,
    silverCoins: wallet.silverCoins,
  };
};

exports.createUser = async (userData) => {
  const { goldCoins, silverCoins, ...safeUserData } = userData;
  const user = await User.create(safeUserData);
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

exports.updateUser = async (id, updateData) => {
  const { goldCoins, silverCoins, ...safeUpdateData } = updateData;
  const user = await User.findByIdAndUpdate(
    id,
    { ...safeUpdateData },
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

exports.deleteUser = async (id) => {
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

exports.updateUserRole = async (id, role) => {
  if (typeof role !== "string" || !role.trim()) {
    throw new ApiError("Invalid role", 400);
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
