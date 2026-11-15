const mongoose = require("mongoose");
const TimeManagementDeviceUsageModel = require("./timeManagementDeviceUsageModel");
const TimeManagementDeviceSyncBatchModel = require("./timeManagementDeviceSyncBatchModel");
const TimeManagementShareModel = require("./timeManagementShareModel");
const { normalizeAppId, aggregationKey } = require("./timeManagementAppIdentity");
const ApiError = require("../../utils/apiError");

/** Largest page a report may return, and the default. */
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** Most window titles ever returned for one application. */
const MAX_WINDOWS = 100;

/**
 * Device usage synchronization and multi-device reporting.
 *
 * ## Why snapshots, not deltas
 *
 * The desktop client stores one cumulative total per application and local day
 * and mutates it in place while tracking; it keeps no change log. So the
 * natural unit it can produce reliably is "this is my total for Chrome on
 * 2026-10-25, revision 7".
 *
 * This service therefore stores each device's own contribution and **replaces**
 * it, so:
 *   * re-sending a snapshot is idempotent by construction — no counter is ever
 *     incremented, so a lost acknowledgement costs one redundant upload and
 *     never a double count;
 *   * a correction (including a downward one) simply arrives as a higher
 *     revision;
 *   * the aggregate is the sum of the devices' latest accepted contributions,
 *     which is what makes 30 + 15 (device A) + 30 (device B) come to 75: A's
 *     contribution becomes 45 and B's stays 30.
 *
 * Deltas would need the client to persist "already synced duration" per record
 * and would make correctness depend entirely on a dedupe ledger surviving.
 */
class TimeManagementDeviceUsageService {
  // -------------------------------------------------------------------------
  // Write path
  // -------------------------------------------------------------------------

  /**
   * Turns a batch into one MongoDB operation per contribution.
   *
   * Pure, so the rule that matters most — a contribution is **set** under a
   * revision guard and never added to a running total — is directly testable.
   *
   * Duplicate items for the same application and day inside one batch are
   * collapsed to the highest revision, so a client mistake cannot make the
   * result depend on the order of the array.
   */
  buildSnapshotOperations(userId, device, items) {
    const prepared = new Map();
    const rejected = [];

    for (const item of items) {
      const appName = typeof item.appName === "string" ? item.appName.trim() : "";
      // Identity of the client's record; aggregation id is derived from the
      // display name and is only used for grouping.
      const appKey = appName;
      const appId = normalizeAppId(appName);
      const localId =
        item.localId === undefined || item.localId === null
          ? null
          : String(item.localId);

      if (!appId || !appName) {
        rejected.push({
          localId,
          appKey: appKey || null,
          appId: appId || null,
          date: item.date,
          revision: Number(item.revision) || 0,
          status: "rejected",
          reason: "appName could not be normalized into an application id",
        });
        continue;
      }

      const revision = Number(item.revision);
      const candidate = {
        localId,
        appKey,
        appId,
        appName,
        date: item.date,
        revision,
        totalDuration: Number(item.totalDuration) || 0,
        windows: Array.isArray(item.windows)
          ? item.windows.map((w) => ({
              title: typeof w.title === "string" ? w.title : "",
              durationMs: Number(w.durationMs) || 0,
            }))
          : [],
        windowsTruncated: item.windowsTruncated === true,
        timezoneOffsetMinutes:
          item.timezoneOffsetMinutes === undefined
            ? device.timezoneOffsetMinutes || 0
            : Number(item.timezoneOffsetMinutes) || 0,
      };

      const key = aggregationKey({
        userId,
        deviceId: device.deviceId,
        appKey,
        date: candidate.date,
      });
      const existing = prepared.get(key);
      if (!existing || candidate.revision > existing.revision) {
        prepared.set(key, candidate);
      }
    }

    const preparedItems = Array.from(prepared.values());

    const operations = preparedItems.map((item) => ({
      updateOne: {
        filter: {
          userId,
          deviceId: device.deviceId,
          appKey: item.appKey,
          date: item.date,
        },
        // An aggregation-pipeline update, so the revision guard and the write
        // are one atomic operation on one document: the snapshot is applied
        // only when it is newer than what is stored, and `revision` can only
        // move forward. Upsert is safe because the filter's equality fields
        // seed a new document.
        update: [
          {
            $set: {
              totalDuration: {
                $cond: [
                  { $gt: [item.revision, { $ifNull: ["$revision", -1] }] },
                  item.totalDuration,
                  { $ifNull: ["$totalDuration", 0] },
                ],
              },
              windows: {
                $cond: [
                  { $gt: [item.revision, { $ifNull: ["$revision", -1] }] },
                  item.windows,
                  { $ifNull: ["$windows", []] },
                ],
              },
              appName: {
                $cond: [
                  { $gt: [item.revision, { $ifNull: ["$revision", -1] }] },
                  item.appName,
                  { $ifNull: ["$appName", item.appName] },
                ],
              },
              appId: item.appId,
              windowsTruncated: {
                $cond: [
                  { $gt: [item.revision, { $ifNull: ["$revision", -1] }] },
                  item.windowsTruncated,
                  { $ifNull: ["$windowsTruncated", false] },
                ],
              },
              timezoneOffsetMinutes: {
                $cond: [
                  { $gt: [item.revision, { $ifNull: ["$revision", -1] }] },
                  item.timezoneOffsetMinutes,
                  { $ifNull: ["$timezoneOffsetMinutes", 0] },
                ],
              },
              deviceName: device.deviceName || { $ifNull: ["$deviceName", null] },
              platform: device.platform || { $ifNull: ["$platform", null] },
              revision: {
                $max: [{ $ifNull: ["$revision", -1] }, item.revision],
              },
              lastSyncAt: "$$NOW",
              createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
              updatedAt: "$$NOW",
            },
          },
        ],
        upsert: true,
      },
    }));

    return { operations, preparedItems, rejected };
  }

