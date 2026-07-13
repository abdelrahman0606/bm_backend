/**
 * Project Feature Migration Script
 *
 * Safe migration from the old project schema to the new schema.
 *
 * Changes handled:
 *   1. Rename `name` → `title` for all existing project documents
 *   2. Remove or null out `icon` (was String, now iconFileId as ObjectId)
 *   3. Add missing boolean flags: isDeleted, isArchived, isFavorite
 *   4. Remove embedded fields no longer in schema: analytics, settings, members,
 *      attachments, links, tags, priority, emoji, coverImage, colorValue, createdBy
 *   5. Add `createdByUserId` from `createdBy` if it was a valid ObjectId string
 *   6. Auto-create `project_configurations` for all projects that lack one
 *
 * Usage:
 *   node projectMigration.js
 *
 * IMPORTANT: Run against a database backup first!
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../../../config.env") });

const mongoose = require("mongoose");

// ── Connect ───────────────────────────────────────────────────────────────────

async function connect() {
  const uri = process.env.TASKS_MONGODB_URI;
  if (!uri) {
    throw new Error("TASKS_MONGODB_URI is not set in config.env");
  }
  await mongoose.connect(uri);
  console.log("✔  Connected to Tasks MongoDB");
}

// ── Default configuration settings ───────────────────────────────────────────

function buildDefaultSettings() {
  return {
    timeTracking: { enabled: false },
    ai: { enabled: false },
    watchers: { enabled: true },
    components: { enabled: false },
    versions: { enabled: false },
    sprints: { enabled: false },
    activityLogs: { enabled: true },
    notifications: { enabled: true },
    guestAccess: { enabled: false },
    fileUploads: { enabled: true },
    comments: { enabled: true },
    automation: { enabled: false },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidObjectId(value) {
  return value && /^[a-f\d]{24}$/i.test(String(value));
}

// ── Migration Steps ───────────────────────────────────────────────────────────

/**
 * Step 1 — Rename `name` → `title`
 * Uses $rename which is safe and atomic.
 */
async function step1_renameNameToTitle(db) {
  console.log("\n[Step 1] Renaming `name` → `title`...");
  const result = await db
    .collection("projects")
    .updateMany(
      { name: { $exists: true }, title: { $exists: false } },
      { $rename: { name: "title" } }
    );
  console.log(`  ✔  ${result.modifiedCount} documents renamed`);
}

/**
 * Step 2 — Clear old `icon` string field (cannot auto-convert to ObjectId).
 * Sets iconFileId to null and removes the old icon string.
 */
async function step2_clearIconString(db) {
  console.log("\n[Step 2] Clearing old string `icon` field...");
  const result = await db
    .collection("projects")
    .updateMany(
      { icon: { $exists: true } },
      {
        $set: { iconFileId: null },
        $unset: { icon: "" },
      }
    );
  console.log(`  ✔  ${result.modifiedCount} documents updated`);
}

/**
 * Step 3 — Add missing boolean flags with their default values.
 */
async function step3_addMissingFlags(db) {
  console.log("\n[Step 3] Adding missing boolean flags...");
  const result = await db.collection("projects").updateMany(
    {},
    {
      $set: {
        isDeleted: false,
        isArchived: false,
        isFavorite: false,
      },
    },
    {
      // Only set if not already present
      arrayFilters: [],
    }
  );

  // More precise: only add where truly missing
  await db.collection("projects").updateMany(
    { isDeleted: { $exists: false } },
    { $set: { isDeleted: false } }
  );
  await db.collection("projects").updateMany(
    { isArchived: { $exists: false } },
    { $set: { isArchived: false } }
  );
  await db.collection("projects").updateMany(
    { isFavorite: { $exists: false } },
    { $set: { isFavorite: false } }
  );

  // Set archivedAt / deletedAt to null if missing
  await db.collection("projects").updateMany(
    { archivedAt: { $exists: false } },
    { $set: { archivedAt: null } }
  );
  await db.collection("projects").updateMany(
    { deletedAt: { $exists: false } },
    { $set: { deletedAt: null } }
  );

  console.log("  ✔  Flags ensured on all documents");
}


/**
 * Step 4 — Migrate `createdBy` string to ObjectId.
 * Converts the existing string `createdBy` value to an ObjectId if valid.
 */
