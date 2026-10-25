const {
  ATLAS_URI_ENV,
  atlasConnection,
  atlasDB,
  getAtlasUri,
  isAtlasReady,
  connectAtlas,
  closeAtlas,
} = require("./atlas/atlas.connection");
const {
  LOCAL_MONGO_URI_ENV,
  localMongoConnection,
  localMongoDB,
  getLocalMongoUri,
  isLocalMongoReady,
  connectLocalMongo,
  closeLocalMongo,
} = require("./local-mongo/local-mongo.connection");

/**
 * Owns the lifecycle of the two database connections this backend uses.
 *
 *   atlasConnection      — MongoDB Atlas: every feature except Time Management
 *   localMongoConnection — local MongoDB Community Server: Time Management only
 *
 * The two are independent on purpose. Neither is a fallback for the other, so a
 * failure on one side can never move reads or writes to the other database.
 *
 * `features/tasks_management` holds a third, separate Atlas connection of its
 * own (`TASKS_MONGODB_URI`) that predates this module and is left untouched.
 */

/** How often a failed local MongoDB connection is retried in the background. */
const LOCAL_RETRY_INTERVAL_MS = 10 * 1000;

let initializing = null;
let localRetryTimer = null;

/**
 * Checks that both connection strings are configured, before anything connects.
 * Throws naming the missing variable only — never a value.
 */
const validateDatabaseConfiguration = () => {
  getAtlasUri();
  getLocalMongoUri();
};

const stopLocalRetry = () => {
  if (localRetryTimer) {
    clearInterval(localRetryTimer);
    localRetryTimer = null;
  }
};

/**
 * Keeps trying to open the local connection after a failed startup attempt.
 * Time Management stays unavailable (and says so) until this succeeds; it is
 * never served from Atlas in the meantime.
 */
const startLocalRetry = () => {
  if (localRetryTimer) return;

  localRetryTimer = setInterval(() => {
    if (isLocalMongoReady()) {
      stopLocalRetry();
      return;
    }
    connectLocalMongo()
      .then(() => stopLocalRetry())
      .catch((err) => {
        console.error(
          `[database] local MongoDB still unavailable: ${err.message}`,
        );
      });
  }, LOCAL_RETRY_INTERVAL_MS);

  // The retry loop must not hold the event loop open on its own.
  if (localRetryTimer.unref) localRetryTimer.unref();
};

/**
 * Opens both connections, in a fixed order: Atlas first, because the whole API
 * depends on it, then local MongoDB.
 *
 * Atlas is fatal — the caller is expected to stop the process, which is what
 * the previous `config/database.js` did. A local MongoDB failure is reported
 * and retried instead: the rest of the API keeps serving Atlas normally while
 * the Time Management endpoints answer 503 until the local database is ready.
 * Set `MONGODB_LOCAL_REQUIRED=true` to make a local failure fatal too.
 *
 * Safe to call more than once: a second call returns the first call's promise,
 * so no duplicate connection is ever opened.
 */
const initializeDatabases = async () => {
  if (initializing) return initializing;

  const attempt = (async () => {
    validateDatabaseConfiguration();

    try {
      await connectAtlas();
    } catch (err) {
      console.error(`[database] Atlas connection failed: ${err.message}`);
      console.error(
        `[database] check ${ATLAS_URI_ENV}; no operation is redirected to local MongoDB`,
      );
      throw err;
    }

    try {
      await connectLocalMongo();
    } catch (err) {
      console.error(`[database] local MongoDB connection failed: ${err.message}`);
      console.error(
        `[database] check ${LOCAL_MONGO_URI_ENV} and that mongod is running; Time Management stays unavailable and is never served from Atlas`,
      );

      if (process.env.MONGODB_LOCAL_REQUIRED === "true") {
        throw err;
      }

      startLocalRetry();
    }

    return { atlasConnection, localMongoConnection };
  })();

  // A failed attempt must not be cached, so startup can be retried.
  initializing = attempt.catch((err) => {
    initializing = null;
    throw err;
  });

  return initializing;
};

/** Closes both connections, for a graceful process shutdown. */
const closeDatabases = async () => {
  stopLocalRetry();
  initializing = null;

  // Each connection is closed on its own: a failure on one must not leave the
  // other open.
  try {
    await closeAtlas();
  } catch (err) {
    console.error(`[database] error while closing Atlas: ${err.message}`);
  }

  try {
    await closeLocalMongo();
  } catch (err) {
    console.error(`[database] error while closing local MongoDB: ${err.message}`);
  }
};

module.exports = {
  // Connections, named after the database they talk to.
  atlasConnection,
  localMongoConnection,
  // Native driver handles.
  atlasDB,
  localMongoDB,
  // Lifecycle.
  validateDatabaseConfiguration,
  initializeDatabases,
  closeDatabases,
  isAtlasReady,
  isLocalMongoReady,
  // Environment variable names, so callers can report configuration problems.
  ATLAS_URI_ENV,
  LOCAL_MONGO_URI_ENV,
};