  /**
   * Applies one batch of per-device snapshots.
   *
   * Returns the acknowledgement: which contributions the backend now holds and
   * which the client must keep pending. Written to the ledger only after the
   * contributions are durably stored, so nothing is acknowledged early.
   */
  async syncDeviceUsage(userId, payload) {
    const { batchId, deviceId, deviceName, platform, timezoneOffsetMinutes } =
      payload;
    const items = Array.isArray(payload.items) ? payload.items : [];

    // A repeat of a batch the backend already answered gets the identical
    // acknowledgement — the lost-response case.
    const existingBatch = await TimeManagementDeviceSyncBatchModel.findOne({
      batchId,
    }).lean();
    if (existingBatch) {
      if (existingBatch.userId.toString() !== userId.toString()) {
        throw new ApiError("This batch belongs to another user", 403);
      }
      return this.acknowledgement(existingBatch, { idempotent: true });
    }

    if (items.length === 0) {
      throw new ApiError("items must contain at least one usage snapshot", 400);
    }

    const ownerId = new mongoose.Types.ObjectId(userId.toString());
    const device = { deviceId, deviceName, platform, timezoneOffsetMinutes };
    const { operations, preparedItems, rejected } = this.buildSnapshotOperations(
      ownerId,
      device,
      items
    );

    const writeErrorsByIndex = new Map();
    if (operations.length > 0) {
      try {
        // Unordered: one bad contribution must not abandon the rest of the
        // batch, which is what makes a partial failure partial.
        await TimeManagementDeviceUsageModel.bulkWrite(operations, {
          ordered: false,
        });
      } catch (error) {
        const writeErrors = error.writeErrors || (error.result && error.result.writeErrors) || [];
        if (writeErrors.length === 0) throw error;
        for (const writeError of writeErrors) {
          const index = writeError.index !== undefined ? writeError.index : writeError.err && writeError.err.index;
          writeErrorsByIndex.set(index, writeError.errmsg || (writeError.err && writeError.err.errmsg) || "write failed");
        }
      }
    }

    // Read back what is stored, so the acknowledgement states what the backend
    // actually holds rather than what it was asked to hold.
    const results = await this.classifyStoredRevisions(
      ownerId,
      device.deviceId,
      preparedItems,
      writeErrorsByIndex
    );
    results.push(...rejected);

    const appliedCount = results.filter((r) => r.status === "applied").length;
    const staleCount = results.filter((r) => r.status === "stale").length;
    const rejectedCount = results.filter((r) => r.status === "rejected").length;

    const dates = Array.from(new Set(preparedItems.map((i) => i.date))).sort();

    const batch = await TimeManagementDeviceSyncBatchModel.create({
      batchId,
      userId: ownerId,
      deviceId: device.deviceId,
      itemCount: items.length,
      appliedCount,
      staleCount,
      rejectedCount,
      dates,
      status: rejectedCount === 0 ? "completed" : "partial",
      results,
      processedAt: new Date(),
    });

    return this.acknowledgement(batch.toObject(), { idempotent: false });
  }

