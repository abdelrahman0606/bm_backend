const jwt = require("jsonwebtoken");

const ApiError = require("../../utils/apiError");
const Device = require("./deviceModel");
const {
  DEVICE_TOKEN_AUDIENCE,
  DEVICE_TOKEN_TTL_SECONDS,
} = require("./deviceControlConstants");

/**
 * Authentication for the agent, kept apart from authentication for people.
 *
 * A device token carries `aud: device-agent` and is only ever accepted by the
 * agent routes. The existing `verifyAuthToken` ignores the audience claim, so
 * without this separation a token stolen from a laptop's disk would open
 * every user endpoint in the API as that employee. It opens five agent
 * endpoints instead, all scoped to the one device in its subject.
 */

const _secret = () =>
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

/**
 * Mints the short-lived token the agent uses for policy and reporting.
 *
 * `credentialVersion` is inside the token and re-checked on every request, so
 * re-enrolling a device invalidates any token issued before it, without
 * needing a revocation list.
 */
const issueDeviceToken = (device) =>
  jwt.sign(
    {
      sub: String(device._id),
      companyId: device.companyId,
      credentialVersion: device.credentialVersion,
    },
    _secret(),
    { audience: DEVICE_TOKEN_AUDIENCE, expiresIn: DEVICE_TOKEN_TTL_SECONDS }
  );

/**
 * Loads the device behind a request, refusing anything that is not a live,
 * unblocked device of the company the token claims.
 *
 * A blocked device is refused here rather than silently served an empty
 * policy: the agent is told it is blocked and keeps enforcing its cached
 * policy, which is the safe direction. Serving nothing would read to the
 * agent as "no restrictions".
 */
const verifyDeviceToken = async (req, res, next) => {
  try {
    const raw = req.headers.authorization?.split(" ")[1];
    if (!raw) return next(new ApiError("No device token provided", 401));

    let decoded;
    try {
      decoded = jwt.verify(raw, _secret(), { audience: DEVICE_TOKEN_AUDIENCE });
    } catch (error) {
      return next(new ApiError("Invalid or expired device token", 401));
    }

    const device = await Device.findById(decoded.sub);
    if (!device) return next(new ApiError("Unknown device", 401));

    if (device.credentialVersion !== decoded.credentialVersion) {
      return next(new ApiError("Device credentials were rotated; enroll again", 401));
    }

    if (device.status === "blocked") {
      return next(new ApiError("This device is blocked", 403));
    }

    req.device = device;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { issueDeviceToken, verifyDeviceToken };
