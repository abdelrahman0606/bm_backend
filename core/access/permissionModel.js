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

module.exports = {
  permissionSchema,
  RESOURCE_TYPES,
  PERMISSION_ACTIONS,
  ALL_ENTITIES,
};