  /**
   * Compares each prepared contribution with what is now stored.
   *
   * `applied` means the backend holds exactly this revision, `stale` that it
   * already holds a newer one — the client may mark both as synchronized.
   * Anything else stays pending.
   */
  async classifyStoredRevisions(userId, deviceId, preparedItems, writeErrorsByIndex) {
    if (preparedItems.length === 0) return [];

    const stored = await TimeManagementDeviceUsageModel.find(
      {
        userId,
        deviceId,
        $or: preparedItems.map((item) => ({
          appKey: item.appKey,
          date: item.date,
        })),
      },
      // Projection only: the window arrays are never needed here.
      { appKey: 1, date: 1, revision: 1, _id: 0 }
    ).lean();

    const storedByKey = new Map(
      stored.map((row) => [`${row.appKey}|${row.date}`, row.revision])
    );

    return preparedItems.map((item, index) => {
      const storedRevision = storedByKey.get(`${item.appKey}|${item.date}`);
      const identity = {
        localId: item.localId,
        appKey: item.appKey,
        appId: item.appId,
        date: item.date,
      };

      if (storedRevision === undefined) {
        return {
          ...identity,
          revision: item.revision,
          status: "rejected",
          reason: writeErrorsByIndex.get(index) || "contribution was not stored",
        };
      }
      if (storedRevision === item.revision) {
        return {
          ...identity,
          revision: item.revision,
          status: "applied",
          reason: null,
        };
      }
      if (storedRevision > item.revision) {
        return {
          ...identity,
          revision: storedRevision,
          status: "stale",
          reason: "a newer revision of this contribution is already stored",
        };
      }
      return {
        ...identity,
        revision: item.revision,
        status: "rejected",
        reason:
          writeErrorsByIndex.get(index) ||
          "the stored revision is older than the uploaded one",
      };
    });
  }

  /** The wire shape of an acknowledgement. */
  acknowledgement(batch, { idempotent }) {
    return {
      batchId: batch.batchId,
      deviceId: batch.deviceId,
      status: batch.status,
      itemCount: batch.itemCount,
      appliedCount: batch.appliedCount,
      staleCount: batch.staleCount,
      rejectedCount: batch.rejectedCount,
      dates: batch.dates,
      // The client marks a contribution synchronized only when it appears here
      // as applied or stale.
      results: (batch.results || []).map((r) => ({
        localId: r.localId || null,
        appKey: r.appKey,
        appId: r.appId,
        date: r.date,
        revision: r.revision,
        status: r.status,
        reason: r.reason || null,
      })),
      processedAt: batch.processedAt,
      idempotent,
    };
  }

  /** The stored acknowledgement of a batch, for a client that lost its copy. */
  async getBatchAcknowledgement(userId, batchId) {
    const batch = await TimeManagementDeviceSyncBatchModel.findOne({
      batchId,
    }).lean();
    if (!batch) {
      throw new ApiError("Sync batch not found", 404);
    }
    if (batch.userId.toString() !== userId.toString()) {
      throw new ApiError("Unauthorized to view this sync batch", 403);
    }
    return this.acknowledgement(batch, { idempotent: true });
  }

  // -------------------------------------------------------------------------
  // Read path
  // -------------------------------------------------------------------------

  /**
   * Whose usage the caller may read.
   *
   * Their own by default. Another user's only when that user shares their
   * tracked time with the caller through an accepted configuration, which is
   * the same rule the existing report endpoint applies.
   */
  async resolveTargetUserId(callerId, requestedUserId) {
    if (!requestedUserId || requestedUserId.toString() === callerId.toString()) {
      return new mongoose.Types.ObjectId(callerId.toString());
    }

    const share = await TimeManagementShareModel.findOne({
      senderUserId: requestedUserId,
      recipientUserId: callerId,
      status: "accepted",
    })
      .select("_id")
      .lean();

    if (!share) {
      throw new ApiError(
        "No accepted sharing relationship exists with this user",
        403
      );
    }

    return new mongoose.Types.ObjectId(requestedUserId.toString());
  }

  /** `date` is shorthand for a one-day range. */
  dateMatch({ date, dateFrom, dateTo }) {
    const from = date || dateFrom;
    const to = date || dateTo;
    if (from && to) return { $gte: from, $lte: to };
    if (from) return { $gte: from };
    if (to) return { $lte: to };
    return null;
  }

