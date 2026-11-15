const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config({ path: path.join(__dirname, "../../config.env") });

// The integration cases below clear these collections between tests, so they
// only ever run against a database that is explicitly a test database:
// `MONGODB_SYNC_TEST_URI` must be set and its database name must contain
// "test". Without it they skip. That makes it impossible for `npm test` on a
// server to wipe real usage data, and it never touches Atlas.
const testUri = process.env.MONGODB_SYNC_TEST_URI;
const testDatabaseName = testUri
  ? (testUri.split("?")[0].split("/").pop() || "")
  : "";
const usesTestDatabase = /test/i.test(testDatabaseName);
if (usesTestDatabase) process.env.MONGODB_LOCAL_URI = testUri;

const {
  connectLocalMongo,
  closeLocalMongo,
} = require("../../infrastructure/database/local-mongo/local-mongo.connection");
const {
  localMongoConnection,
} = require("../../infrastructure/database/database.manager");

const deviceUsageService = require("./timeManagementDeviceUsageService");
const TimeManagementDeviceUsageModel = require("./timeManagementDeviceUsageModel");
const TimeManagementDeviceSyncBatchModel = require("./timeManagementDeviceSyncBatchModel");
const TimeManagementShareModel = require("./timeManagementShareModel");
const { normalizeAppId } = require("./timeManagementAppIdentity");

const MINUTE = 60 * 1000;

/**
 * Device usage synchronization: incremental uploads, idempotent processing and
 * multi-device aggregation.
 *
 * The first group is pure and always runs — it pins the property the whole
 * design rests on, that a contribution is *set* under a revision guard and
 * never added to a running total. The rest needs a MongoDB and skips itself
 * when none is reachable.
 */
