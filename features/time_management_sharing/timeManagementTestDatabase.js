const {
  connectLocalMongo,
  closeLocalMongo,
} = require("../../infrastructure/database/local-mongo/local-mongo.connection");
const {
  localMongoConnection,
  isLocalMongoReady,
  LOCAL_MONGO_URI_ENV,
} = require("../../infrastructure/database/database.manager");
const {
  ensureTimeManagementCollections,
} = require("./timeManagementCollections");

/**
 * Opens the local MongoDB connection that the Time Management test suites need,
 * against a throwaway database — never the one the running backend uses.
 *
 * Why this exists: every Time Management model is bound to the local MongoDB
 * connection, not to Mongoose's default (Atlas) connection. A suite that opens
 * only Atlas leaves those models with no connection at all, so each operation
 * sits in Mongoose's buffer for 10s and then throws
 * `Operation \`timemanagementshares.findOne()\` buffering timed out`, while the
 * guarded routes answer 503. Worse, the cleanup in `after` buffers out too, so
 * the suite never finishes closing and `node --test` waits on the child
 * process for ever.
 *
 * The database name is always forced to a test name, so a suite that deletes
 * records in its cleanup can never delete the records of the local database the
 * developer is actually running against. Set `MONGODB_LOCAL_TEST_URI` to choose
 * the database explicitly; with nothing set, `_test` is appended to the name in
 * `MONGODB_LOCAL_URI`, which keeps the same mongod — and therefore the same
 * replica set, which the transactional usage sync needs.
 *
 * Each suite also gets its own database, named after the tag it passes.
 * `node --test` runs the files in parallel, and the delivery scheduler is
 * global: it picks up every due share in the database it is pointed at. Sharing
 * one database across the files therefore lets the scheduling suite create a
 * delivery for the HTTP suite's share, which that suite then counts
 * ("2 !== 1"). Separate databases keep the suites independent of each other,
 * and of whatever a previous run left behind.
 */

/** Chooses the test database explicitly, overriding the derived name. */
const TEST_URI_ENV = "MONGODB_LOCAL_TEST_URI";

/** Splits a connection string into authority, database name and query. */
const URI_PATTERN = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/([^?]*))?(\?.*)?$/;

const parseUri = (uri) => {
  const match = URI_PATTERN.exec(uri || "");
  if (!match) return null;
  return {
    authority: match[1],
    database: match[2] ? decodeURIComponent(match[2]) : "",
    query: match[3] || "",
  };
};

const withDatabaseName = (parsed, name) =>
  `${parsed.authority}/${encodeURIComponent(name)}${parsed.query}`;

/** A database a test suite is allowed to write to and empty afterwards. */
const isTestDatabaseName = (name) => /test/i.test(name);

/**
 * Returns the connection string the suites should use, or `null` when one
 * cannot be formed safely. Never returns a URI whose database is not a test
 * database.
 */
const suffixFor = (suiteTag) =>
  suiteTag ? `_${String(suiteTag).replace(/[^a-z0-9_]+/gi, "_")}` : "";

const resolveTestUri = (suiteTag) => {
  const explicit = process.env[TEST_URI_ENV];
  if (explicit) {
    const parsed = parseUri(explicit);
    if (!parsed || !isTestDatabaseName(parsed.database)) return null;
    return withDatabaseName(parsed, `${parsed.database}${suffixFor(suiteTag)}`);
  }

  const parsed = parseUri(process.env[LOCAL_MONGO_URI_ENV]);
  if (!parsed || !parsed.database) return null;

  const base = isTestDatabaseName(parsed.database)
    ? parsed.database
    : `${parsed.database}_test`;
  return withDatabaseName(parsed, `${base}${suffixFor(suiteTag)}`);
};

/**
 * Opens the connection and creates this feature's collections and indexes, so
 * the first transactional write does not have to create a collection inside a
 * transaction (MongoDB cannot).
 *
 * Returns `true` when the database is ready. Returns `false` — it never throws
 * — when no safe test URI can be formed or mongod is not running, so a suite
 * can skip itself instead of failing on a developer machine with no local
 * MongoDB. `scripts/start-local-mongod.cmd` starts one.
 */
const connectLocalTestDatabase = async (suiteTag) => {
  const uri = resolveTestUri(suiteTag);
  if (!uri) {
    console.error(
      `[tm-test-db] no usable test database: set ${TEST_URI_ENV} to a URI whose database name contains "test", or ${LOCAL_MONGO_URI_ENV} to a local MongoDB`,
    );
    return false;
  }

  // Read by connectLocalMongo, so it has to be set before connecting.
  process.env[LOCAL_MONGO_URI_ENV] = uri;

  try {
    await connectLocalMongo();
    if (!isLocalMongoReady()) return false;
    await ensureTimeManagementCollections();
    return true;
  } catch (err) {
    console.error(
      `[tm-test-db] local MongoDB unavailable, skipping: ${err.message}`,
    );
    return false;
  }
};

/**
 * Closes the connection, so the test process has no open handle left and
 * `node --test` can exit. Safe to call when nothing was ever opened.
 */
const closeLocalTestDatabase = async () => {
  try {
    await closeLocalMongo();
  } catch (err) {
    console.error(`[tm-test-db] error while closing: ${err.message}`);
  }
};

/** The database a suite is pointed at, for a skip message. */
const testDatabaseName = (suiteTag) => {
  const parsed = parseUri(resolveTestUri(suiteTag));
  return parsed ? parsed.database : "(none)";
};

module.exports = {
  TEST_URI_ENV,
  localMongoConnection,
  resolveTestUri,
  isTestDatabaseName,
  testDatabaseName,
  connectLocalTestDatabase,
  closeLocalTestDatabase,
};