  /**
   * Aggregated usage across every device of one user.
   *
   * Everything is grouped and paginated inside MongoDB, so a mobile client
   * never downloads usage history to add it up, and the window arrays are
   * projected away unless the caller asks for one application's detail.
   */
  async getAggregatedUsage(callerId, queryParams = {}) {
    const {
      userId: requestedUserId,
      date,
      dateFrom,
      dateTo,
      appId,
      appName,
      deviceId,
      includeWindows,
      page = 1,
      limit = DEFAULT_PAGE_SIZE,
    } = queryParams;

    const targetUserId = await this.resolveTargetUserId(
      callerId,
      requestedUserId
    );

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_SIZE)
    );
    const skip = (parsedPage - 1) * parsedLimit;

    const match = { userId: targetUserId };
    const dateRange = this.dateMatch({ date, dateFrom, dateTo });
    if (dateRange) match.date = dateRange;
    if (deviceId) match.deviceId = deviceId;

    const resolvedAppId = appId || (appName ? normalizeAppId(appName) : null);
    if (resolvedAppId) match.appId = resolvedAppId;

    const wantsWindows =
      (includeWindows === true || includeWindows === "true") &&
      Boolean(resolvedAppId);

    const facets = {
      summary: [
        {
          $group: {
            _id: null,
            totalDuration: { $sum: "$totalDuration" },
            days: { $addToSet: "$date" },
            devices: { $addToSet: "$deviceId" },
            apps: { $addToSet: "$appId" },
            lastSyncAt: { $max: "$lastSyncAt" },
          },
        },
      ],
      // Per application, with each device's own contribution listed: two
      // devices are summed, never merged into one contribution.
      byApp: [
        {
          $group: {
            _id: { appId: "$appId", deviceId: "$deviceId" },
            appName: { $last: "$appName" },
            deviceName: { $last: "$deviceName" },
            totalDuration: { $sum: "$totalDuration" },
          },
        },
        {
          $group: {
            _id: "$_id.appId",
            appName: { $last: "$appName" },
            totalDuration: { $sum: "$totalDuration" },
            devices: {
              $push: {
                deviceId: "$_id.deviceId",
                deviceName: "$deviceName",
                totalDuration: "$totalDuration",
              },
            },
          },
        },
        { $sort: { totalDuration: -1, _id: 1 } },
        { $skip: skip },
        { $limit: parsedLimit },
        {
          $project: {
            _id: 0,
            appId: "$_id",
            appName: 1,
            totalDuration: 1,
            devices: 1,
          },
        },
      ],
      appCount: [{ $group: { _id: "$appId" } }, { $count: "total" }],
      byDate: [
        {
          $group: { _id: "$date", totalDuration: { $sum: "$totalDuration" } },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", totalDuration: 1 } },
      ],
      byDevice: [
        {
          $group: {
            _id: "$deviceId",
            deviceName: { $last: "$deviceName" },
            platform: { $last: "$platform" },
            totalDuration: { $sum: "$totalDuration" },
            lastSyncAt: { $max: "$lastSyncAt" },
          },
        },
        { $sort: { totalDuration: -1 } },
        {
          $project: {
            _id: 0,
            deviceId: "$_id",
            deviceName: 1,
            platform: 1,
            totalDuration: 1,
            lastSyncAt: 1,
          },
        },
      ],
    };

    if (wantsWindows) {
      facets.windows = [
        { $unwind: "$windows" },
        {
          $group: {
            _id: "$windows.title",
            durationMs: { $sum: "$windows.durationMs" },
          },
        },
        { $sort: { durationMs: -1 } },
        { $limit: MAX_WINDOWS },
        { $project: { _id: 0, title: "$_id", durationMs: 1 } },
      ];
    }

    const [result] = await TimeManagementDeviceUsageModel.aggregate([
      { $match: match },
      { $facet: facets },
    ]);

    const summary = (result && result.summary && result.summary[0]) || null;
    const appCount = (result && result.appCount && result.appCount[0]) || null;
    const total = appCount ? appCount.total : 0;

    return {
      summary: {
        totalDuration: summary ? summary.totalDuration : 0,
        totalDays: summary ? summary.days.length : 0,
        totalApps: summary ? summary.apps.length : 0,
        totalDevices: summary ? summary.devices.length : 0,
        lastSyncAt: summary ? summary.lastSyncAt : null,
        dateFrom: date || dateFrom || null,
        dateTo: date || dateTo || null,
      },
      byApp: (result && result.byApp) || [],
      byDate: (result && result.byDate) || [],
      byDevice: (result && result.byDevice) || [],
      ...(wantsWindows ? { windows: (result && result.windows) || [] } : {}),
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        pages: Math.ceil(total / parsedLimit),
      },
    };
  }
}

module.exports = new TimeManagementDeviceUsageService();
module.exports.MAX_PAGE_SIZE = MAX_PAGE_SIZE;
module.exports.DEFAULT_PAGE_SIZE = DEFAULT_PAGE_SIZE;
