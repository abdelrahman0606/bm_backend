const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config({ path: path.join(__dirname, "config.env") });

const {
  getAtlasUri,
} = require("./infrastructure/database/atlas/atlas.connection");
const {
  getLocalMongoUri,
} = require("./infrastructure/database/local-mongo/local-mongo.connection");
const { redactMongoUri } = require("./infrastructure/database/mongoUriUtils");

/**
 * Copies the Time Management collections from MongoDB Atlas to the local
 * MongoDB Community Server, after the feature was moved to the local database.
 *
 * Properties this script is built around:
 *   * Nothing in Atlas is modified or deleted — it stays a complete fallback.
 *   * Documents are copied with their `_id`, so every id and every reference
 *     between Time Management documents survives unchanged.
 *   * Writes are `replaceOne` upserts keyed by `_id`, so re-running after a
 *     failure can never create duplicates.
 *   * Documents are streamed in batches, so a large collection is never loaded
 *     into application memory.
 *   * It is a dry run unless `--confirm` is passed.
 *
 * Usage:
 *   node migrateTimeManagementToLocalMongo.js            # report only
 *   node migrateTimeManagementToLocalMongo.js --confirm   # copy
 */

const COLLECTIONS = [
  "timemanagementshares",
  "timemanagementusages",
  "timemanagementsyncbatches",
  "timemanagementsharedeliveries",
  "timemanagementsharelinks",
];

const BATCH_SIZE = 500;

const confirmed = process.argv.includes("--confirm");

const copyCollection = async (sourceDb, targetDb, name) => {
  const sourceCount = await sourceDb.collection(name).countDocuments();
  const targetCountBefore = await targetDb.collection(name).countDocuments();

  if (!confirmed || sourceCount === 0) {
    return { name, sourceCount, targetCountBefore, copied: 0, targetCount: targetCountBefore };
  }

  const cursor = sourceDb.collection(name).find({}).batchSize(BATCH_SIZE);
  let buffer = [];
  let copied = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    await targetDb.collection(name).bulkWrite(
      buffer.map((doc) => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      })),
      { ordered: false },
    );
    copied += buffer.length;
    buffer = [];
  };

  // eslint-disable-next-line no-await-in-loop
  for await (const doc of cursor) {
    buffer.push(doc);
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();

  const targetCount = await targetDb.collection(name).countDocuments();
  return { name, sourceCount, targetCountBefore, copied, targetCount };
};

const migrate = async () => {
  const atlasUri = getAtlasUri();
  const localUri = getLocalMongoUri();

  console.log(`Source (Atlas):       ${redactMongoUri(atlasUri)}`);
  console.log(`Target (local Mongo): ${redactMongoUri(localUri)}`);
  console.log(
    confirmed
      ? "Mode: COPY (Atlas is read only; nothing there is deleted)"
      : "Mode: DRY RUN (pass --confirm to copy)",
  );

  const atlas = await mongoose.createConnection(atlasUri).asPromise();
  const local = await mongoose
    .createConnection(localUri, { serverSelectionTimeoutMS: 5000 })
    .asPromise();

  try {
    const results = [];
    for (const name of COLLECTIONS) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await copyCollection(atlas.db, local.db, name));
    }

    console.log("\ncollection                       atlas   local(before)   copied   local(after)");
    for (const r of results) {
      console.log(
        `${r.name.padEnd(32)}${String(r.sourceCount).padEnd(8)}${String(
          r.targetCountBefore,
        ).padEnd(16)}${String(r.copied).padEnd(9)}${r.targetCount}`,
      );
    }

    if (confirmed) {
      const incomplete = results.filter((r) => r.targetCount < r.sourceCount);
      if (incomplete.length > 0) {
        console.error(
          `\n❌ Verification failed for: ${incomplete.map((r) => r.name).join(", ")}`,
        );
        process.exitCode = 1;
      } else {
        console.log("\n✅ Every source document is present in the local database");
      }
    }
  } finally {
    await atlas.close().catch(() => {});
    await local.close().catch(() => {});
  }
};

migrate().catch((err) => {
  console.error(`Migration failed: ${err.message}`);
  process.exit(1);
});
