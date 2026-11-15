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
const scheduleUtils = require("./timeManagementScheduleUtils");
const scheduler = require("./timeManagementShareScheduler");
const UserModel = require("../users/userModel");
const CompanyModel = require("../companies/companyModel");
const NotificationModel = require("../notifications/notificationModel");
const {
  connectLocalTestDatabase,
  closeLocalTestDatabase,
  testDatabaseName,
} = require("./timeManagementTestDatabase");

/** Keeps this suite's local-MongoDB database separate from the other suites'. */
const SUITE_TAG = "scheduling";

/**
 * Covers the Share Time configuration scopes, the recipient approval lifecycle,
 * manual sharing, and the backend scheduler that performs automatic sharing.
 */
describe("Share Time scopes, approval and scheduling", () => {
  // The Time Management models this suite writes to live on local MongoDB, not
  // on the Atlas connection the users and companies are created on, so both
  // have to be open; otherwise every operation buffers out and the cleanup in
  // `after` never finishes, which leaves the test process running — see
  // timeManagementTestDatabase.js.
  let localDbReady = false;
  let owner; // data owner / sender
  let recipient; // target person (also a manager of the test company)
  let stranger; // unrelated user
  let company; // company owned by `owner`
  const suffix = Date.now().toString();

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    localDbReady = await connectLocalTestDatabase(SUITE_TAG);
    if (!localDbReady) return;

    owner = await UserModel.create({
      fullName: `Share Owner ${suffix}`,
      email: `share_owner_${suffix}@example.com`,
      phone: "0100000011",
      type: "business",
      role: "senior",
      relation: "internal",
      birthday: new Date("1990-01-01"),
      password: "password123",
    });

    recipient = await UserModel.create({
      fullName: `Share Recipient ${suffix}`,
      email: `share_recipient_${suffix}@example.com`,
      phone: "0100000012",
      type: "business",
      role: "manager",
      relation: "internal",
      birthday: new Date("1992-02-02"),
      password: "password123",
    });

    stranger = await UserModel.create({
      fullName: `Share Stranger ${suffix}`,
      email: `share_stranger_${suffix}@example.com`,
      phone: "0100000013",
      type: "personal",
      role: "junior",
      relation: "external",
      birthday: new Date("1995-05-05"),
      password: "password123",
    });

    company = await CompanyModel.create({
      title: `Share Company ${suffix}`,
      createdBy: owner._id.toString(),
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

    const ids = [owner._id, recipient._id, stranger._id];
    const either = {
      $or: [{ senderUserId: { $in: ids } }, { recipientUserId: { $in: ids } }],
    };

    await TimeManagementShareDeliveryModel.deleteMany(either);
    await TimeManagementUsageModel.deleteMany(either);
    await TimeManagementSyncBatchModel.deleteMany(either);
    await TimeManagementShareModel.deleteMany(either);
    await NotificationModel.deleteMany({ userId: { $in: ids } });
    if (company) await CompanyModel.deleteOne({ _id: company._id });
    await UserModel.deleteMany({ _id: { $in: ids } });

    await closeLocalTestDatabase();
    await mongoose.disconnect();
  });

  const today = () => scheduleUtils.localDateString(new Date(), 0);

  // -------------------------------------------------------------------------

  test("1. Personal configurations are persisted to the backend and stay private", async () => {
    const filterId = `personal-${suffix}`;
    const share = await timeManagementSharingService.createShare(owner._id, {
      shareScope: "personal",
      filterId,
      filterName: "My Own Time",
      filterDefinition: { schemaVersion: 1, selectedApps: [] },
    });

    assert.strictEqual(share.shareScope, "personal");
    assert.strictEqual(share.status, "accepted");
    assert.strictEqual(
      share.recipientUserId.toString(),
      owner._id.toString(),
      "a personal configuration must never target another user"
    );
    assert.strictEqual(share.shareMode, "manual");
    assert.strictEqual(share.nextRunAt, null);

    // Persisted in the database, not only on the device
    assert.ok(await TimeManagementShareModel.findById(share._id));

    await assert.rejects(
      async () =>
        timeManagementSharingService.getSingleShare(recipient._id, share._id),
      { message: "Unauthorized to access this share" }
    );

    // Saving the same personal configuration again updates it in place
    const again = await timeManagementSharingService.createShare(owner._id, {
      shareScope: "personal",
      filterId,
      filterName: "My Own Time (edited)",
      filterDefinition: {
        schemaVersion: 1,
        selectedApps: [{ title: "Code.exe" }],
      },
    });
    assert.strictEqual(again._id.toString(), share._id.toString());
    assert.strictEqual(again.filterName, "My Own Time (edited)");
    assert.strictEqual(
      await TimeManagementShareModel.countDocuments({
        senderUserId: owner._id,
        filterId,
      }),
      1,
      "re-saving must not create a second configuration"
    );
  });

  test("2. Company configurations follow the company authorization rules", async () => {
    const filterId = `company-${suffix}`;
    const share = await timeManagementSharingService.createShare(owner._id, {
      shareScope: "company",
      companyId: company._id.toString(),
      filterId,
      filterName: "Company Filter",
      filterDefinition: { schemaVersion: 1 },
    });

    assert.strictEqual(share.shareScope, "company");
    assert.strictEqual(share.companyId, company._id.toString());
    assert.strictEqual(share.status, "accepted");

    // A manager may read it; an unrelated junior may not
    const managerView = await timeManagementSharingService.getSingleShare(
      recipient._id,
      share._id
    );
    assert.strictEqual(managerView._id.toString(), share._id.toString());

    await assert.rejects(
      async () =>
        timeManagementSharingService.getSingleShare(stranger._id, share._id),
      { message: "Unauthorized to access this share" }
    );

    await assert.rejects(
      async () =>
        timeManagementSharingService.createShare(stranger._id, {
          shareScope: "company",
          companyId: company._id.toString(),
          filterId: `company-denied-${suffix}`,
          filterName: "Denied",
          filterDefinition: { schemaVersion: 1 },
        }),
      // Sharing your own time with a company requires belonging to it.
      { message: /not a member of this company/ }
    );

    await assert.rejects(
      async () =>
        timeManagementSharingService.createShare(owner._id, {
          shareScope: "company",
          filterId: `company-missing-${suffix}`,
          filterName: "No company",
          filterDefinition: { schemaVersion: 1 },
        }),
      { message: "companyId is required for company sharing" }
    );
  });

  test("3. An automatic configuration is only scheduled after approval", async () => {
    const filterId = `auto-${suffix}`;
    const share = await timeManagementSharingService.createShare(owner._id, {
      recipientUserId: recipient._id.toString(),
      filterId,
      filterName: "Auto Filter",
      filterDefinition: { schemaVersion: 1 },
      shareMode: "automatic",
      schedule: { type: "hourly", hour: 1, minute: 0 },
    });

    assert.strictEqual(share.shareScope, "person");
    assert.strictEqual(share.status, "pending");
    assert.strictEqual(share.shareMode, "automatic");
    assert.strictEqual(
      share.nextRunAt,
      null,
      "a pending request must never be scheduled"
    );

    // Even far in the future the scheduler must ignore an unapproved share
    const dueBefore = await timeManagementSharingService.runDueShares({
      now: new Date(Date.now() + 10 * 60 * 60 * 1000),
    });
    assert.ok(!dueBefore.some((p) => p.shareId === share._id.toString()));

    const accepted = await timeManagementSharingService.acceptShare(
      recipient._id,
      share._id
    );
    assert.strictEqual(accepted.status, "accepted");
    assert.ok(accepted.nextRunAt, "approval schedules the first occurrence");

    // The owner is told about the decision through the notification feature
    const ownerNotice = await NotificationModel.findOne({
      userId: owner._id,
      "metadata.shareId": share._id.toString(),
    });
    assert.ok(ownerNotice, "owner receives the approval notification");
  });

  test("4. The scheduler delivers once per occurrence and is safe to retry", async () => {
    const filterId = `sched-${suffix}`;
    const share = await timeManagementSharingService.createShare(owner._id, {
      recipientUserId: recipient._id.toString(),
      filterId,
      filterName: "Scheduled Filter",
      filterDefinition: { schemaVersion: 1 },
      shareMode: "automatic",
      schedule: { type: "hourly", hour: 1, minute: 0 },
    });
    await timeManagementSharingService.acceptShare(recipient._id, share._id);

    await timeManagementSharingService.syncUsage(owner._id, {
      batchId: `batch-sched-${suffix}`,
      filterId,
      recipientId: recipient._id.toString(),
      date: today(),
      totalDuration: 9000,
      apps: [{ appName: "Code.exe", totalDuration: 9000 }],
    });

    const fresh = await TimeManagementShareModel.findById(share._id);
    const occurrence = fresh.nextRunAt;
    const now = new Date(occurrence.getTime() + 1000);

    const firstRun = await timeManagementSharingService.runDueShares({ now });
    const mine = firstRun.filter((p) => p.shareId === share._id.toString());
    assert.strictEqual(mine.length, 1, "the due configuration ran");
    assert.strictEqual(mine[0].duplicate, false);

    const deliveries = await TimeManagementShareDeliveryModel.find({
      shareId: share._id,
    });
    assert.strictEqual(deliveries.length, 1);
    assert.strictEqual(deliveries[0].trigger, "scheduled");
    assert.strictEqual(deliveries[0].totalDuration, 9000);
    assert.strictEqual(deliveries[0].status, "delivered");

    // Same instant again: the occurrence was consumed, nothing is due
    const secondRun = await timeManagementSharingService.runDueShares({ now });
    assert.ok(!secondRun.some((p) => p.shareId === share._id.toString()));

    // Replaying the exact occurrence (a crashed worker retrying) is idempotent
    const replay = await timeManagementSharingService.runShareOccurrence(
      await TimeManagementShareModel.findById(share._id),
      occurrence
    );
    assert.strictEqual(replay.duplicate, true);
    assert.strictEqual(
      await TimeManagementShareDeliveryModel.countDocuments({
        shareId: share._id,
      }),
      1,
      "repeated scheduler execution must not duplicate a delivery"
    );

    // The next occurrence was moved forward, so the schedule keeps running
    const after = await TimeManagementShareModel.findById(share._id);
    assert.ok(after.nextRunAt.getTime() > occurrence.getTime());
    assert.strictEqual(after.lockedAt, null);

    // The worker wrapper is callable and tolerates having nothing to do
    assert.ok(Array.isArray(await scheduler.tick({ limit: 5 })));
  });

  test("5. Revoked relationships stop delivering and cannot be rescheduled", async () => {
    const filterId = `revoke-${suffix}`;
    const share = await timeManagementSharingService.createShare(owner._id, {
      recipientUserId: recipient._id.toString(),
      filterId,
      filterName: "Revoke Filter",
      filterDefinition: { schemaVersion: 1 },
      shareMode: "automatic",
      schedule: { type: "hourly", hour: 1, minute: 0 },
    });
    await timeManagementSharingService.acceptShare(recipient._id, share._id);

    const revoked = await timeManagementSharingService.revokeShare(
      owner._id,
      share._id
    );
    assert.strictEqual(revoked.status, "revoked");
    assert.strictEqual(revoked.nextRunAt, null);

    const run = await timeManagementSharingService.runDueShares({
      now: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    assert.ok(!run.some((p) => p.shareId === share._id.toString()));

    await assert.rejects(
      async () => timeManagementSharingService.shareNow(owner._id, share._id, {}),
      { message: "Sharing relationship is revoked" }
    );

    await assert.rejects(
      async () =>
        timeManagementSharingService.updateShareSchedule(owner._id, share._id, {
          shareMode: "automatic",
          schedule: { type: "daily", hour: 9, minute: 0 },
        }),
      { message: "Cannot schedule a revoked share" }
    );
  });

  test("6. Manual sharing is owner-initiated, approved-only and recorded", async () => {
    const filterId = `manual-${suffix}`;
    const share = await timeManagementSharingService.createShare(owner._id, {
      recipientUserId: recipient._id.toString(),
      filterId,
      filterName: "Manual Filter",
      filterDefinition: { schemaVersion: 1 },
    });

    await assert.rejects(
      async () => timeManagementSharingService.shareNow(owner._id, share._id, {}),
      { message: "Sharing invitation has not been accepted yet" }
    );

    await timeManagementSharingService.acceptShare(recipient._id, share._id);

    await timeManagementSharingService.syncUsage(owner._id, {
      batchId: `batch-manual-${suffix}`,
      filterId,
      recipientId: recipient._id.toString(),
      date: today(),
      totalDuration: 4500,
      apps: [{ appName: "Chrome.exe", totalDuration: 4500 }],
    });

    const result = await timeManagementSharingService.shareNow(
      owner._id,
      share._id,
      { dateFrom: today(), dateTo: today() }
    );
    assert.strictEqual(result.duplicate, false);
    assert.strictEqual(result.delivery.trigger, "manual");
    assert.strictEqual(result.delivery.totalDuration, 4500);

    const recipientView = await timeManagementSharingService.getDeliveries(
      recipient._id,
      share._id,
      {}
    );
    assert.strictEqual(recipientView.deliveries.length, 1);

    await assert.rejects(
      async () =>
        timeManagementSharingService.getDeliveries(stranger._id, share._id, {}),
      { message: "Unauthorized to access this share" }
    );

    await assert.rejects(
      async () =>
        timeManagementSharingService.shareNow(recipient._id, share._id, {}),
      { message: "Only the owner can share this configuration" }
    );

    // Choosing manual must never silently enable automatic sharing
    const stored = await TimeManagementShareModel.findById(share._id);
    assert.strictEqual(stored.shareMode, "manual");
    assert.strictEqual(stored.nextRunAt, null);
  });

  test("7. Schedule changes are owner-only and apply to future occurrences", async () => {
    const filterId = `resched-${suffix}`;
    const share = await timeManagementSharingService.createShare(owner._id, {
      recipientUserId: recipient._id.toString(),
      filterId,
      filterName: "Reschedule Filter",
      filterDefinition: { schemaVersion: 1 },
    });
    await timeManagementSharingService.acceptShare(recipient._id, share._id);

    const enabled = await timeManagementSharingService.updateShareSchedule(
      owner._id,
      share._id,
      {
        shareMode: "automatic",
        schedule: {
          type: "daily",
          hour: 9,
          minute: 30,
          timezoneOffsetMinutes: 180,
        },
      }
    );
    assert.strictEqual(enabled.shareMode, "automatic");
    assert.ok(enabled.nextRunAt);
    const firstNext = enabled.nextRunAt.getTime();

    const moved = await timeManagementSharingService.updateShareSchedule(
      owner._id,
      share._id,
      {
        schedule: {
          type: "daily",
          hour: 21,
          minute: 30,
          timezoneOffsetMinutes: 180,
        },
      }
    );
    assert.notStrictEqual(
      moved.nextRunAt.getTime(),
      firstNext,
      "a changed time of day moves the next delivery"
    );

    // Switching back to manual unschedules without closing the relationship
    const manual = await timeManagementSharingService.updateShareSchedule(
      owner._id,
      share._id,
      { shareMode: "manual" }
    );
    assert.strictEqual(manual.nextRunAt, null);
    assert.strictEqual(manual.status, "accepted");

    await assert.rejects(
      async () =>
        timeManagementSharingService.updateShareSchedule(owner._id, share._id, {
          shareMode: "automatic",
          schedule: null,
        }),
      { message: "schedule is required for automatic sharing" }
    );

    await assert.rejects(
      async () =>
        timeManagementSharingService.updateShareSchedule(
          recipient._id,
          share._id,
          { shareMode: "manual" }
        ),
      { message: "Only the owner can change the sharing schedule" }
    );
  });

  test("8. Invalid schedules are rejected before anything is stored", async () => {
    await assert.rejects(
      async () =>
        timeManagementSharingService.createShare(owner._id, {
          recipientUserId: recipient._id.toString(),
          filterId: `bad-hour-${suffix}`,
          filterName: "Bad schedule",
          filterDefinition: { schemaVersion: 1 },
          shareMode: "automatic",
          schedule: { type: "daily", hour: 99 },
        }),
      { message: "schedule.hour must be between 0 and 23" }
    );

    await assert.rejects(
      async () =>
        timeManagementSharingService.createShare(owner._id, {
          recipientUserId: recipient._id.toString(),
          filterId: `bad-mode-${suffix}`,
          filterName: "Automatic without schedule",
          filterDefinition: { schemaVersion: 1 },
          shareMode: "automatic",
        }),
      { message: "schedule is required for automatic sharing" }
    );

    await assert.rejects(
      async () =>
        timeManagementSharingService.createShare(owner._id, {
          recipientUserId: recipient._id.toString(),
          filterId: `bad-interval-${suffix}`,
          filterName: "Too frequent",
          filterDefinition: { schemaVersion: 1 },
          shareMode: "automatic",
          schedule: { type: "hourly", hour: 0, minute: 5 },
        }),
      { message: /at least every 15 minutes/ }
    );

    assert.strictEqual(
      await TimeManagementShareModel.countDocuments({
        senderUserId: owner._id,
        filterId: `bad-hour-${suffix}`,
      }),
      0
    );
  });

  test("9. Schedule math: next run honours type, time of day and timezone", () => {
    const daily = scheduleUtils.normalizeSchedule({
      type: "daily",
      hour: 9,
      minute: 0,
      timezoneOffsetMinutes: 180,
    });
    assert.strictEqual(
      scheduleUtils
        .computeNextRunAt(daily, new Date("2026-10-19T04:00:00Z"))
        .toISOString(),
      "2026-10-19T06:00:00.000Z"
    );
    assert.strictEqual(
      scheduleUtils
        .computeNextRunAt(daily, new Date("2026-10-19T07:00:00Z"))
        .toISOString(),
      "2026-10-20T06:00:00.000Z"
    );

    const hourly = scheduleUtils.normalizeSchedule({
      type: "hourly",
      hour: 2,
      minute: 30,
    });
    assert.strictEqual(
      scheduleUtils
        .computeNextRunAt(hourly, new Date("2026-10-19T00:00:00Z"))
        .toISOString(),
      "2026-10-19T02:30:00.000Z"
    );

    const monthly = scheduleUtils.normalizeSchedule({
      type: "monthly",
      dayOfMonth: 31,
      hour: 0,
      minute: 0,
    });
    assert.strictEqual(
      scheduleUtils
        .computeNextRunAt(monthly, new Date("2026-02-01T00:00:00Z"))
        .toISOString(),
      "2026-02-28T00:00:00.000Z",
      "a day that does not exist in the month is clamped"
    );

    const disabled = scheduleUtils.normalizeSchedule({
      type: "daily",
      hour: 9,
      enabled: false,
    });
    assert.strictEqual(scheduleUtils.computeNextRunAt(disabled), null);
  });
});