async function step4_migrateCreatedBy(db) {
  console.log("\n[Step 4] Migrating `createdBy` string to ObjectId...");

  const docs = await db
    .collection("projects")
    .find({
      createdBy: { $exists: true },
    })
    .toArray();

  let migrated = 0;
  let skipped = 0;

  for (const doc of docs) {
    if (doc.createdBy instanceof mongoose.Types.ObjectId) {
      continue;
    }
    if (isValidObjectId(doc.createdBy)) {
      await db.collection("projects").updateOne(
        { _id: doc._id },
        {
          $set: { createdBy: new mongoose.Types.ObjectId(doc.createdBy) },
        }
      );
      migrated++;
    } else {
      skipped++;
    }
  }

  console.log(`  ✔  Migrated: ${migrated}, Skipped (invalid): ${skipped}`);
}

/**
 * Step 5 — Remove fields that are no longer part of the schema.
 */
async function step5_removeObsoleteFields(db) {
  console.log("\n[Step 5] Removing obsolete fields...");

  const obsoleteFields = {
    analytics: "",
    settings: "",
    members: "",
    attachments: "",
    links: "",
    tags: "",
    priority: "",
    emoji: "",
    coverImage: "",
    colorValue: "",
    archived: "",        // old boolean flag (renamed to isArchived in new schema)
    isTemplate: "",      // moved out of scope
  };

  const result = await db
    .collection("projects")
    .updateMany({}, { $unset: obsoleteFields });

  console.log(`  ✔  ${result.modifiedCount} documents cleaned`);
}

/**
 * Step 6 — Sync `archived` → `isArchived` for documents that had the old flag.
 * Must run BEFORE step 5 removes `archived`.
 */
async function step6_syncArchivedFlag(db) {
  console.log("\n[Step 6] Syncing old `archived` flag → `isArchived`...");

  const result = await db.collection("projects").updateMany(
    { archived: true },
    {
      $set: {
        isArchived: true,
        archivedAt: new Date(),
      },
    }
  );

  console.log(`  ✔  ${result.modifiedCount} documents synced`);
}

/**
 * Step 7 — Create missing project_configurations.
 * For every project that does not yet have a config document.
 */
async function step7_provisionConfigurations(db) {
  console.log("\n[Step 7] Provisioning missing project_configurations...");

  const projects = await db.collection("projects").find({}, { projection: { _id: 1 } }).toArray();
  const existingConfigs = await db
    .collection("project_configurations")
    .find({}, { projection: { projectId: 1 } })
    .toArray();

  const existingSet = new Set(existingConfigs.map((c) => c.projectId.toString()));

  const toInsert = projects
    .filter((p) => !existingSet.has(p._id.toString()))
    .map((p) => ({
      projectId: p._id,
      settings: buildDefaultSettings(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

  if (toInsert.length > 0) {
    await db.collection("project_configurations").insertMany(toInsert);
    console.log(`  ✔  Created ${toInsert.length} configuration documents`);
  } else {
    console.log("  ✔  All projects already have configurations");
  }
}

/**
 * Step 8 — Rename `workspaceId` → `companyId`
 */
async function step8_renameWorkspaceIdToCompanyId(db) {
  console.log("\n[Step 8] Renaming `workspaceId` → `companyId`...");
  const result = await db
    .collection("projects")
    .updateMany(
      { workspaceId: { $exists: true }, companyId: { $exists: false } },
      { $rename: { workspaceId: "companyId" } }
    );
  console.log(`  ✔  ${result.modifiedCount} documents renamed`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  try {
    await connect();
    const db = mongoose.connection.db;

    console.log("\n══════════════════════════════════════════════");
    console.log("   Project Feature Migration");
    console.log("══════════════════════════════════════════════");

    // Order matters: sync old flags before removing them
    await step6_syncArchivedFlag(db);
    await step1_renameNameToTitle(db);
    await step8_renameWorkspaceIdToCompanyId(db);
    await step2_clearIconString(db);
    await step3_addMissingFlags(db);
    await step4_migrateCreatedBy(db);
    await step5_removeObsoleteFields(db);
    await step7_provisionConfigurations(db);

    console.log("\n══════════════════════════════════════════════");
    console.log("   Migration completed successfully ✔");
    console.log("══════════════════════════════════════════════\n");
  } catch (err) {
    console.error("\n✘  Migration failed:", err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

run();
