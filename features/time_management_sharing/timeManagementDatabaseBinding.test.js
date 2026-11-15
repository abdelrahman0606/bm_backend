const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config({ path: path.join(__dirname, "../../config.env") });

const {
  atlasConnection,
  localMongoConnection,
  isAtlasReady,
  isLocalMongoReady,
  validateDatabaseConfiguration,
  initializeDatabases,
  ATLAS_URI_ENV,
  LOCAL_MONGO_URI_ENV,
} = require("../../infrastructure/database/database.manager");
const {
  connectLocalMongo,
  closeLocalMongo,
  getLocalMongoUri,
} = require("../../infrastructure/database/local-mongo/local-mongo.connection");
const { redactMongoUri } = require("../../infrastructure/database/mongoUriUtils");
const { requireLocalMongoReady } = require("./timeManagementDatabaseGuard");

const TimeManagementShareModel = require("./timeManagementShareModel");
const TimeManagementUsageModel = require("./timeManagementUsageModel");
const TimeManagementSyncBatchModel = require("./timeManagementSyncBatchModel");
const TimeManagementShareDeliveryModel = require("./timeManagementShareDeliveryModel");
const TimeManagementShareLinkModel = require("./timeManagementShareLinkModel");

const UserModel = require("../users/userModel");
const CompanyModel = require("../companies/companyModel");
const NotificationModel = require("../notifications/notificationModel");

/**
 * Guards the dual-database split: Time Management on local MongoDB, every other
 * feature on Atlas.
 *
 * Everything except the CRUD case runs with no database reachable — model
 * registration, connection identity and the lifecycle helpers are all local
 * decisions. The CRUD case needs a running local MongoDB and skips itself when
 * there is none, so the suite never touches Atlas data.
 */
