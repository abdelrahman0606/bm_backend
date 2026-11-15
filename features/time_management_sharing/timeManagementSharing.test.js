const { test, describe, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config({ path: path.join(__dirname, "../../config.env") });

const timeManagementSharingService = require("./timeManagementSharingService");
const TimeManagementShareModel = require("./timeManagementShareModel");
const TimeManagementUsageModel = require("./timeManagementUsageModel");
const TimeManagementSyncBatchModel = require("./timeManagementSyncBatchModel");
const TimeManagementShareDeliveryModel = require("./timeManagementShareDeliveryModel");
const CompanyModel = require("../companies/companyModel");
const NotificationModel = require("../notifications/notificationModel");
const scheduleUtils = require("./timeManagementScheduleUtils");
const scheduler = require("./timeManagementShareScheduler");
const UserModel = require("../users/userModel");
const {
  connectLocalTestDatabase,
  closeLocalTestDatabase,
  testDatabaseName,
} = require("./timeManagementTestDatabase");

/** Keeps this suite's local-MongoDB database separate from the other suites'. */
const SUITE_TAG = "sharing";

describe("Time Management Sharing and Synchronization", () => {
  // Every model used here lives on local MongoDB, not on the Atlas connection
  // the users and companies are created on, so both have to be open. False
  // when mongod is not running, which skips the suite instead of letting every
  // operation buffer out — see timeManagementTestDatabase.js.
  let localDbReady = false;
  let userA; // Sender / Owner
  let userB; // Recipient
  let userC; // Third party / Attacker
  let company; // Company owned by userA, used by company-scope tests
  const testSuffix = Date.now().toString();

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    localDbReady = await connectLocalTestDatabase(SUITE_TAG);
    if (!localDbReady) return;

    // Create 3 test users
    userA = await UserModel.create({
      fullName: `Test Owner ${testSuffix}`,
      email: `owner_${testSuffix}@example.com`,
      phone: "0100000001",
      type: "business",
      role: "senior",
      relation: "internal",
      birthday: new Date("1990-01-01"),
      password: "password123",
    });

    userB = await UserModel.create({
      fullName: `Test Recipient ${testSuffix}`,
      email: `recipient_${testSuffix}@example.com`,
      phone: "0100000002",
      type: "business",
      role: "manager",
      relation: "internal",
      birthday: new Date("1992-02-02"),
      password: "password123",
    });

    userC = await UserModel.create({
      fullName: `Test Stranger ${testSuffix}`,
      email: `stranger_${testSuffix}@example.com`,
      phone: "0100000003",
      type: "personal",
      role: "junior",
      relation: "external",
      birthday: new Date("1995-05-05"),
      password: "password123",
    });

    company = await CompanyModel.create({
      title: `Test Company ${testSuffix}`,
      createdBy: userA._id.toString(),
      isPrimary: true,
      index: 1,
    });
  });

  beforeEach((t) => {
    if (!localDbReady) {
      t.skip(
        `local MongoDB (${testDatabaseName(SUITE_TAG)}) is not running; start scripts/start-local-mongod.cmd`,
      );
    }
  });

  after(async () => {
    // With no local database there is nothing to clean up, and the test users
    // were never created either.
    if (!localDbReady) {
      await closeLocalTestDatabase();
      await mongoose.disconnect();
      return;
    }

    // Cleanup created test records
    await TimeManagementShareModel.deleteMany({
      $or: [
        { senderUserId: { $in: [userA._id, userB._id, userC._id] } },
        { recipientUserId: { $in: [userA._id, userB._id, userC._id] } },
      ],
    });
    await TimeManagementUsageModel.deleteMany({
      $or: [
        { senderUserId: { $in: [userA._id, userB._id, userC._id] } },
        { recipientUserId: { $in: [userA._id, userB._id, userC._id] } },
      ],
    });
    await TimeManagementSyncBatchModel.deleteMany({
      $or: [
        { senderUserId: { $in: [userA._id, userB._id, userC._id] } },
        { recipientUserId: { $in: [userA._id, userB._id, userC._id] } },
      ],
    });
    await TimeManagementShareDeliveryModel.deleteMany({
      $or: [
        { senderUserId: { $in: [userA._id, userB._id, userC._id] } },
        { recipientUserId: { $in: [userA._id, userB._id, userC._id] } },
      ],
    });
    await NotificationModel.deleteMany({
      userId: { $in: [userA._id, userB._id, userC._id] },
    });
    if (company) await CompanyModel.deleteOne({ _id: company._id });
    await UserModel.deleteMany({
      _id: { $in: [userA._id, userB._id, userC._id] },
    });

    await closeLocalTestDatabase();
    await mongoose.disconnect();
  });

  // 1. Creating and listing a sharing invitation
  test("1. Create and list sharing invitations", async () => {
    const filterId = `filter-1-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId,
      filterName: "Development Filter",
      filterDefinition: { rules: [{ app: "Code.exe" }] },
      scops: { project: "bm_backend" },
    });

    assert.ok(share);
    assert.strictEqual(share.status, "pending");
    assert.strictEqual(share.filterId, filterId);
    assert.strictEqual(share.senderUserId.toString(), userA._id.toString());
    assert.strictEqual(share.recipientUserId.toString(), userB._id.toString());

    // Check listing sent shares
    const sent = await timeManagementSharingService.getSentShares(userA._id, {});
    assert.ok(sent.shares.some((s) => s.filterId === filterId));

    // Check listing received shares
    const received = await timeManagementSharingService.getReceivedShares(userB._id, {});
    assert.ok(received.shares.some((s) => s.filterId === filterId));
  });

  // 2. Accepting and rejecting invitations
  test("2. Accept and reject invitations", async () => {
    const filterAccept = `filter-accept-${testSuffix}`;
    const shareToAccept = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterAccept,
      filterName: "Accept Filter",
      filterDefinition: { rules: [] },
    });

    const accepted = await timeManagementSharingService.acceptShare(
      userB._id,
      shareToAccept._id
    );
    assert.strictEqual(accepted.status, "accepted");
    assert.ok(accepted.acceptedAt);

    // Reject flow
    const filterReject = `filter-reject-${testSuffix}`;
    const shareToReject = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterReject,
      filterName: "Reject Filter",
      filterDefinition: { rules: [] },
    });

    const rejected = await timeManagementSharingService.rejectShare(
      userB._id,
      shareToReject._id
    );
    assert.strictEqual(rejected.status, "rejected");
    assert.ok(rejected.rejectedAt);
  });

  // 3. Preventing synchronization before acceptance
  test("3. Prevent synchronization before acceptance", async () => {
    const filterPending = `filter-sync-pending-${testSuffix}`;
    await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterPending,
      filterName: "Pending Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });

    await assert.rejects(
      async () => {
        await timeManagementSharingService.syncUsage(userA._id, {
          batchId: `batch-pending-${testSuffix}`,
          filterId: filterPending,
          recipientId: userB._id.toString(),
          date: "2026-10-11",
          totalDuration: 60000,
          apps: [{ appName: "Code.exe", totalDuration: 60000 }],
        });
      },
      { message: "Sharing invitation has not been accepted yet" }
    );
  });

  // 4. Rejecting unauthorized filter updates
  test("4. Reject unauthorized filter updates (only owner can update)", async () => {
    const filterUpdate = `filter-update-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterUpdate,
      filterName: "Original Title",
      filterDefinition: { rules: [] },
    });

    // Recipient userB attempts to update filter -> must be rejected with 403
    await assert.rejects(
      async () => {
        await timeManagementSharingService.updateShare(userB._id, share._id, {
          filterName: "Hacked Title",
        });
      },
      { message: "Only the owner can update the shared filter" }
    );

    // Owner userA updates filter -> succeeds
    const updated = await timeManagementSharingService.updateShare(userA._id, share._id, {
      filterName: "New Owner Title",
      filterDefinition: { rules: [{ app: "test" }] },
    });
    assert.strictEqual(updated.filterName, "New Owner Title");
  });

  // 5. Disconnecting as a recipient without deleting the original filter
  test("5. Recipient disconnects without deleting original filter", async () => {
    const filterDisc = `filter-disc-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterDisc,
      filterName: "Disconnect Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    // Recipient disconnects
    const disconnected = await timeManagementSharingService.disconnectShare(
      userB._id,
      share._id
    );
    assert.strictEqual(disconnected.status, "disconnected");
    assert.ok(disconnected.disconnectedAt);

    // Verify document still exists in DB
    const fetched = await TimeManagementShareModel.findById(share._id);
    assert.ok(fetched);
    assert.strictEqual(fetched.status, "disconnected");
  });

  // 6. Revoking access as the owner
  test("6. Owner revokes access and immediately halts synchronization", async () => {
    const filterRevoke = `filter-revoke-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterRevoke,
      filterName: "Revoke Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    // Owner revokes
    const revoked = await timeManagementSharingService.revokeShare(userA._id, share._id);
    assert.strictEqual(revoked.status, "revoked");
    assert.ok(revoked.revokedAt);

    // Attempting to sync now must be rejected
    await assert.rejects(
      async () => {
        await timeManagementSharingService.syncUsage(userA._id, {
          batchId: `batch-revoke-${testSuffix}`,
          filterId: filterRevoke,
          recipientId: userB._id.toString(),
          date: "2026-10-11",
          totalDuration: 10000,
          apps: [],
        });
      },
      { message: "Sharing relationship was revoked by owner" }
    );
  });

  // 7. Synchronizing multiple valid delta batches
  test("7. Synchronize multiple valid delta batches", async () => {
    const filterSync = `filter-sync-multi-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterSync,
      filterName: "Sync Multi Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    // Batch 1
    const res1 = await timeManagementSharingService.syncUsage(userA._id, {
      batchId: `batch-multi-1-${testSuffix}`,
      filterId: filterSync,
      recipientId: userB._id.toString(),
      date: "2026-10-11",
      syncType: "delta",
      totalDuration: 1000,
      apps: [
        {
          appName: "Code.exe",
          totalDuration: 1000,
          windows: [{ title: "file1.js", durationMs: 1000 }],
        },
      ],
    });
    assert.strictEqual(res1.idempotent, false);

    // Batch 2
    const res2 = await timeManagementSharingService.syncUsage(userA._id, {
      batchId: `batch-multi-2-${testSuffix}`,
      filterId: filterSync,
      recipientId: userB._id.toString(),
      date: "2026-10-11",
      syncType: "delta",
      totalDuration: 2000,
      apps: [
        {
          appName: "Code.exe",
          totalDuration: 2000,
          windows: [{ title: "file1.js", durationMs: 1500 }, { title: "file2.js", durationMs: 500 }],
        },
      ],
    });
    assert.strictEqual(res2.idempotent, false);

    const usage = await TimeManagementUsageModel.findOne({
      senderUserId: userA._id,
      recipientUserId: userB._id,
      filterId: filterSync,
      date: "2026-10-11",
    });
    assert.strictEqual(usage.totalDuration, 3000);
    const codeApp = usage.apps.find((a) => a.appName === "Code.exe");
    assert.strictEqual(codeApp.totalDuration, 3000);
    const file1Win = codeApp.windows.find((w) => w.title === "file1.js");
    assert.strictEqual(file1Win.durationMs, 2500);
    const file2Win = codeApp.windows.find((w) => w.title === "file2.js");
    assert.strictEqual(file2Win.durationMs, 500);
  });

  // 8. Retrying the same batchId without duplicate increments
  test("8. Retrying the same batchId returns idempotent success without duplicate increments", async () => {
    const filterRetry = `filter-retry-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterRetry,
      filterName: "Retry Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    const batchId = `batch-retry-${testSuffix}`;
    const payload = {
      batchId,
      filterId: filterRetry,
      recipientId: userB._id.toString(),
      date: "2026-10-11",
      totalDuration: 5000,
      apps: [{ appName: "chrome.exe", totalDuration: 5000 }],
    };

    const first = await timeManagementSharingService.syncUsage(userA._id, payload);
    assert.strictEqual(first.idempotent, false);

    // Resend exact same batchId
    const retry = await timeManagementSharingService.syncUsage(userA._id, payload);
    assert.strictEqual(retry.idempotent, true);

    const usage = await TimeManagementUsageModel.findOne({
      senderUserId: userA._id,
      recipientUserId: userB._id,
      filterId: filterRetry,
      date: "2026-10-11",
    });
    assert.strictEqual(usage.totalDuration, 5000); // Has NOT doubled to 10000!
  });

  // 9. Concurrent requests with the same batchId
  test("9. Concurrent requests with the same batchId do not process twice", async () => {
    const filterConc = `filter-conc-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterConc,
      filterName: "Concurrent Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    const batchId = `batch-concurrent-${testSuffix}`;
    const payload = {
      batchId,
      filterId: filterConc,
      recipientId: userB._id.toString(),
      date: "2026-10-11",
      totalDuration: 4000,
      apps: [{ appName: "slack.exe", totalDuration: 4000 }],
    };

    // Send 3 concurrent requests simultaneously
    const results = await Promise.all([
      timeManagementSharingService.syncUsage(userA._id, payload),
      timeManagementSharingService.syncUsage(userA._id, payload),
      timeManagementSharingService.syncUsage(userA._id, payload),
    ]);

    // All must resolve successfully
    assert.strictEqual(results.length, 3);
    const nonIdempotentCount = results.filter((r) => r.idempotent === false).length;
    // Exactly ONE request committed the batch, the rest handled idempotently
    assert.strictEqual(nonIdempotentCount, 1);

    const usage = await TimeManagementUsageModel.findOne({
      senderUserId: userA._id,
      recipientUserId: userB._id,
      filterId: filterConc,
      date: "2026-10-11",
    });
    assert.strictEqual(usage.totalDuration, 4000); // Counted exactly once!
  });

  // 10. Correct daily and window-level aggregation
  test("10. Correct daily and window-level aggregation", async () => {
    const filterAgg = `filter-agg-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterAgg,
      filterName: "Agg Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    await timeManagementSharingService.syncUsage(userA._id, {
      batchId: `batch-agg-1-${testSuffix}`,
      filterId: filterAgg,
      recipientId: userB._id.toString(),
      date: "2026-10-11",
      totalDuration: 10000,
      apps: [
        {
          appName: "AppOne",
          totalDuration: 6000,
          windows: [
            { title: "Window A", durationMs: 4000 },
            { title: "Window B", durationMs: 2000 },
          ],
        },
        {
          appName: "AppTwo",
          totalDuration: 4000,
          windows: [{ title: "Window C", durationMs: 4000 }],
        },
      ],
    });

    const report = await timeManagementSharingService.getReport(userB._id, {
      filterId: filterAgg,
      startDate: "2026-10-11",
      endDate: "2026-10-11",
    });

    assert.strictEqual(report.summary.totalDuration, 10000);
    assert.strictEqual(report.byApp.length, 2);
    const appOne = report.byApp.find((a) => a.appName === "AppOne");
    assert.strictEqual(appOne.totalDuration, 6000);
    assert.strictEqual(appOne.windows.length, 2);
  });

  // 11. Isolation between recipients and companies
  test("11. Strict data isolation between recipients and users", async () => {
    const filterIso = `filter-iso-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterIso,
      filterName: "Iso Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    await timeManagementSharingService.syncUsage(userA._id, {
      batchId: `batch-iso-${testSuffix}`,
      filterId: filterIso,
      recipientId: userB._id.toString(),
      date: "2026-10-11",
      totalDuration: 15000,
      apps: [{ appName: "PrivateApp", totalDuration: 15000 }],
    });

    // User C (unauthorized third party) queries report
    const strangerReport = await timeManagementSharingService.getReport(userC._id, {
      filterId: filterIso,
    });
    // Must return 0 usage records for User C
    assert.strictEqual(strangerReport.summary.totalDuration, 0);
    assert.strictEqual(strangerReport.byApp.length, 0);

    // User C attempts to view single share between User A and User B
    await assert.rejects(
      async () => {
        await timeManagementSharingService.getSingleShare(userC._id, share._id);
      },
      { message: "Unauthorized to access this share" }
    );
  });

  // 12. Recovery after failed synchronization requests
  test("12. Recovery after failed synchronization requests", async () => {
    const filterRec = `filter-rec-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterRec,
      filterName: "Recovery Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    // Attempt sync with non-existent recipient -> fails
    await assert.rejects(
      async () => {
        await timeManagementSharingService.syncUsage(userA._id, {
          batchId: `batch-rec-fail-${testSuffix}`,
          filterId: filterRec,
          recipientId: new mongoose.Types.ObjectId().toString(),
          date: "2026-10-11",
          totalDuration: 5000,
          apps: [],
        });
      },
      { message: /No active sharing relationship found/ }
    );

    // Ensure the failed batchId did NOT linger or lock out valid submissions
    const success = await timeManagementSharingService.syncUsage(userA._id, {
      batchId: `batch-rec-success-${testSuffix}`,
      filterId: filterRec,
      recipientId: userB._id.toString(),
      date: "2026-10-11",
      totalDuration: 5000,
      apps: [{ appName: "AppRec", totalDuration: 5000 }],
    });
    assert.strictEqual(success.idempotent, false);
  });

  // 13. Correct handling of date boundaries
  test("13. Correct handling of date boundaries across days", async () => {
    const filterDates = `filter-dates-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterDates,
      filterName: "Dates Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    // Day 1
    await timeManagementSharingService.syncUsage(userA._id, {
      batchId: `batch-date-1-${testSuffix}`,
      filterId: filterDates,
      recipientId: userB._id.toString(),
      date: "2026-10-10",
      totalDuration: 3000,
      apps: [{ appName: "Code.exe", totalDuration: 3000 }],
    });

    // Day 2
    await timeManagementSharingService.syncUsage(userA._id, {
      batchId: `batch-date-2-${testSuffix}`,
      filterId: filterDates,
      recipientId: userB._id.toString(),
      date: "2026-10-11",
      totalDuration: 7000,
      apps: [{ appName: "Code.exe", totalDuration: 7000 }],
    });

    const report = await timeManagementSharingService.getReport(userB._id, {
      filterId: filterDates,
      startDate: "2026-10-10",
      endDate: "2026-10-11",
    });

    assert.strictEqual(report.summary.totalDuration, 10000);
    assert.strictEqual(report.summary.totalDays, 2);
    assert.strictEqual(report.byDate.length, 2);
    assert.strictEqual(report.byDate[0].date, "2026-10-10");
    assert.strictEqual(report.byDate[0].totalDuration, 3000);
    assert.strictEqual(report.byDate[1].date, "2026-10-11");
    assert.strictEqual(report.byDate[1].totalDuration, 7000);
  });

  // 14. Validation of duplicate shares & self-sharing
  test("14. Prevent self-sharing and duplicate shares", async () => {
    // Prevent self sharing
    await assert.rejects(
      async () => {
        await timeManagementSharingService.createShare(userA._id, {
          recipientUserId: userA._id.toString(),
          filterId: `self-${testSuffix}`,
          filterName: "Self Filter",
          filterDefinition: { schemaVersion: 1, rules: [] },
        });
      },
      { message: "Cannot share filter with yourself" }
    );

    // Prevent duplicate pending share
    const dupFilter = `dup-${testSuffix}`;
    await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: dupFilter,
      filterName: "Dup Filter",
      filterDefinition: { schemaVersion: 1, rules: [] },
    });

    await assert.rejects(
      async () => {
        await timeManagementSharingService.createShare(userA._id, {
          recipientUserId: userB._id.toString(),
          filterId: dupFilter,
          filterName: "Dup Filter Again",
          filterDefinition: { schemaVersion: 1, rules: [] },
        });
      },
      { message: "A pending share for this filter already exists with this user" }
    );
  });

  // 15. Backward compatibility and batch status retrieval
  test("15. Batch status retrieval and backward compatibility", async () => {
    const filterStat = `filter-stat-${testSuffix}`;
    const share = await timeManagementSharingService.createShare(userA._id, {
      recipientUserId: userB._id.toString(),
      filterId: filterStat,
      title: "Title As Alias For FilterName",
      filterDefinition: { schemaVersion: 1 },
    });
    assert.strictEqual(share.filterName, "Title As Alias For FilterName");
    await timeManagementSharingService.acceptShare(userB._id, share._id);

    const batchId = `batch-stat-${testSuffix}`;
    await timeManagementSharingService.syncUsage(userA._id, {
      batchId,
      filterId: filterStat,
      recipientId: userB._id.toString(),
      date: "2026-10-11",
      totalDuration: 12000,
      apps: [{ appName: "TestedApp", totalDuration: 12000 }],
    });

    // Sender retrieves batch status
    const senderBatch = await timeManagementSharingService.getSyncBatchStatus(
      userA._id,
      batchId
    );
    assert.strictEqual(senderBatch.batchId, batchId);
    assert.strictEqual(senderBatch.totalDuration, 12000);

    // Recipient retrieves batch status
    const recipientBatch = await timeManagementSharingService.getSyncBatchStatus(
      userB._id,
      batchId
    );
    assert.strictEqual(recipientBatch.batchId, batchId);

    // Third party User C cannot view batch status
    await assert.rejects(
      async () => {
        await timeManagementSharingService.getSyncBatchStatus(userC._id, batchId);
      },
      { message: "Unauthorized to view this sync batch" }
    );
  });
});