describe("Device usage synchronization", () => {
  const deviceA = {
    deviceId: "device-a-0000",
    deviceName: "Desktop A",
    platform: "windows",
    timezoneOffsetMinutes: 180,
  };
  const deviceB = {
    deviceId: "device-b-0000",
    deviceName: "Desktop B",
    platform: "windows",
    timezoneOffsetMinutes: 180,
  };

  const DATE = "2026-10-25";
  let dbAvailable = false;
  let userId;
  let otherUserId;

  /** One snapshot item as the Flutter client sends it. */
  const item = ({
    localId = "1",
    appName = "Chrome.exe",
    date = DATE,
    revision,
    minutes,
    windows,
  }) => ({
    localId,
    appName,
    date,
    revision,
    totalDuration: minutes * MINUTE,
    ...(windows ? { windows } : {}),
  });

  const sync = (user, device, batchId, items) =>
    deviceUsageService.syncDeviceUsage(user, {
      batchId,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: device.platform,
      timezoneOffsetMinutes: device.timezoneOffsetMinutes,
      items,
    });

  const storedMinutes = async (user, filter = {}) => {
    const rows = await TimeManagementDeviceUsageModel.find({
      userId: user,
      ...filter,
    }).lean();
    return rows.reduce((sum, row) => sum + row.totalDuration, 0) / MINUTE;
  };

  before(async () => {
    if (!usesTestDatabase) {
      dbAvailable = false;
      return;
    }
    try {
      await connectLocalMongo();
      await TimeManagementDeviceUsageModel.init();
      await TimeManagementDeviceSyncBatchModel.init();
      dbAvailable = localMongoConnection.readyState === 1;
    } catch {
      dbAvailable = false;
    }
  });

  after(async () => {
    if (dbAvailable) {
      await TimeManagementDeviceUsageModel.deleteMany({});
      await TimeManagementDeviceSyncBatchModel.deleteMany({});
      await TimeManagementShareModel.deleteMany({});
      await closeLocalMongo();
    }
  });

  beforeEach(async () => {
    userId = new mongoose.Types.ObjectId();
    otherUserId = new mongoose.Types.ObjectId();
    if (dbAvailable) {
      await TimeManagementDeviceUsageModel.deleteMany({});
      await TimeManagementDeviceSyncBatchModel.deleteMany({});
      await TimeManagementShareModel.deleteMany({});
    }
  });

  // -------------------------------------------------------------------------
  // Pure: the write contract
  // -------------------------------------------------------------------------

  test("a contribution is set under a revision guard, never incremented", () => {
    const { operations } = deviceUsageService.buildSnapshotOperations(
      new mongoose.Types.ObjectId(),
      deviceA,
      [item({ revision: 4, minutes: 45 })]
    );

    assert.strictEqual(operations.length, 1);
    const serialized = JSON.stringify(operations[0].updateOne.update);
    assert.ok(!serialized.includes("$inc"), "a total must never be incremented");
    assert.ok(serialized.includes("$gt"), "the write must be revision-guarded");
    assert.ok(serialized.includes("$max"), "revision must only move forward");
    assert.strictEqual(operations[0].updateOne.upsert, true);
    // Identity is the client's record, not the normalized application id.
    assert.deepStrictEqual(Object.keys(operations[0].updateOne.filter).sort(), [
      "appKey",
      "date",
      "deviceId",
      "userId",
    ]);
  });

  test("application ids normalize consistently across devices", () => {
    assert.strictEqual(normalizeAppId("Code.exe"), "code");
    assert.strictEqual(normalizeAppId("code.EXE"), "code");
    assert.strictEqual(normalizeAppId("  Google Chrome "), "google-chrome");
    assert.strictEqual(normalizeAppId("Safari.app"), "safari");
    assert.strictEqual(normalizeAppId(""), "");
  });

  test("an item whose name cannot be normalized is rejected, not dropped silently", () => {
    const { operations, rejected } = deviceUsageService.buildSnapshotOperations(
      new mongoose.Types.ObjectId(),
      deviceA,
      [item({ appName: "???", revision: 1, minutes: 5 })]
    );
    assert.strictEqual(operations.length, 0);
    assert.strictEqual(rejected.length, 1);
    assert.strictEqual(rejected[0].status, "rejected");
    assert.match(rejected[0].reason, /normaliz/i);
  });

  test("two records that normalize to one application stay separate contributions", () => {
    const { preparedItems } = deviceUsageService.buildSnapshotOperations(
      new mongoose.Types.ObjectId(),
      deviceA,
      [
        item({ localId: "1", appName: "Chrome.exe", revision: 1, minutes: 10 }),
        item({ localId: "2", appName: "chrome.exe", revision: 1, minutes: 5 }),
      ]
    );
    // Same appId, different appKey: both are stored and summed at read time,
    // instead of one overwriting the other.
    assert.strictEqual(preparedItems.length, 2);
    assert.strictEqual(preparedItems[0].appId, preparedItems[1].appId);
    assert.notStrictEqual(preparedItems[0].appKey, preparedItems[1].appKey);
  });

  // -------------------------------------------------------------------------
  // Integration
  // -------------------------------------------------------------------------

  test("1. the first synchronization stores the device's records", async (t) => {
    if (!dbAvailable) return t.skip("set MONGODB_SYNC_TEST_URI to a test database");

    const ack = await sync(userId, deviceA, "batch-initial-0001", [
      item({ localId: "1", appName: "Chrome.exe", revision: 1, minutes: 30 }),
      item({ localId: "2", appName: "Code.exe", revision: 1, minutes: 12 }),
    ]);

    assert.strictEqual(ack.status, "completed");
    assert.strictEqual(ack.appliedCount, 2);
    assert.strictEqual(ack.rejectedCount, 0);
    assert.deepStrictEqual(
      ack.results.map((r) => r.localId).sort(),
      ["1", "2"]
    );
    assert.strictEqual(await storedMinutes(userId), 42);
  });

  test("2. only changed records are uploaded, and untouched rows keep their revision", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    await sync(userId, deviceA, "batch-incr-0001", [
      item({ localId: "1", appName: "Chrome.exe", revision: 1, minutes: 30 }),
      item({ localId: "2", appName: "Code.exe", revision: 1, minutes: 12 }),
    ]);

    // The client only sends Chrome, because only Chrome changed locally.
    await sync(userId, deviceA, "batch-incr-0002", [
      item({ localId: "1", appName: "Chrome.exe", revision: 2, minutes: 45 }),
    ]);

    const chrome = await TimeManagementDeviceUsageModel.findOne({
      userId,
      appKey: "Chrome.exe",
    }).lean();
    const code = await TimeManagementDeviceUsageModel.findOne({
      userId,
      appKey: "Code.exe",
    }).lean();

    assert.strictEqual(chrome.totalDuration / MINUTE, 45);
    assert.strictEqual(chrome.revision, 2);
    assert.strictEqual(code.totalDuration / MINUTE, 12, "untouched row is unchanged");
    assert.strictEqual(code.revision, 1);
    assert.strictEqual(await storedMinutes(userId), 57);
  });

  test("5. retrying the same batch does not count the usage twice", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    const items = [item({ revision: 3, minutes: 45 })];
    const first = await sync(userId, deviceA, "batch-retry-0001", items);
    const second = await sync(userId, deviceA, "batch-retry-0001", items);

    assert.strictEqual(first.idempotent, false);
    assert.strictEqual(second.idempotent, true, "a repeat is recognised");
    assert.deepStrictEqual(second.results, first.results, "same acknowledgement");
    assert.strictEqual(await storedMinutes(userId), 45);
    assert.strictEqual(
      await TimeManagementDeviceUsageModel.countDocuments({ userId }),
      1
    );
  });

  test("9. a replay with a fresh batch id still cannot double-count", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    // The timeout-after-processing case: the client never saw the response and
    // resends the same content. Even with a different batch id, a snapshot is
    // set, so the total cannot grow.
    await sync(userId, deviceA, "batch-replay-0001", [
      item({ revision: 3, minutes: 45 }),
    ]);
    const ack = await sync(userId, deviceA, "batch-replay-0002", [
      item({ revision: 3, minutes: 45 }),
    ]);

    assert.strictEqual(await storedMinutes(userId), 45, "the total did not grow");
    // Either classification is a success the client may mark synchronized: the
    // backend holds this revision, and the replay changed nothing.
    assert.ok(["applied", "stale"].includes(ack.results[0].status));
    assert.strictEqual(ack.appliedCount + ack.staleCount, 1);
    assert.strictEqual(ack.rejectedCount, 0);
    assert.strictEqual(ack.status, "completed");
  });

  test("7. 30 + 15 on device A and 30 on device B aggregate to 75 minutes", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    // Device A records 30 minutes and syncs.
    await sync(userId, deviceA, "batch-75-a1", [
      item({ localId: "1", revision: 1, minutes: 30 }),
    ]);
    assert.strictEqual(await storedMinutes(userId), 30);

    // Device A records another 15 minutes. Its local record is cumulative, so
    // the snapshot it uploads says 45 — and must not add 45 to the cloud total.
    await sync(userId, deviceA, "batch-75-a2", [
      item({ localId: "1", revision: 2, minutes: 45 }),
    ]);
    assert.strictEqual(await storedMinutes(userId), 45);

    // Device B independently records 30 minutes for the same application.
    await sync(userId, deviceB, "batch-75-b1", [
      item({ localId: "1", revision: 1, minutes: 30 }),
    ]);

    const report = await deviceUsageService.getAggregatedUsage(userId, {
      date: DATE,
    });

    assert.strictEqual(report.summary.totalDuration / MINUTE, 75);
    assert.strictEqual(report.summary.totalDevices, 2);
    assert.strictEqual(report.byApp.length, 1, "one application");
    assert.strictEqual(report.byApp[0].totalDuration / MINUTE, 75);

    const perDevice = report.byApp[0].devices
      .map((d) => d.totalDuration / MINUTE)
      .sort((a, b) => a - b);
    assert.deepStrictEqual(perDevice, [30, 45], "each device's own share");
    assert.strictEqual(report.byDate[0].totalDuration / MINUTE, 75);
  });

  test("6. an out-of-order older snapshot cannot regress the stored total", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    await sync(userId, deviceA, "batch-order-0002", [
      item({ revision: 5, minutes: 50 }),
    ]);
    const ack = await sync(userId, deviceA, "batch-order-0001", [
      item({ revision: 2, minutes: 20 }),
    ]);

    assert.strictEqual(await storedMinutes(userId), 50);
    assert.strictEqual(ack.results[0].status, "stale");
    assert.strictEqual(ack.results[0].revision, 5, "the stored revision is reported back");
  });

  test("a correction with a higher revision replaces the contribution, downward too", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    await sync(userId, deviceA, "batch-fix-0001", [
      item({ revision: 1, minutes: 45 }),
    ]);
    await sync(userId, deviceA, "batch-fix-0002", [
      item({ revision: 2, minutes: 20 }),
    ]);

    assert.strictEqual(await storedMinutes(userId), 20);
  });

  test("10. a partial batch applies the good items and reports the bad one", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    const ack = await sync(userId, deviceA, "batch-partial-0001", [
      item({ localId: "1", appName: "Chrome.exe", revision: 1, minutes: 10 }),
      item({ localId: "2", appName: "###", revision: 1, minutes: 7 }),
      item({ localId: "3", appName: "Code.exe", revision: 1, minutes: 3 }),
    ]);

    assert.strictEqual(ack.status, "partial");
    assert.strictEqual(ack.appliedCount, 2);
    assert.strictEqual(ack.rejectedCount, 1);
    assert.strictEqual(await storedMinutes(userId), 13);

    const rejected = ack.results.find((r) => r.status === "rejected");
    assert.strictEqual(rejected.localId, "2", "the client keeps exactly this one pending");
    assert.strictEqual(rejected.appId, null, "no application id could be derived");
  });

  test("8/11. the acknowledgement can be re-read after a lost response", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    const ack = await sync(userId, deviceA, "batch-ack-0001", [
      item({ revision: 1, minutes: 10 }),
    ]);
    const reread = await deviceUsageService.getBatchAcknowledgement(
      userId,
      "batch-ack-0001"
    );

    assert.deepStrictEqual(reread.results, ack.results);
    assert.strictEqual(reread.idempotent, true);

    await assert.rejects(
      () => deviceUsageService.getBatchAcknowledgement(otherUserId, "batch-ack-0001"),
      /Unauthorized/
    );
  });

  test("12. date filters, application filters and pagination are applied server-side", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    await sync(userId, deviceA, "batch-filter-0001", [
      item({ localId: "1", appName: "Chrome.exe", date: "2026-10-24", revision: 1, minutes: 10 }),
      item({ localId: "2", appName: "Chrome.exe", date: "2026-10-25", revision: 1, minutes: 20 }),
      item({ localId: "3", appName: "Code.exe", date: "2026-10-25", revision: 1, minutes: 5 }),
      item({ localId: "4", appName: "Slack.exe", date: "2026-10-26", revision: 1, minutes: 1 }),
    ]);

    const oneDay = await deviceUsageService.getAggregatedUsage(userId, {
      date: "2026-10-25",
    });
    assert.strictEqual(oneDay.summary.totalDuration / MINUTE, 25);
    assert.strictEqual(oneDay.summary.totalApps, 2);

    const range = await deviceUsageService.getAggregatedUsage(userId, {
      dateFrom: "2026-10-24",
      dateTo: "2026-10-25",
    });
    assert.strictEqual(range.summary.totalDuration / MINUTE, 35);
    assert.strictEqual(range.byDate.length, 2);

    const oneApp = await deviceUsageService.getAggregatedUsage(userId, {
      appName: "chrome",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
    assert.strictEqual(oneApp.summary.totalDuration / MINUTE, 30);

    const firstPage = await deviceUsageService.getAggregatedUsage(userId, {
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      limit: 1,
      page: 1,
    });
    assert.strictEqual(firstPage.byApp.length, 1);
    assert.strictEqual(firstPage.pagination.total, 3);
    assert.strictEqual(firstPage.pagination.pages, 3);
    assert.strictEqual(
      firstPage.byApp[0].appId,
      "chrome",
      "the longest-used application comes first"
    );
  });

  test("window detail is only returned for a single application, and capped", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    await sync(userId, deviceA, "batch-windows-0001", [
      item({
        revision: 1,
        minutes: 10,
        windows: [
          { title: "docs", durationMs: 4 * MINUTE },
          { title: "mail", durationMs: 6 * MINUTE },
        ],
      }),
    ]);

    const withoutWindows = await deviceUsageService.getAggregatedUsage(userId, {
      date: DATE,
    });
    assert.strictEqual(withoutWindows.windows, undefined);

    const withWindows = await deviceUsageService.getAggregatedUsage(userId, {
      date: DATE,
      appName: "Chrome.exe",
      includeWindows: "true",
    });
    assert.deepStrictEqual(
      withWindows.windows.map((w) => w.title),
      ["mail", "docs"]
    );
  });

  test("another user's usage needs an accepted sharing relationship", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    await sync(otherUserId, deviceA, "batch-auth-0001", [
      item({ revision: 1, minutes: 9 }),
    ]);

    await assert.rejects(
      () =>
        deviceUsageService.getAggregatedUsage(userId, {
          userId: otherUserId.toString(),
        }),
      /No accepted sharing relationship/
    );

    await TimeManagementShareModel.create({
      senderUserId: otherUserId,
      recipientUserId: userId,
      shareScope: "person",
      filterId: "filter-auth",
      filterName: "Auth probe",
      status: "accepted",
    });

    const report = await deviceUsageService.getAggregatedUsage(userId, {
      userId: otherUserId.toString(),
    });
    assert.strictEqual(report.summary.totalDuration / MINUTE, 9);
  });

  test("13. a large backlog is processed in bounded batches", async (t) => {
    if (!dbAvailable) return t.skip("no MongoDB reachable");

    // 30 days x 10 applications, uploaded the way the client pages it.
    const backlog = [];
    for (let day = 1; day <= 30; day += 1) {
      for (let app = 0; app < 10; app += 1) {
        backlog.push(
          item({
            localId: `${day}-${app}`,
            appName: `App${app}.exe`,
            date: `2026-09-${String(day).padStart(2, "0")}`,
            revision: 1,
            minutes: 1,
          })
        );
      }
    }

    const BATCH = 200;
    let applied = 0;
    for (let i = 0; i < backlog.length; i += BATCH) {
      const slice = backlog.slice(i, i + BATCH);
      // eslint-disable-next-line no-await-in-loop
      const ack = await sync(userId, deviceA, `batch-backlog-${i}`, slice);
      applied += ack.appliedCount;
    }

    assert.strictEqual(applied, 300);
    assert.strictEqual(await storedMinutes(userId), 300);

    const report = await deviceUsageService.getAggregatedUsage(userId, {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      limit: 5,
    });
    assert.strictEqual(report.summary.totalDuration / MINUTE, 300);
    assert.strictEqual(report.byApp.length, 5, "a page, not the whole set");
    assert.strictEqual(report.pagination.total, 10);
  });

  test("the usage collection declares the identity and reporting indexes", () => {
    const keys = TimeManagementDeviceUsageModel.schema
      .indexes()
      .map(([key, options]) => ({ key: JSON.stringify(key), options }));

    const identity = keys.find(
      (i) =>
        i.key ===
        JSON.stringify({ userId: 1, deviceId: 1, appKey: 1, date: 1 })
    );
    assert.ok(identity, "the per-device record identity must be indexed");
    assert.strictEqual(identity.options.unique, true);

    assert.ok(
      keys.some((i) => i.key === JSON.stringify({ userId: 1, date: 1 })),
      "range reports must be indexed"
    );
    assert.ok(
      keys.some(
        (i) => i.key === JSON.stringify({ userId: 1, appId: 1, date: 1 })
      ),
      "per-application reports must be indexed"
    );
  });
});
