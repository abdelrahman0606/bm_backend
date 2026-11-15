const {
  localMongoConnection,
  isLocalMongoReady,
} = require("../../infrastructure/database/database.manager");

const TimeManagementShareModel = require("./timeManagementShareModel");
const TimeManagementUsageModel = require("./timeManagementUsageModel");
const TimeManagementSyncBatchModel = require("./timeManagementSyncBatchModel");
const TimeManagementShareDeliveryModel = require("./timeManagementShareDeliveryModel");
const TimeManagementShareLinkModel = require("./timeManagementShareLinkModel");
const TimeManagementDeviceUsageModel = require("./timeManagementDeviceUsageModel");
const TimeManagementDeviceSyncBatchModel = require("./timeManagementDeviceSyncBatchModel");

/** Every collection this feature owns, all on local MongoDB. */
const models = [
  TimeManagementShareModel,
  TimeManagementUsageModel,
  TimeManagementSyncBatchModel,
  TimeManagementShareDeliveryModel,
  TimeManagementShareLinkModel,
  TimeManagementDeviceUsageModel,
  TimeManagementDeviceSyncBatchModel,
];

/**
 * Creates this feature's collections and indexes as soon as local MongoDB is
 * ready, instead of leaving it to the first query.
 *
 * Why it matters: the usage-sync endpoint writes its batch record and the daily
 * totals inside one transaction, and MongoDB cannot create a collection inside
 * a transaction without a write conflict ("Collection namespace … is already in
 * use", code 112, labelled transient). On a database that has never been
 * written — a freshly installed local MongoDB — the very first sync would
 * therefore fail. Creating the collections up front removes that first-use
 * failure, and builds the indexes before the first report query instead of
 * during it.
 *
 * `Model.init()` is memoized by Mongoose, so this is cheap to call again.
 */
let preparing = null;

const ensureTimeManagementCollections = async () => {
  if (!isLocalMongoReady()) return false;
  if (preparing) return preparing;

  preparing = Promise.all(models.map((model) => model.init()))
    .then(() => {
      console.log(
        `[time-management] ${models.length} collections and their indexes are ready`,
      );
      return true;
    })
    .catch((err) => {
      // Not fatal: the feature still works, the first transactional sync may
      // just have to be retried.
      preparing = null;
      console.error(
        `[time-management] could not prepare collections: ${err.message}`,
      );
      return false;
    });

  return preparing;
};

/**
 * Prepares them now if the connection is already open, and again after a
 * reconnect — including the case where local MongoDB was down at startup and
 * the manager's retry loop opened it later.
 */
const prepareTimeManagementCollections = () => {
  localMongoConnection.on("connected", () => {
    preparing = null;
    ensureTimeManagementCollections();
  });
  localMongoConnection.on("reconnected", () => {
    preparing = null;
    ensureTimeManagementCollections();
  });

  return ensureTimeManagementCollections();
};

module.exports = {
  ensureTimeManagementCollections,
  prepareTimeManagementCollections,
};