describe("Dual database architecture: Atlas and local MongoDB", () => {
  const timeManagementModels = [
    ["TimeManagementShare", TimeManagementShareModel, "timemanagementshares"],
    ["TimeManagementUsage", TimeManagementUsageModel, "timemanagementusages"],
    [
      "TimeManagementSyncBatch",
      TimeManagementSyncBatchModel,
      "timemanagementsyncbatches",
    ],
    [
      "TimeManagementShareDelivery",
      TimeManagementShareDeliveryModel,
      "timemanagementsharedeliveries",
    ],
    [
      "TimeManagementShareLink",
      TimeManagementShareLinkModel,
      "timemanagementsharelinks",
    ],
  ];

  const atlasModels = [
    ["User", UserModel],
    ["Company", CompanyModel],
    ["Notification", NotificationModel],
  ];

  let localAvailable = false;
  const createdFilterIds = [];

  before(async () => {
    // Opening the local connection must not require Atlas, and vice versa.
    try {
      await connectLocalMongo();
      localAvailable = isLocalMongoReady();
    } catch {
      localAvailable = false;
    }
  });

  after(async () => {
    if (localAvailable && createdFilterIds.length > 0) {
      await TimeManagementShareModel.deleteMany({
        filterId: { $in: createdFilterIds },
      });
    }
    if (localAvailable) {
      await closeLocalMongo();
    }
  });

  // 1. Both connections initialize independently
  test("the two connections are separate objects with separate lifecycles", () => {
    assert.notStrictEqual(
      localMongoConnection,
      atlasConnection,
      "local MongoDB must not reuse the Atlas connection"
    );
    assert.strictEqual(
      atlasConnection,
      mongoose.connection,
      "Atlas is Mongoose's default connection, which existing models are bound to"
    );
    // Connecting local MongoDB in `before` must not have opened Atlas.
    assert.strictEqual(
      isAtlasReady(),
      false,
      "opening local MongoDB must not open Atlas"
    );
  });

  test("opening the local connection twice does not create a second connection", async (t) => {
    if (!localAvailable) {
      return t.skip("local MongoDB is not reachable");
    }
    const first = await connectLocalMongo();
    const second = await connectLocalMongo();
    assert.strictEqual(first, second);
    assert.strictEqual(first, localMongoConnection);
  });

  // 2. Time Management models are registered on local MongoDB
  test("every Time Management model is registered on localMongoConnection", () => {
    for (const [name, model, collection] of timeManagementModels) {
      assert.strictEqual(
        model.db,
        localMongoConnection,
        `${name} must be bound to localMongoConnection`
      );
      assert.notStrictEqual(
        model.db,
        atlasConnection,
        `${name} must not be bound to the Atlas connection`
      );
      assert.strictEqual(
        model.collection.name,
        collection,
        `${name} must keep its existing collection name`
      );
      assert.ok(
        localMongoConnection.models[name],
        `${name} must appear in localMongoConnection.models`
      );
      assert.strictEqual(
        mongoose.models[name],
        undefined,
        `${name} must never be registered on the default (Atlas) connection`
      );
    }
  });

  test("requiring a model twice returns the same compiled model", () => {
    const {
      createTimeManagementShareModel,
    } = require("./timeManagementShareModel");
    assert.strictEqual(
      createTimeManagementShareModel(),
      TimeManagementShareModel,
      "the models guard must prevent recompilation"
    );
    assert.doesNotThrow(() => createTimeManagementShareModel());
  });

  // 3. Time Management CRUD reads and writes the local database
  test("create, read, update and delete happen in the local database", async (t) => {
    if (!localAvailable) {
      return t.skip("local MongoDB is not reachable");
    }

    const filterId = `db-binding-${Date.now()}`;
    createdFilterIds.push(filterId);

    const share = await TimeManagementShareModel.create({
      senderUserId: new mongoose.Types.ObjectId(),
      recipientUserId: new mongoose.Types.ObjectId(),
      shareScope: "personal",
      filterId,
      filterName: "Database binding probe",
      filterDefinition: { probe: true },
      status: "accepted",
    });

    // Read it back through the local connection's native driver: proof the
    // write landed in the local database, not somewhere Mongoose chose.
    const raw = await localMongoConnection.db
      .collection("timemanagementshares")
      .findOne({ _id: share._id });
    assert.ok(raw, "the document must exist in the local database");
    assert.strictEqual(raw.filterId, filterId);

    // 9. Existing response shape is unchanged: _id is still exposed as `id`.
    const serialized = share.toJSON();
    assert.strictEqual(serialized.id.toString(), share._id.toString());
    assert.strictEqual(serialized._id, undefined);
    assert.ok(serialized.createdAt instanceof Date, "timestamps still apply");

    share.filterName = "Database binding probe (updated)";
    await share.save();
    const updated = await TimeManagementShareModel.findById(share._id).lean();
    assert.strictEqual(updated.filterName, "Database binding probe (updated)");

    await TimeManagementShareModel.deleteOne({ _id: share._id });
    assert.strictEqual(await TimeManagementShareModel.findById(share._id), null);
  });

  // 4. Existing features keep reading and writing Atlas
  test("non-Time-Management models stay on the Atlas connection", () => {
    for (const [name, model] of atlasModels) {
      assert.strictEqual(
        model.db,
        atlasConnection,
        `${name} must stay on the Atlas connection`
      );
      assert.strictEqual(
        localMongoConnection.models[name],
        undefined,
        `${name} must never be registered on local MongoDB`
      );
    }
  });

  test("user references are populated through the Atlas-bound model", () => {
    const service = require("./timeManagementSharingService");
    const { populateSender, populateRecipient } =
      service.populateOptionsForTest;

    for (const option of [populateSender, populateRecipient]) {
      assert.strictEqual(
        option.model,
        UserModel,
        "populate must name the Atlas model explicitly: MongoDB cannot join across deployments"
      );
      assert.strictEqual(option.model.db, atlasConnection);
      assert.strictEqual(option.select, "fullName email photo role");
    }
  });

  // 5. Identical model names cannot be reused across connections
  test("the same model name on both connections yields two distinct models", () => {
    const probeSchema = new mongoose.Schema({ value: String });
    const onAtlas = atlasConnection.model("CrossConnectionProbe", probeSchema);
    const onLocal = localMongoConnection.model(
      "CrossConnectionProbe",
      probeSchema
    );

    assert.notStrictEqual(
      onAtlas,
      onLocal,
      "a name registered on both connections must resolve to two models"
    );
    assert.strictEqual(onAtlas.db, atlasConnection);
    assert.strictEqual(onLocal.db, localMongoConnection);

    atlasConnection.deleteModel("CrossConnectionProbe");
    localMongoConnection.deleteModel("CrossConnectionProbe");
  });

  // 6. A local MongoDB failure does not redirect anything to Atlas
  test("Time Management requests are refused while local MongoDB is down", async () => {
    await closeLocalMongo();
    assert.strictEqual(isLocalMongoReady(), false);

    let forwarded = null;
    requireLocalMongoReady({}, {}, (err) => {
      forwarded = err;
    });

    assert.ok(forwarded, "the guard must refuse the request");
    assert.strictEqual(forwarded.statusCode, 503);
    assert.match(forwarded.message, /unavailable/i);

    // The binding itself never moves: the model still points at local MongoDB.
    assert.strictEqual(TimeManagementShareModel.db, localMongoConnection);
    assert.notStrictEqual(TimeManagementShareModel.db, atlasConnection);

    if (localAvailable) {
      await connectLocalMongo();
    }
  });

  test("the guard lets requests through once local MongoDB is ready", async (t) => {
    if (!localAvailable) {
      return t.skip("local MongoDB is not reachable");
    }
    await connectLocalMongo();

    let forwarded = "not called";
    requireLocalMongoReady({}, {}, (err) => {
      forwarded = err;
    });
    assert.strictEqual(forwarded, undefined, "next() must be called with no error");
  });

  // 7. An Atlas failure does not redirect Atlas operations to local MongoDB
  test("Atlas models cannot resolve against the local connection", () => {
    assert.strictEqual(localMongoConnection.models.User, undefined);
    assert.throws(
      () => localMongoConnection.model("User"),
      /registered for model/,
      "asking local MongoDB for an Atlas model must fail loudly, not silently"
    );
  });

  // 8. Startup and shutdown handle both connections
  test("startup validates both connection strings before connecting", () => {
    const savedAtlas = process.env[ATLAS_URI_ENV];
    const savedLocal = process.env[LOCAL_MONGO_URI_ENV];

    try {
      delete process.env[LOCAL_MONGO_URI_ENV];
      assert.throws(
        () => validateDatabaseConfiguration(),
        new RegExp(LOCAL_MONGO_URI_ENV),
        "a missing local URI must be reported by name"
      );
      assert.throws(() => getLocalMongoUri(), new RegExp(LOCAL_MONGO_URI_ENV));

      process.env[LOCAL_MONGO_URI_ENV] = savedLocal || "mongodb://127.0.0.1:27017/x";
      delete process.env[ATLAS_URI_ENV];
      assert.throws(
        () => validateDatabaseConfiguration(),
        new RegExp(ATLAS_URI_ENV),
        "a missing Atlas URI must be reported by name"
      );
    } finally {
      if (savedAtlas === undefined) delete process.env[ATLAS_URI_ENV];
      else process.env[ATLAS_URI_ENV] = savedAtlas;
      if (savedLocal === undefined) delete process.env[LOCAL_MONGO_URI_ENV];
      else process.env[LOCAL_MONGO_URI_ENV] = savedLocal;
    }
  });

  test("initialization refuses to start with configuration missing", async () => {
    const savedAtlas = process.env[ATLAS_URI_ENV];
    try {
      delete process.env[ATLAS_URI_ENV];
      await assert.rejects(
        () => initializeDatabases(),
        new RegExp(ATLAS_URI_ENV)
      );
    } finally {
      if (savedAtlas === undefined) delete process.env[ATLAS_URI_ENV];
      else process.env[ATLAS_URI_ENV] = savedAtlas;
    }
  });

  test("a closed local connection reports itself closed", async () => {
    await closeLocalMongo();
    assert.strictEqual(localMongoConnection.readyState, 0);
    if (localAvailable) {
      await connectLocalMongo();
      assert.strictEqual(localMongoConnection.readyState, 1);
    }
  });

  test("connection logs never carry credentials", () => {
    assert.strictEqual(
      redactMongoUri("mongodb+srv://user:s3cret@cluster.mongodb.net/bm?retryWrites=true"),
      "mongodb+srv://cluster.mongodb.net/bm"
    );
    assert.strictEqual(
      redactMongoUri("mongodb://tm_app:p%40ss@127.0.0.1:27017/time_management_db"),
      "mongodb://127.0.0.1:27017/time_management_db"
    );
    assert.strictEqual(redactMongoUri(undefined), "(unset)");
  });

  // 10. Large-data queries are supported by declared indexes, with no duplicates
  test("the hot Time Management queries are covered by exactly one index each", () => {
    const indexKeys = (schema) =>
      schema.indexes().map(([key]) => JSON.stringify(key));

    const shareIndexes = indexKeys(TimeManagementShareModel.schema);
    assert.ok(
      shareIndexes.includes(
        JSON.stringify({ shareMode: 1, status: 1, nextRunAt: 1 })
      ),
      "the scheduler's due-share query must be indexed"
    );

    const usageIndexes = indexKeys(TimeManagementUsageModel.schema);
    assert.ok(
      usageIndexes.includes(
        JSON.stringify({
          senderUserId: 1,
          recipientUserId: 1,
          filterId: 1,
          date: 1,
        })
      ),
      "the daily usage uniqueness key must be indexed"
    );
    assert.ok(
      usageIndexes.includes(JSON.stringify({ recipientUserId: 1, date: 1 })),
      "the recipient report range query must be indexed"
    );

    const deliveryIndexes = indexKeys(TimeManagementShareDeliveryModel.schema);
    assert.ok(
      deliveryIndexes.includes(
        JSON.stringify({ shareId: 1, occurrenceKey: 1 })
      ),
      "the duplicate-delivery guard must be indexed"
    );

    for (const [name, model] of timeManagementModels) {
      const keys = indexKeys(model.schema);
      assert.strictEqual(
        keys.length,
        new Set(keys).size,
        `${name} must not declare the same index twice`
      );
    }
  });
});
