const mongoose = require("mongoose");

/**
 * The resource kinds a permission can name.
 *
 * Kept in lockstep with the Flutter `ResourceType` enum
 * (lib/features/users/access/domain/entities/resource_type.dart). A value the
 * client sends that is not listed here is rejected by validation rather than
 * stored, so an unknown resource can never end up in a grant.
 */
const RESOURCE_TYPES = [
  "company",
  "department",
  "subDepartment",
  "project",
  "task",
  "member",
  "role",
  "attendance",
  "file",
  "settings",
  // Device Control. `device` covers enrollment, status, requests and
  // exceptions; `devicePolicy` covers authoring and assigning the policies
  // themselves, so a help-desk role can approve a request without being able
  // to rewrite the rules everyone is under.
  "device",
  "devicePolicy",
];

/**
 * The actions a permission can carry, matching Flutter's `PermissionAction`.
 */
const PERMISSION_ACTIONS = ["view", "create", "update", "delete", "fullAccess"];

/**
 * The scope sentinel meaning "every entity of this resource type".
 *
 * A grant that names a concrete id keeps meaning that one entity, so existing
 * rows need no migration.
 */
const ALL_ENTITIES = "*";

/**
 * One grant: a resource type, the entity it applies to, and what may be done.
 *
 * `_id: false` because a grant has no identity of its own — it is replaced
 * wholesale when a user's access is rewritten.
 */
const permissionSchema = new mongoose.Schema(
  {
    resourceType: {
      type: String,
      required: true,
      enum: RESOURCE_TYPES,
    },
    resourceId: {
      type: String,
      required: true,
      trim: true,
    },
    resourceName: {
      type: String,
      default: "",
      trim: true,
    },
    actions: {
      type: [String],
      default: [],
      enum: PERMISSION_ACTIONS,
    },
  },
  { _id: false }
);

/**
 * The grants in `raw` that can be stored on a user, normalized.
 *
 * An invitation carries whatever the inviting client sent: the field is
 * `Mixed` and validation only checked that it was an array. A user document
 * is strict, so one malformed grant would make `User.create` throw and cost
 * somebody their registration. Dropping a grant that names a resource or an
 * action we do not recognise loses access no engine could have evaluated
 * anyway; refusing the registration loses the account.
 *
 * An empty `resourceId` means "every entity of this type" to both permission
 * engines, so it becomes `ALL_ENTITIES` rather than being dropped: the schema
 * requires the field, and the meaning has to survive the copy.
 *
 * A grant carrying no valid action grants nothing, so it is not stored.
 */
const sanitizePermissions = (raw) => {
  if (!Array.isArray(raw)) return [];

  return raw.reduce((kept, grant) => {
    if (!grant || typeof grant !== "object") return kept;

    const resourceType = String(grant.resourceType || "").trim();
    if (!RESOURCE_TYPES.includes(resourceType)) return kept;

    const actions = [
      ...new Set(
        (Array.isArray(grant.actions) ? grant.actions : [])
          .map((action) => String(action || "").trim())
          .filter((action) => PERMISSION_ACTIONS.includes(action))
      ),
    ];
    if (actions.length === 0) return kept;

    kept.push({
      resourceType,
      resourceId: String(grant.resourceId || "").trim() || ALL_ENTITIES,
      resourceName: String(grant.resourceName || "").trim(),
      actions,
    });
    return kept;
  }, []);
};

module.exports = {
  permissionSchema,
  RESOURCE_TYPES,
  PERMISSION_ACTIONS,
  ALL_ENTITIES,
  sanitizePermissions,
};
