const jwt = require("jsonwebtoken");
const bcryptjs = require("bcryptjs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const User = require("../users/userModel");
const ApiError = require("../../utils/apiError");
const invitationService = require("../invitations/invitationService");

const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_EXPIRE = process.env.JWT_EXPIRE || "7d";
const REFRESH_TOKEN_EXPIRE = process.env.REFRESH_TOKEN_EXPIRE || "30d";

// Create OAuth2 clients for different platforms
const googleClientWeb = new OAuth2Client(process.env.GOOGLE_CLIENT_ID_WEB);
const googleClientDesktop = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID_DESKTOP,
);

// Get appropriate OAuth2 client based on platform
const getOAuthClient = (platform) => {
  if (platform === "windows") {
    return googleClientDesktop;
  }
  // Default to web for web and android platforms
  return googleClientWeb;
};

// Get appropriate Google Client ID based on platform
const getGoogleClientId = (platform) => {
  if (platform === "windows") {
    return process.env.GOOGLE_CLIENT_ID_DESKTOP;
  }
  // Default to web for web and android platforms
  return process.env.GOOGLE_CLIENT_ID_WEB;
};

// Generate JWT Token
const generateToken = (id) =>
  jwt.sign({ id }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

// Generate Refresh Token
const generateRefreshToken = (id) =>
  jwt.sign({ id }, JWT_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRE });

// Hash password using bcryptjs
const hashPassword = async (password) => bcryptjs.hash(password, 10);

// Compare password using bcryptjs
const comparePassword = async (password, hash) =>
  bcryptjs.compare(password, hash);

const generateStrongRandomPassword = () =>
  crypto.randomBytes(32).toString("hex");

const buildUserResponse = async (user) => {
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
  };
};

exports.register = async (userData) => {
  const { email, password, fullName, phone, invitationCode } = userData;

  // Validate invitation
  const invitation = await invitationService.validateRegiCode(invitationCode);

  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new ApiError("Email already registered", 409);
  }

  // Create new user
  const hashedPassword = await hashPassword(password);
  const timestamp = Date.now();
  const emailPrefix = email.toLowerCase().split("@")[0];
  const user = await User.create({
    id: `${emailPrefix}-${timestamp}`,
    email: email.toLowerCase(),
    fullName: fullName,
    phone: phone || "0000000000",
    password: hashedPassword,
    type: "guest",
    role: invitation.role,
    employeeType: invitation.employeeType,
    jobs: invitation.jobs,
    status: "active",
    isEmailVerified: false,
    relation: "self",
    birthday: new Date(),
  });

  // Delete the invitation once it has been consumed successfully
  await invitationService.deleteInvitation(invitation.id);

  // Generate tokens
  const token = generateToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  return {
    user: await buildUserResponse(user),
    token,
    refreshToken,
  };
};

exports.login = async (email, password) => {
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new ApiError("Invalid email or password", 401);
  }

  // Check password
  const isPasswordValid = await comparePassword(password, user.password);
  if (!isPasswordValid) {
    throw new ApiError("Invalid email or password", 401);
  }

  // Check user status
  if (user.status === "suspended") {
    throw new ApiError("User account is suspended", 403);
  }

  if (user.status === "inactive") {
    throw new ApiError("User account is inactive", 403);
  }

  // Generate tokens
  const token = generateToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  return {
    user: await buildUserResponse(user),
    token,
    refreshToken,
  };
};

