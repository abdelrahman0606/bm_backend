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

/**
 * How many times startup tries to open the Atlas connection before giving up,
 * and how long it waits between tries.
 *
 * A single failed attempt is not evidence that Atlas is unreachable: an SRV
 * lookup that resolves while the follow-up lookup for one shard host does not
 * ("getaddrinfo ENOTFOUND ac-…-shard-00-01.…mongodb.net") is a momentary
 * resolver hiccup, and one of those used to be enough to abort the whole
 * process. The delay grows between attempts, capped, so a brief outage costs a
 * few seconds of startup instead of a crash.
 *
 * Both are overridable, for a deployment that would rather fail fast
 * (`MONGODB_ATLAS_STARTUP_ATTEMPTS=1`) or wait longer.
 */
const ATLAS_STARTUP_ATTEMPTS = 5;
const ATLAS_RETRY_BASE_DELAY_MS = 1000;
const ATLAS_RETRY_MAX_DELAY_MS = 8 * 1000;

/**
 * Reads a positive integer from the environment, falling back to `fallback`
 * when the variable is unset or not a usable number.
 */
const readPositiveInt = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    console.error(
      `[database] ignoring ${name}="${raw}": expected a positive integer, using ${fallback}`,
    );
    return fallback;
  }
  return value;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decides whether a failed Atlas attempt is worth repeating.
 *
 * Retried: DNS, network and server-selection failures, which are the ones that
 * pass on their own. Not retried: a connection string the driver cannot parse,
 * and credentials Atlas rejects — those fail identically every time, so
 * repeating them only delays an error the operator has to act on. Atlas
 * reports bad credentials through a server-selection error, so the message is
 * checked as well as the error name.
 */
const isRetryableAtlasError = (err) => {
  const message = (err && err.message) || "";

  if (/bad auth|authentication failed|not authorized/i.test(message)) {
    return false;
  }

  const name = (err && err.name) || "";
  if (name === "MongoParseError") return false;

  return (
    name === "MongooseServerSelectionError" ||
    name === "MongoServerSelectionError" ||
    name === "MongoNetworkError" ||
    name === "MongoNetworkTimeoutError" ||
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|querySrv/i.test(
      message,
    )
  );
};

/**
 * Opens the Atlas connection, retrying a transient failure a bounded number of
 * times. Throws the last error once the attempts are spent, so the caller's
 * contract is unchanged: Atlas is still fatal, just no longer fatal on the
 * first DNS blip.
 */
const connectAtlasWithRetry = async () => {
  const attempts = readPositiveInt(
    "MONGODB_ATLAS_STARTUP_ATTEMPTS",
    ATLAS_STARTUP_ATTEMPTS,
  );
  const baseDelay = readPositiveInt(
    "MONGODB_ATLAS_STARTUP_RETRY_DELAY_MS",
    ATLAS_RETRY_BASE_DELAY_MS,
  );

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connectAtlas();
    } catch (err) {
      const canRetry = attempt < attempts && isRetryableAtlasError(err);
      if (!canRetry) throw err;

      const wait = Math.min(
        baseDelay * 2 ** (attempt - 1),
        ATLAS_RETRY_MAX_DELAY_MS,
      );
      console.error(
        `[database] Atlas attempt ${attempt}/${attempts} failed: ${err.message}`,
      );
      console.error(`[database] retrying Atlas in ${wait}ms`);
      await delay(wait);
    }
  }
};

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
 * Atlas is fatal once its attempts are spent — the caller is expected to stop
 * the process, which is what the previous `config/database.js` did. A
 * transient Atlas failure (DNS, network, server selection) is retried first,
 * up to `MONGODB_ATLAS_STARTUP_ATTEMPTS` times; a rejected credential or an
 * unparseable connection string is not retried at all.
 *
 * A local MongoDB failure is reported
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
      await connectAtlasWithRetry();
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
  // Exported for the startup-retry tests; the server goes through
  // initializeDatabases, never these directly.
  readPositiveInt,
  isRetryableAtlasError,
  connectAtlasWithRetry,
  ATLAS_STARTUP_ATTEMPTS,
  ATLAS_RETRY_BASE_DELAY_MS,
  ATLAS_RETRY_MAX_DELAY_MS,
};
