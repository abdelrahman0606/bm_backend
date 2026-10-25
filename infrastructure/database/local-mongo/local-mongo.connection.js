const mongoose = require("mongoose");
const { redactMongoUri, readRequiredUri } = require("../mongoUriUtils");

/** Environment variable holding the local MongoDB Community Server string. */
const LOCAL_MONGO_URI_ENV = "MONGODB_LOCAL_URI";

/** A local server either answers immediately or is not running. */
const SERVER_SELECTION_TIMEOUT_MS = 5000;

/**
 * The local MongoDB connection, used by the Time Management feature only.
 *
 * The connection object is created unconnected so feature models can register
 * on it at require time — the pattern
 * `features/tasks_management/tasksDatabase.js` already follows — while the
 * socket is opened once, in a controlled order, by `connectLocalMongo()`.
 *
 * This connection is never a fallback for Atlas and Atlas is never a fallback
 * for it: a model registered here can only ever read and write the local
 * database, and if that database is down its operations fail instead of
 * silently landing in Atlas.
 */
const localMongoConnection = mongoose.createConnection();

let connecting = null;
let listenersBound = false;

/** Validates and returns the local MongoDB connection string. */
const getLocalMongoUri = () =>
  readRequiredUri(LOCAL_MONGO_URI_ENV, "local MongoDB connection");

const isLocalMongoReady = () => localMongoConnection.readyState === 1;

/** Native driver handle, for the rare operation that needs raw collections. */
const localMongoDB = () => localMongoConnection.db;

const bindLifecycleListeners = () => {
  if (listenersBound) return;
  listenersBound = true;

  localMongoConnection.on("disconnected", () => {
    console.error("[local-mongo-db] disconnected");
  });
  localMongoConnection.on("reconnected", () => {
    console.log("[local-mongo-db] reconnected");
  });
  localMongoConnection.on("error", (err) => {
    console.error("[local-mongo-db] connection error:", err.message);
  });
};

/**
 * Opens the local MongoDB connection. Safe to call more than once: a second
 * call returns the in-flight promise instead of opening a duplicate connection.
 */
const connectLocalMongo = async () => {
  if (isLocalMongoReady()) return localMongoConnection;
  if (connecting) return connecting;

  bindLifecycleListeners();
  const uri = getLocalMongoUri();

  connecting = localMongoConnection
    .openUri(uri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS })
    .then(() => {
      console.log(
        `[local-mongo-db] connected to ${redactMongoUri(uri)} (database ${localMongoConnection.name})`,
      );
      return localMongoConnection;
    })
    .catch((err) => {
      connecting = null;
      throw err;
    });

  return connecting;
};

const closeLocalMongo = async () => {
  connecting = null;
  if (localMongoConnection.readyState === 0) return;
  await localMongoConnection.close();
  console.log("[local-mongo-db] connection closed");
};

module.exports = {
  LOCAL_MONGO_URI_ENV,
  localMongoConnection,
  localMongoDB,
  getLocalMongoUri,
  isLocalMongoReady,
  connectLocalMongo,
  closeLocalMongo,
};
