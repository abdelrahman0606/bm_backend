const mongoose = require("mongoose");
const { redactMongoUri, readRequiredUri } = require("../mongoUriUtils");

/** Environment variable holding the MongoDB Atlas connection string. */
const ATLAS_URI_ENV = "MONGODB_URI";

/**
 * The MongoDB Atlas connection.
 *
 * Every feature that predates the dual-database split registers its models with
 * `mongoose.model(...)`, which binds them to Mongoose's default connection.
 * That default connection *is* the Atlas connection, so it is named here rather
 * than re-registered: existing models keep their connection, their collections
 * and their behaviour, and the binding is still explicit to read.
 *
 * `features/tasks_management` keeps its own separate Atlas connection
 * (`TASKS_MONGODB_URI`, see `features/tasks_management/tasksDatabase.js`) and is
 * untouched by this module.
 */
const atlasConnection = mongoose.connection;

let connecting = null;
let listenersBound = false;

/** Validates and returns the Atlas connection string. */
const getAtlasUri = () => readRequiredUri(ATLAS_URI_ENV, "Atlas connection");

const isAtlasReady = () => atlasConnection.readyState === 1;

/** Native driver handle, for the rare operation that needs raw collections. */
const atlasDB = () => atlasConnection.db;

const bindLifecycleListeners = () => {
  if (listenersBound) return;
  listenersBound = true;

  atlasConnection.on("disconnected", () => {
    console.error("[atlas-db] disconnected");
  });
  atlasConnection.on("reconnected", () => {
    console.log("[atlas-db] reconnected");
  });
  atlasConnection.on("error", (err) => {
    console.error("[atlas-db] connection error:", err.message);
  });
};

/**
 * Opens the Atlas connection. Safe to call more than once: a second call
 * returns the in-flight promise instead of opening a duplicate connection.
 */
const connectAtlas = async () => {
  if (isAtlasReady()) return atlasConnection;
  if (connecting) return connecting;

  bindLifecycleListeners();
  const uri = getAtlasUri();

  connecting = mongoose
    .connect(uri)
    .then(() => {
      console.log(
        `[atlas-db] connected to ${redactMongoUri(uri)} (host ${atlasConnection.host})`,
      );
      return atlasConnection;
    })
    .catch((err) => {
      connecting = null;
      throw err;
    });

  return connecting;
};

const closeAtlas = async () => {
  connecting = null;
  if (atlasConnection.readyState === 0) return;
  await atlasConnection.close();
  console.log("[atlas-db] connection closed");
};

module.exports = {
  ATLAS_URI_ENV,
  atlasConnection,
  atlasDB,
  getAtlasUri,
  isAtlasReady,
  connectAtlas,
  closeAtlas,
};