exports.googleAuth = async (idToken, platform = "web", authType, invitationCode) => {
  let payload;
  try {
    const oauthClient = getOAuthClient(platform);
    const clientId = getGoogleClientId(platform);
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch (error) {
    throw new ApiError("Invalid Google token", 401);
  }

  if (!payload || !payload.email) {
    throw new ApiError("Google account email is required", 400);
  }

  const email = payload.email.toLowerCase();
  let user = await User.findOne({ email });

  if (!user) {
    let invitation;
    if (authType === "register") {
      if (!invitationCode) {
        throw new ApiError("Invitation code is required for registration", 400);
      }
      invitation = await invitationService.validateRegiCode(invitationCode);
    } else {
      throw new ApiError("User does not exist, please register first", 404);
    }

    const randomPassword = generateStrongRandomPassword();
    const hashedPassword = await hashPassword(randomPassword);
    const timestamp = Date.now();
    const emailPrefix = email.split("@")[0];

    user = await User.create({
      id: `${emailPrefix}-${timestamp}`,
      email,
      fullName: payload.name || emailPrefix,
      photo: payload.picture || null,
      password: hashedPassword,
      type: "guest",
      role: invitation.role,
      employeeType: invitation.employeeType,
      jobs: invitation.jobs,
      status: "active",
      isEmailVerified: Boolean(payload.email_verified),
      phone: "0000000000",
      relation: "self",
      birthday: new Date(),
    });

    if (invitation) {
      await invitationService.deleteInvitation(invitation.id);
    }
  } else {
    if (authType === "register") {
      throw new ApiError("Email already registered", 409);
    }

    if (user.status === "suspended") {
      throw new ApiError("User account is suspended", 403);
    }

    if (user.status === "inactive") {
      throw new ApiError("User account is inactive", 403);
    }

    if (!user.isEmailVerified && payload.email_verified) {
      user.isEmailVerified = true;
    }

    if (!user.photo && payload.picture) {
      user.photo = payload.picture;
    }

    if (!user.fullName && payload.name) {
      user.fullName = payload.name;
    }

    await user.save();
  }

  const token = generateToken(user._id);
  const refreshToken = generateRefreshToken(user._id);

  return {
    user: await buildUserResponse(user),
    token,
    refreshToken,
  };
};

exports.getUserByToken = async (token) => {
  if (!token) {
    throw new ApiError("Token is required", 400);
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    return {
      user: await buildUserResponse(user),
    };
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new ApiError("Token has expired", 401);
    }
    throw new ApiError("Invalid token", 401);
  }
};

exports.verifyToken = async (token) => exports.getUserByToken(token);

exports.refreshToken = async (refreshToken) => {
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    const newToken = generateToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);

    return {
      user: await buildUserResponse(user),
      token: newToken,
      refreshToken: newRefreshToken,
    };
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new ApiError("Refresh token has expired", 401);
    }
    throw new ApiError("Invalid refresh token", 401);
  }
};

exports.changePassword = async (userId, oldPassword, newPassword) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  // Verify old password
  const isPasswordValid = await comparePassword(oldPassword, user.password);
  if (!isPasswordValid) {
    throw new ApiError("Current password is incorrect", 401);
  }

  // Update password
  const hashedPassword = await hashPassword(newPassword);
  user.password = hashedPassword;
  await user.save();

  return {
    message: "Password changed successfully",
  };
};

exports.forgotPassword = async (email) => {
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  // Generate reset token
  const resetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  // Save reset token to database with 1 hour expiration
  user.reset_token = hashedToken;
  user.reset_token_expires = Date.now() + 3600000; // 1 hour
  await user.save();

  return {
    resetToken,
    message: "Password reset link sent to email",
  };
};

exports.resetPassword = async (resetToken, newPassword) => {
  const hashedToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  const user = await User.findOne({
    reset_token: hashedToken,
    reset_token_expires: { $gt: Date.now() },
  });

  if (!user) {
    throw new ApiError("Invalid or expired reset token", 400);
  }

  const hashedPassword = await hashPassword(newPassword);
  user.password = hashedPassword;
  user.reset_token = null;
  user.reset_token_expires = null;
  await user.save();

  return {
    message: "Password reset successfully",
  };
};

exports.logout = async () => ({
  message: "Logged out successfully",
});

exports.getCurrentUser = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  return {
    user: await buildUserResponse(user),
  };
};
