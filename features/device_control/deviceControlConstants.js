/**
 * The vocabulary Device Control shares with the Windows agent and the Flutter
 * clients.
 *
 * Every value here is part of the wire contract: the agent reports control
 * keys back by these names, and the Flutter enums mirror them. Adding a value
 * is safe; renaming one breaks already-enrolled devices, which keep enforcing
 * a cached policy and cannot be corrected until they next sync.
 */

/** Platforms an agent can report. Only `windows` enforces today. */
const DEVICE_PLATFORMS = ["windows", "android", "macos", "linux"];

/**
 * Device lifecycle.
 *
 * `pending` is a device record an administrator created that no agent has
 * claimed yet. `blocked` refuses policy delivery and token renewal, so the
 * agent falls back to its cached policy rather than losing enforcement.
 */
const DEVICE_STATUSES = ["pending", "active", "inactive", "blocked"];

/**
 * The five independent control sections of a policy.
 *
 * Each one is enforced and reported separately, because a device can apply
 * USB restrictions and fail application control in the same sync.
 */
const CONTROL_KEYS = [
  "applicationControl",
  "websiteControl",
  "fileTransferControl",
  "usbControl",
  "systemRestrictions",
];

/**
 * What the agent may say about one control.
 *
 * `unsupported` is a first-class answer, not a failure: it is how a Windows
 * Home machine reports that an App Control policy could not be deployed, and
 * how any platform reports a control it has no mechanism for. It must stay
 * distinguishable from `applied` in every view, or the console will claim
 * enforcement that does not exist.
 */
const ENFORCEMENT_STATUSES = [
  "pending",
  "applied",
  "partial",
  "failed",
  "unsupported",
];

/** Application and website control are one mode or the other, never both. */
const POLICY_MODES = ["whitelist", "blacklist"];

/** What an employee can ask for. Mirrors the exception categories exactly. */
const REQUEST_CATEGORIES = [
  "application",
  "website",
  "usb",
  "download",
  "upload",
  "system",
];

const REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
];

/** Who performed an audited action. */
const ACTOR_KINDS = ["user", "device", "system"];

/**
 * Audited actions.
 *
 * Policy changes, assignments and request decisions are audited because they
 * change what a person may do on their own machine; enforcement failures are
 * audited because they are the only evidence that a policy did not take.
 */
const AUDIT_ACTIONS = [
  "device.enrolled",
  "device.updated",
  "device.blocked",
  "device.unblocked",
  "policy.created",
  "policy.updated",
  "policy.deleted",
  "policy.assigned",
  "policy.unassigned",
  "exception.granted",
  "exception.revoked",
  "request.created",
  "request.approved",
  "request.rejected",
  "request.cancelled",
  "enforcement.failed",
];

/** How long a freshly issued enrollment token stays usable. */
const ENROLLMENT_TOKEN_TTL_MINUTES = 60;

/** How long an agent's access token lives before it must be renewed. */
const DEVICE_TOKEN_TTL_SECONDS = 2 * 60 * 60;

/**
 * The audience claim that separates an agent token from a user token.
 *
 * Both are signed with the same secret, so without this a stolen agent token
 * would authenticate as its owner against every user route in the API.
 */
const DEVICE_TOKEN_AUDIENCE = "device-agent";

module.exports = {
  DEVICE_PLATFORMS,
  DEVICE_STATUSES,
  CONTROL_KEYS,
  ENFORCEMENT_STATUSES,
  POLICY_MODES,
  REQUEST_CATEGORIES,
  REQUEST_STATUSES,
  ACTOR_KINDS,
  AUDIT_ACTIONS,
  ENROLLMENT_TOKEN_TTL_MINUTES,
  DEVICE_TOKEN_TTL_SECONDS,
  DEVICE_TOKEN_AUDIENCE,
};
