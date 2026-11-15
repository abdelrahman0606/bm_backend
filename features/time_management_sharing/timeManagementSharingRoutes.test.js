const { test, describe, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const http = require("http");
const dotenv = require("dotenv");
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

dotenv.config({ path: path.join(__dirname, "../../config.env") });

const timeManagementSharingRoute = require("./timeManagementSharingRoute");
const globalError = require("../../middlewares/errorMiddleware");
const TimeManagementShareModel = require("./timeManagementShareModel");
const TimeManagementUsageModel = require("./timeManagementUsageModel");
const TimeManagementSyncBatchModel = require("./timeManagementSyncBatchModel");
const TimeManagementShareDeliveryModel = require("./timeManagementShareDeliveryModel");
const UserModel = require("../users/userModel");
const NotificationModel = require("../notifications/notificationModel");
const {
  connectLocalTestDatabase,
  closeLocalTestDatabase,
  testDatabaseName,
} = require("./timeManagementTestDatabase");

/** Keeps this suite's local-MongoDB database separate from the other suites'. */
const SUITE_TAG = "routes";

/**
 * Exercises the sharing endpoints over real HTTP: router wiring, request
 * validation, authorization and status codes, with the same auth middleware the
 * server uses.
 */
describe("Share Time HTTP endpoints", () => {
  // The Time Management models this suite writes to live on local MongoDB, not
  // on the Atlas connection the users and companies are created on, so both
  // have to be open; otherwise every operation buffers out and the cleanup in
  // `after` never finishes, which leaves the test process running — see
  // timeManagementTestDatabase.js.
  let localDbReady = false;
  let server;
  let baseUrl;
  let owner;
  let recipient;
  let stranger;
  let ownerToken;
  let recipientToken;
  let strangerToken;
  const suffix = Date.now().toString();

  const tokenFor = (user) =>
    jwt.sign(
      { id: user._id.toString() },
      process.env.JWT_SECRET || "your-secret-key-change-in-production",
      { expiresIn: "1h" }
    );

  const call = async (method, pathname, { token, body } = {}) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { status: response.status, body: payload };
  };

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    localDbReady = await connectLocalTestDatabase(SUITE_TAG);
    if (!localDbReady) return;

    const makeUser = (name, phone, role) =>
      UserModel.create({
        fullName: `${name} ${suffix}`,
        email: `${name.toLowerCase()}_http_${suffix}@example.com`,
        phone,
        type: "business",
        role,
        relation: "internal",
        birthday: new Date("1990-01-01"),
        password: "password123",
      });

    owner = await makeUser("HttpOwner", "0100000021", "senior");
    recipient = await makeUser("HttpRecipient", "0100000022", "manager");
    stranger = await makeUser("HttpStranger", "0100000023", "junior");

    ownerToken = tokenFor(owner);
    recipientToken = tokenFor(recipient);
    strangerToken = tokenFor(stranger);

    const app = express();
    app.use(express.json());
    app.use("/api/v1/time-management-shares", timeManagementSharingRoute);
    app.use(globalError);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api/v1/time-management-shares`;
  });

  beforeEach((t) => {
    if (!localDbReady) {
      t.skip(
        `local MongoDB (${testDatabaseName(SUITE_TAG)}) is not running; start scripts/start-local-mongod.cmd`,
      );
    }
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));

    // With no local database there is nothing to clean up, and the test users
    // were never created either.
    if (!localDbReady) {
      await closeLocalTestDatabase();
      await mongoose.disconnect();
      return;
    }

    const ids = [owner._id, recipient._id, stranger._id];
    const either = {
      $or: [{ senderUserId: { $in: ids } }, { recipientUserId: { $in: ids } }],
    };
    await TimeManagementShareDeliveryModel.deleteMany(either);
    await TimeManagementUsageModel.deleteMany(either);
    await TimeManagementSyncBatchModel.deleteMany(either);
    await TimeManagementShareModel.deleteMany(either);
    await NotificationModel.deleteMany({ userId: { $in: ids } });
    await UserModel.deleteMany({ _id: { $in: ids } });

    await closeLocalTestDatabase();
    await mongoose.disconnect();
  });

  test("1. Authentication is required", async () => {
    const anonymous = await call("GET", "/");
    assert.strictEqual(anonymous.status, 401);

    const authorized = await call("GET", "/", { token: ownerToken });
    assert.strictEqual(authorized.status, 200);
    assert.strictEqual(authorized.body.success, true);
  });

  test("2. A personal configuration is created active without a recipient", async () => {
    const created = await call("POST", "/", {
      token: ownerToken,
      body: {
        shareScope: "personal",
        filterId: `http-personal-${suffix}`,
        filterName: "My own time",
        filterDefinition: { schemaVersion: 1, selectedApps: [] },
      },
    });

    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.data.shareScope, "personal");
    assert.strictEqual(created.body.data.status, "accepted");
    assert.strictEqual(created.body.data.shareMode, "manual");
  });

  test("3. Invalid payloads are rejected by validation", async () => {
    // person scope without a recipient
    const noRecipient = await call("POST", "/", {
      token: ownerToken,
      body: {
        shareScope: "person",
        filterId: `http-bad-${suffix}`,
        filterName: "No recipient",
        filterDefinition: { schemaVersion: 1 },
      },
    });
    assert.strictEqual(noRecipient.status, 400);

    // out-of-range schedule hour
    const badSchedule = await call("POST", "/", {
      token: ownerToken,
      body: {
        shareScope: "person",
        recipientUserId: recipient._id.toString(),
        filterId: `http-bad-sched-${suffix}`,
        filterName: "Bad schedule",
        filterDefinition: { schemaVersion: 1 },
        shareMode: "automatic",
        schedule: { type: "daily", hour: 99 },
      },
    });
    assert.strictEqual(badSchedule.status, 400);

    // unknown scope
    const badScope = await call("POST", "/", {
      token: ownerToken,
      body: {
        shareScope: "everyone",
        filterId: `http-bad-scope-${suffix}`,
        filterName: "Bad scope",
        filterDefinition: { schemaVersion: 1 },
      },
    });
    assert.strictEqual(badScope.status, 400);
  });

  test("4. Full person-to-person lifecycle over HTTP", async () => {
    const filterId = `http-person-${suffix}`;

    const created = await call("POST", "/", {
      token: ownerToken,
      body: {
        shareScope: "person",
        recipientUserId: recipient._id.toString(),
        filterId,
        filterName: "Daily report",
        filterDefinition: { schemaVersion: 1, selectedApps: [] },
        shareMode: "automatic",
        schedule: {
          type: "daily",
          hour: 9,
          minute: 30,
          timezoneOffsetMinutes: 180,
        },
      },
    });

    assert.strictEqual(created.status, 201);
    const shareId = created.body.data.id;
    assert.strictEqual(created.body.data.status, "pending");
    assert.strictEqual(
      created.body.data.nextRunAt,
      null,
      "a pending request must not be scheduled"
    );

    // The recipient sees it in the inbox, a stranger does not
    const inbox = await call("GET", "/received", { token: recipientToken });
    assert.strictEqual(inbox.status, 200);
    assert.ok(inbox.body.data.some((s) => s.id === shareId));

    const strangerSingle = await call("GET", `/${shareId}`, {
      token: strangerToken,
    });
    assert.strictEqual(strangerSingle.status, 403);

    // Delivery is refused before approval
    const earlyShare = await call("POST", `/${shareId}/share-now`, {
      token: ownerToken,
      body: {},
    });
    assert.strictEqual(earlyShare.status, 403);

    // Only the recipient may accept
    const wrongAccept = await call("PATCH", `/${shareId}/accept`, {
      token: strangerToken,
    });
    assert.strictEqual(wrongAccept.status, 403);

    const accepted = await call("PATCH", `/${shareId}/accept`, {
      token: recipientToken,
    });
    assert.strictEqual(accepted.status, 200);
    assert.strictEqual(accepted.body.data.status, "accepted");
    assert.ok(accepted.body.data.nextRunAt, "approval schedules the first run");

    // Sync one day of usage, then deliver it manually
    const today = new Date().toISOString().split("T")[0];
    const synced = await call("POST", "/sync", {
      token: ownerToken,
      body: {
        batchId: `http-batch-${suffix}`,
        filterId,
        recipientId: recipient._id.toString(),
        date: today,
        syncType: "absolute",
        totalDuration: 5000,
        apps: [
          {
            appName: "Code.exe",
            totalDuration: 5000,
            windows: [{ title: "main.dart", durationMs: 5000 }],
          },
        ],
      },
    });
    assert.strictEqual(synced.status, 200);

    // Re-sending the same absolute batch is idempotent
    const resynced = await call("POST", "/sync", {
      token: ownerToken,
      body: {
        batchId: `http-batch-${suffix}`,
        filterId,
        recipientId: recipient._id.toString(),
        date: today,
        syncType: "absolute",
        totalDuration: 5000,
        apps: [{ appName: "Code.exe", totalDuration: 5000 }],
      },
    });
    assert.strictEqual(resynced.status, 200);
    assert.strictEqual(resynced.body.data.idempotent, true);

    const usage = await TimeManagementUsageModel.findOne({
      senderUserId: owner._id,
      recipientUserId: recipient._id,
      filterId,
      date: today,
    });
    assert.strictEqual(
      usage.totalDuration,
      5000,
      "an absolute re-sync must not double the stored total"
    );

    const shared = await call("POST", `/${shareId}/share-now`, {
      token: ownerToken,
      body: { dateFrom: today, dateTo: today },
    });
    assert.strictEqual(shared.status, 200);
    assert.strictEqual(shared.body.data.totalDuration, 5000);
    assert.strictEqual(shared.body.data.trigger, "manual");

    // Deliveries are readable by both sides, not by anybody else
    const recipientDeliveries = await call("GET", `/${shareId}/deliveries`, {
      token: recipientToken,
    });
    assert.strictEqual(recipientDeliveries.status, 200);
    assert.strictEqual(recipientDeliveries.body.data.length, 1);

    const strangerDeliveries = await call("GET", `/${shareId}/deliveries`, {
      token: strangerToken,
    });
    assert.strictEqual(strangerDeliveries.status, 403);

    // Rescheduling is owner-only
    const recipientReschedule = await call("PATCH", `/${shareId}/schedule`, {
      token: recipientToken,
      body: { shareMode: "manual" },
    });
    assert.strictEqual(recipientReschedule.status, 403);

    const rescheduled = await call("PATCH", `/${shareId}/schedule`, {
      token: ownerToken,
      body: {
        shareMode: "automatic",
        schedule: { type: "hourly", hour: 3, minute: 0 },
      },
    });
    assert.strictEqual(rescheduled.status, 200);
    assert.strictEqual(rescheduled.body.data.schedule.type, "hourly");
    assert.ok(rescheduled.body.data.nextRunAt);

    // Revoking stops everything
    const revoked = await call("PATCH", `/${shareId}/revoke`, {
      token: ownerToken,
    });
    assert.strictEqual(revoked.status, 200);
    assert.strictEqual(revoked.body.data.nextRunAt, null);

    const afterRevoke = await call("POST", `/${shareId}/share-now`, {
      token: ownerToken,
      body: {},
    });
    assert.strictEqual(afterRevoke.status, 403);

    const rescheduleClosed = await call("PATCH", `/${shareId}/schedule`, {
      token: ownerToken,
      body: {
        shareMode: "automatic",
        schedule: { type: "daily", hour: 9 },
      },
    });
    assert.strictEqual(rescheduleClosed.status, 400);
  });

  test("5. The reports endpoint answers with its aggregate shape", async () => {
    const report = await call("GET", "/reports?role=recipient", {
      token: recipientToken,
    });

    assert.strictEqual(report.status, 200);
    assert.ok(report.body.data.summary, "summary is present");
    assert.ok(Array.isArray(report.body.data.byDate));
    assert.ok(Array.isArray(report.body.data.byApp));
    assert.ok(Array.isArray(report.body.data.byEmployee));
  });
});
