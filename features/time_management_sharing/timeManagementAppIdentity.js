/**
 * Stable identities for device usage synchronization.
 *
 * An application name alone is not an identity: the same application is
 * reported as "Code.exe", "code.exe" or "Code" depending on the device and the
 * platform. `normalizeAppId` derives one identifier from the display name, and
 * it is always derived **on the server** so two devices that spell the name
 * differently still aggregate into the same application.
 *
 * The display name is kept untouched alongside it.
 */

/** Executable suffixes stripped so the same binary matches across platforms. */
const EXECUTABLE_SUFFIXES = [".exe", ".app", ".lnk"];

/**
 * `Code.exe` → `code`, `Google Chrome` → `google-chrome`.
 *
 * The result only contains `[a-z0-9.-]`, so it is safe in a URL and in a
 * MongoDB index key.
 */
const normalizeAppId = (appName) => {
  if (typeof appName !== "string") return "";

  let value = appName.trim().toLowerCase();
  for (const suffix of EXECUTABLE_SUFFIXES) {
    if (value.endsWith(suffix)) {
      value = value.slice(0, -suffix.length);
      break;
    }
  }

  return value
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
};

/**
 * The identity of one stored contribution: `userId + deviceId + appKey + date`,
 * where `appKey` is the client's own record identity (the application name as
 * that device recorded it). Returned as a string for grouping and
 * de-duplication inside a batch.
 *
 * The normalized `appId` is deliberately *not* part of this key: two records
 * that normalize to one application must still be stored separately and summed
 * at read time, never merged into one contribution.
 */
const aggregationKey = ({ userId, deviceId, appKey, date }) =>
  `${userId}|${deviceId}|${appKey}|${date}`;

module.exports = { normalizeAppId, aggregationKey, EXECUTABLE_SUFFIXES };
