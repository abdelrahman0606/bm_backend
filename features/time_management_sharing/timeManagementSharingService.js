const mongoose = require("mongoose");
const TimeManagementShareModel = require("./timeManagementShareModel");
const TimeManagementUsageModel = require("./timeManagementUsageModel");
const TimeManagementSyncBatchModel = require("./timeManagementSyncBatchModel");
const TimeManagementShareDeliveryModel = require("./timeManagementShareDeliveryModel");
const UserModel = require("../users/userModel");
const CompanyModel = require("../companies/companyModel");
const NotificationHelper = require("../notifications/notificationHelper");
const {
  NotificationType,
  NotificationPriority,
} = require("../notifications/notificationEnums");
const {
  normalizeSchedule,
  computeNextRunAt,
  occurrenceKeyFor,
  localDateString,
} = require("./timeManagementScheduleUtils");
const ApiError = require("../../utils/apiError");

const SHARE_SCOPES = ["personal", "company", "person"];
const SHARE_MODES = ["manual", "automatic"];

/** Statuses that must never authorize a delivery. */
const CLOSED_STATUSES = ["rejected", "revoked", "disconnected", "cancelled"];

class TimeManagementSharingService {
  // -------------------------------------------------------------------------
  // Authorization helpers
  // -------------------------------------------------------------------------

  /**
   * Company access follows the rule already used by the reports endpoint:
   * the company owner, or a user with a managing role.
   */
  async assertCompanyAccess(userId, companyId) {
    const company = await CompanyModel.findOne({
      $or: [
        mongoose.Types.ObjectId.isValid(companyId) ? { _id: companyId } : null,
        { id: companyId },
      ].filter(Boolean),
    });

    if (!company) {
      throw new ApiError("Company not found", 404);
    }

    if (company.createdBy.toString() !== userId.toString()) {
      const user = await UserModel.findById(userId);
      if (!user || !["master", "admin", "manager"].includes(user.role)) {
        throw new ApiError("Unauthorized to access company time sharing", 403);
      }
    }

    return company;
  }

  /** True when this user may read the share and the usage behind it. */
  async canReadShare(userId, share) {
    const id = userId.toString();
    const senderId = share.senderUserId._id
      ? share.senderUserId._id.toString()
      : share.senderUserId.toString();
    const recipientId = share.recipientUserId
      ? share.recipientUserId._id
        ? share.recipientUserId._id.toString()
        : share.recipientUserId.toString()
      : null;

    if (senderId === id || recipientId === id) return true;

    if (share.shareScope === "company" && share.companyId) {
      try {
        await this.assertCompanyAccess(userId, share.companyId);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Recomputes `nextRunAt` from the current mode, schedule and status.
   * A configuration is only ever scheduled when it is allowed to deliver, so a
   * pending, rejected, revoked, disconnected or cancelled relationship can
   * never be picked up by the scheduler.
   */
  applyScheduleState(share, from = new Date()) {
    const eligible =
      share.shareMode === "automatic" &&
      share.schedule &&
      share.schedule.enabled !== false &&
      share.status === "accepted";

    share.nextRunAt = eligible ? computeNextRunAt(share.schedule, from) : null;
    return share;
  }

  // -------------------------------------------------------------------------
  // Share Time configurations
  // -------------------------------------------------------------------------

  async createShare(senderUserId, data) {
    const {
      recipientUserId,
      filterId,
      filterName,
      title,
      filterDefinition,
      schemaVersion,
      scops,
      metadata,
      invitationLink,
      companyId,
      shareMode,
      schedule,
    } = data;

    const resolvedFilterName = filterName || title;
    const shareScope = data.shareScope || (recipientUserId ? "person" : "personal");

    if (!SHARE_SCOPES.includes(shareScope)) {
      throw new ApiError(
        `shareScope must be one of ${SHARE_SCOPES.join(", ")}`,
        400
      );
    }

    const resolvedMode = shareMode || "manual";
    if (!SHARE_MODES.includes(resolvedMode)) {
      throw new ApiError(`shareMode must be one of ${SHARE_MODES.join(", ")}`, 400);
    }

    const normalizedSchedule = normalizeSchedule(schedule);
    if (resolvedMode === "automatic" && !normalizedSchedule) {
      throw new ApiError("schedule is required for automatic sharing", 400);
    }

    // Resolve the recipient per scope. Personal and company configurations
    // belong to the owner, so the owner is also the recipient of the data and
    // nothing is ever delivered to another user.
    let resolvedRecipientId = senderUserId;
    let resolvedCompanyId = null;

    if (shareScope === "person") {
      if (!recipientUserId) {
        throw new ApiError("recipientUserId is required for person sharing", 400);
      }
      if (senderUserId.toString() === recipientUserId.toString()) {
        throw new ApiError("Cannot share filter with yourself", 400);
      }
      const recipient = await UserModel.findById(recipientUserId);
      if (!recipient) {
        throw new ApiError("Recipient not found", 404);
      }
      resolvedRecipientId = recipientUserId;
    } else if (shareScope === "company") {
      if (!companyId) {
        throw new ApiError("companyId is required for company sharing", 400);
      }
      const company = await this.assertCompanyAccess(senderUserId, companyId);
      resolvedCompanyId = company._id.toString();
    }

    // Duplicate handling. A person-scope request that is already pending or
    // active is rejected so the recipient is not spammed; a personal or company
    // configuration is idempotent and simply updated in place.
    const existingActive = await TimeManagementShareModel.findOne({
      senderUserId,
      recipientUserId: resolvedRecipientId,
      filterId,
      status: { $in: ["pending", "accepted"] },
    });

    if (existingActive) {
      if (shareScope === "person") {
        throw new ApiError(
          existingActive.status === "pending"
            ? "A pending share for this filter already exists with this user"
            : "An active share for this filter already exists with this user",
          400
        );
      }

      existingActive.filterName = resolvedFilterName || existingActive.filterName;
      if (filterDefinition !== undefined) {
        existingActive.filterDefinition = filterDefinition;
      }
      if (scops !== undefined) existingActive.scops = scops;
      if (metadata !== undefined) existingActive.metadata = metadata;
      existingActive.shareScope = shareScope;
      existingActive.companyId = resolvedCompanyId;
      existingActive.shareMode = resolvedMode;
      existingActive.schedule = normalizedSchedule;
      this.applyScheduleState(existingActive);
      await existingActive.save();
      return existingActive;
    }

    const share = await TimeManagementShareModel.create({
      senderUserId,
      recipientUserId: resolvedRecipientId,
      shareScope,
      companyId: resolvedCompanyId,
      shareMode: resolvedMode,
      schedule: normalizedSchedule,
      filterId,
      filterName: resolvedFilterName,
      filterDefinition,
      schemaVersion: schemaVersion || 1,
      scops: scops || {},
      metadata: metadata || {},
      invitationLink: invitationLink || null,
      // Only person-to-person sharing needs the recipient's approval.
      status: shareScope === "person" ? "pending" : "accepted",
      acceptedAt: shareScope === "person" ? null : new Date(),
    });

    this.applyScheduleState(share);
    await share.save();

    if (shareScope === "person") {
      await this.notifyShareRequest(share);
    }

    return share;
  }

  /**
   * Company a notification is filed under. The notification collection
   * requires one, so a share with no company falls back to a company of the
   * owner; when there is none the notification is still pushed in realtime but
   * not stored (`withDatabase: false`).
   */
  async resolveNotificationCompanyId(share) {
    if (share.companyId && mongoose.Types.ObjectId.isValid(share.companyId)) {
      return share.companyId;
    }
    const company =
      (await CompanyModel.findOne({
        createdBy: share.senderUserId.toString(),
        isPrimary: true,
      })) ||
      (await CompanyModel.findOne({ createdBy: share.senderUserId.toString() }));
    return company ? company._id.toString() : null;
  }

  /**
   * Single entry point for the feature's notifications, shaped the way the
   * existing notification model expects (`action.type/entityId/route`).
   */
  async sendShareNotification(share, { userId, createdBy, type, title, body, actionType, metadata }) {
    const companyId = await this.resolveNotificationCompanyId(share);
    return NotificationHelper.send({
      companyId: companyId || undefined,
      withDatabase: companyId ? true : "false",
      userId: userId.toString(),
      type,
      priority: NotificationPriority.NORMAL,
      title,
      body,
      createdBy: createdBy.toString(),
      action: {
        type: actionType,
        entityId: share._id.toString(),
        route: `/time-management-shares/${share._id.toString()}`,
      },
      metadata: {
        shareId: share._id.toString(),
        filterId: share.filterId,
        filterName: share.filterName,
        shareScope: share.shareScope,
        status: share.status,
        ...(metadata || {}),
      },
    });
  }

  /** Sends the pending sharing request to the recipient's inbox. */
  async notifyShareRequest(share) {
    const sender = await UserModel.findById(share.senderUserId);
    return this.sendShareNotification(share, {
      userId: share.recipientUserId,
      createdBy: share.senderUserId,
      type: NotificationType.INVITATION,
      actionType: "time_management_share",
      title: "Time sharing request",
      body: `${sender ? sender.fullName : "A user"} wants to share the tracked time of "${share.filterName}" with you`,
    });
  }

  /** Tells the owner what the recipient decided. */
  async notifyShareDecision(share, decision) {
    const recipient = await UserModel.findById(share.recipientUserId);
    return this.sendShareNotification(share, {
      userId: share.senderUserId,
      createdBy: share.recipientUserId,
      type: NotificationType.STATUS_CHANGED,
      actionType: "time_management_share",
      title: `Time sharing ${decision}`,
      body: `${recipient ? recipient.fullName : "The recipient"} ${decision} your "${share.filterName}" time sharing request`,
      metadata: { decision },
    });
  }

  async updateShare(userId, shareId, data) {
    const share = await TimeManagementShareModel.findById(shareId);
    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    if (share.senderUserId.toString() !== userId.toString()) {
      throw new ApiError("Only the owner can update the shared filter", 403);
    }

    if (["revoked", "disconnected", "cancelled"].includes(share.status)) {
      throw new ApiError(`Cannot update a ${share.status} share`, 400);
    }

    const {
      filterName,
      title,
      filterDefinition,
      schemaVersion,
      scops,
      metadata,
      shareMode,
      schedule,
    } = data;

    if (filterName || title) {
      share.filterName = filterName || title;
    }
    if (filterDefinition !== undefined) {
      share.filterDefinition = filterDefinition;
    }
    if (schemaVersion !== undefined) {
      share.schemaVersion = schemaVersion;
    }
    if (scops !== undefined) {
      share.scops = scops;
    }
    if (metadata !== undefined) {
      share.metadata = metadata;
    }

    // Sharing mode and schedule may be edited together with the configuration.
    let scheduleTouched = false;
    if (shareMode !== undefined) {
      if (!SHARE_MODES.includes(shareMode)) {
        throw new ApiError(
          `shareMode must be one of ${SHARE_MODES.join(", ")}`,
          400
        );
      }
      share.shareMode = shareMode;
      scheduleTouched = true;
    }
    if (schedule !== undefined) {
      share.schedule = normalizeSchedule(schedule);
      scheduleTouched = true;
    }
    if (share.shareMode === "automatic" && !share.schedule) {
      throw new ApiError("schedule is required for automatic sharing", 400);
    }
    if (scheduleTouched) {
      // A changed schedule only affects future occurrences.
      this.applyScheduleState(share);
    }

    await share.save();
    return share;
  }

  /**
   * Changes only the sharing mode / schedule of a configuration.
   * Owner-only, and never resumes a closed relationship.
   */
  async updateShareSchedule(userId, shareId, data) {
    const share = await TimeManagementShareModel.findById(shareId);
    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    if (share.senderUserId.toString() !== userId.toString()) {
      throw new ApiError("Only the owner can change the sharing schedule", 403);
    }

    if (CLOSED_STATUSES.includes(share.status)) {
      throw new ApiError(`Cannot schedule a ${share.status} share`, 400);
    }

    const { shareMode, schedule } = data;

    if (shareMode !== undefined) {
      if (!SHARE_MODES.includes(shareMode)) {
        throw new ApiError(
          `shareMode must be one of ${SHARE_MODES.join(", ")}`,
          400
        );
      }
      share.shareMode = shareMode;
    }

    if (schedule !== undefined) {
      share.schedule = normalizeSchedule(schedule);
    }

    if (share.shareMode === "automatic" && !share.schedule) {
      throw new ApiError("schedule is required for automatic sharing", 400);
    }

    this.applyScheduleState(share);
    await share.save();
    return share;
  }

  async getAllMyShares(userId, queryParams) {
    const { page = 1, limit = 20, status } = queryParams;
    const skip = (page - 1) * limit;

    const query = {
      $or: [{ senderUserId: userId }, { recipientUserId: userId }],
    };

    if (status) {
      query.status = status;
    }

    const [shares, total] = await Promise.all([
      TimeManagementShareModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate("senderUserId", "fullName email photo role")
        .populate("recipientUserId", "fullName email photo role")
        .exec(),
      TimeManagementShareModel.countDocuments(query),
    ]);

    return {
      shares,
      pagination: {
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getReceivedShares(userId, queryParams) {
    const { page = 1, limit = 20, status } = queryParams;
    const skip = (page - 1) * limit;

    const query = { recipientUserId: userId };
    if (status) query.status = status;

    const [shares, total] = await Promise.all([
      TimeManagementShareModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate("senderUserId", "fullName email photo role")
        .exec(),
      TimeManagementShareModel.countDocuments(query),
    ]);

    return {
      shares,
      pagination: {
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getSentShares(userId, queryParams) {
    const { page = 1, limit = 20, status } = queryParams;
    const skip = (page - 1) * limit;

    const query = { senderUserId: userId };
    if (status) query.status = status;

    const [shares, total] = await Promise.all([
      TimeManagementShareModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .populate("recipientUserId", "fullName email photo role")
        .exec(),
      TimeManagementShareModel.countDocuments(query),
    ]);

    return {
      shares,
      pagination: {
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getSharesByUser(currentUserId, targetUserId, queryParams) {
    if (currentUserId.toString() !== targetUserId.toString()) {
      throw new ApiError("Unauthorized to view this user's shares", 403);
    }

    return this.getAllMyShares(currentUserId, queryParams);
  }

  async getSingleShare(userId, shareId) {
    const share = await TimeManagementShareModel.findById(shareId)
      .populate("senderUserId", "fullName email photo role")
      .populate("recipientUserId", "fullName email photo role");

    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    const allowed = await this.canReadShare(userId, share);
    if (!allowed) {
      throw new ApiError("Unauthorized to access this share", 403);
    }

    return share;
  }

  async acceptShare(userId, shareId) {
    const share = await TimeManagementShareModel.findById(shareId);

    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    if (share.recipientUserId.toString() !== userId.toString()) {
      throw new ApiError("Only the recipient can accept the share", 403);
    }

    if (share.status !== "pending") {
      throw new ApiError("Can only accept a pending share", 400);
    }

    share.status = "accepted";
    share.acceptedAt = new Date();
    // Approval is what makes an automatic configuration eligible: the first
    // occurrence is scheduled from the moment the recipient accepted.
    this.applyScheduleState(share);
    await share.save();

    await this.notifyShareDecision(share, "accepted");

    return share;
  }

  async rejectShare(userId, shareId) {
    const share = await TimeManagementShareModel.findById(shareId);

    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    if (share.recipientUserId.toString() !== userId.toString()) {
      throw new ApiError("Only the recipient can reject the share", 403);
    }

    if (share.status !== "pending") {
      throw new ApiError("Can only reject a pending share", 400);
    }

    share.status = "rejected";
    share.rejectedAt = new Date();
    share.nextRunAt = null;
    await share.save();

    await this.notifyShareDecision(share, "rejected");

    return share;
  }

  async cancelShare(userId, shareId) {
    const share = await TimeManagementShareModel.findById(shareId);

    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    if (share.senderUserId.toString() !== userId.toString()) {
      throw new ApiError("Only the sender can cancel the share", 403);
    }

    if (share.status !== "pending") {
      throw new ApiError("Can only cancel a pending share", 400);
    }

    share.status = "cancelled";
    share.cancelledAt = new Date();
    share.nextRunAt = null;
    await share.save();

    return { id: share._id, status: "cancelled" };
  }

  async revokeShare(userId, shareId) {
    const share = await TimeManagementShareModel.findById(shareId);

    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    if (share.senderUserId.toString() !== userId.toString()) {
      throw new ApiError("Only the owner can revoke the share", 403);
    }

    if (share.status === "revoked") {
      throw new ApiError("Share is already revoked", 400);
    }

    share.status = "revoked";
    share.revokedAt = new Date();
    // Revoking stops every future scheduled delivery immediately.
    share.nextRunAt = null;
    await share.save();

    return share;
  }

  async disconnectShare(userId, shareId) {
    const share = await TimeManagementShareModel.findById(shareId);

    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    if (share.recipientUserId.toString() !== userId.toString()) {
      throw new ApiError("Only the recipient can disconnect the share", 403);
    }

    if (share.status === "disconnected") {
      throw new ApiError("Share is already disconnected", 400);
    }

    share.status = "disconnected";
    share.disconnectedAt = new Date();
    share.nextRunAt = null;
    await share.save();

    return share;
  }

  async syncUsage(senderUserId, data) {
    const { batchId, filterId, recipientId, date, syncType = "delta", totalDuration, apps = [] } = data;

    // 1. Verify sharing relationship
    const share = await TimeManagementShareModel.findOne({
      senderUserId,
      recipientUserId: recipientId,
      filterId,
    });

    if (!share) {
      throw new ApiError("No active sharing relationship found for this filter and recipient", 404);
    }

    if (share.status === "pending") {
      throw new ApiError("Sharing invitation has not been accepted yet", 403);
    }
    if (share.status === "rejected") {
      throw new ApiError("Sharing invitation was rejected", 403);
    }
    if (share.status === "revoked") {
      throw new ApiError("Sharing relationship was revoked by owner", 403);
    }
    if (share.status === "disconnected") {
      throw new ApiError("Sharing relationship was disconnected by recipient", 403);
    }
    if (share.status !== "accepted") {
      throw new ApiError("Sharing relationship is not active", 403);
    }

    // 2. Check for existing batch (Idempotency check)
    const existingBatch = await TimeManagementSyncBatchModel.findOne({ batchId });
    if (existingBatch) {
      return {
        batchId: existingBatch.batchId,
        filterId: existingBatch.filterId,
        recipientId: existingBatch.recipientUserId,
        date: existingBatch.date,
        totalDuration: existingBatch.totalDuration,
        recordedAt: existingBatch.processedAt,
        idempotent: true,
        message: "Batch already processed",
      };
    }

    // 3. Atomically record batch and aggregate usage
    let session = null;
    let useTransaction = false;

    try {
      session = await mongoose.startSession();
      session.startTransaction();
      useTransaction = true;
    } catch {
      session = null;
      useTransaction = false;
    }

    let batchCreated = false;

    try {
      // Create batch record with unique batchId index enforcement
      const sessionOption = useTransaction ? { session } : {};
      await TimeManagementSyncBatchModel.create(
        [
          {
            batchId,
            shareId: share._id,
            senderUserId,
            recipientUserId: recipientId,
            filterId,
            date,
            syncType: syncType || "delta",
            totalDuration,
            appCount: apps.length,
            status: "completed",
            processedAt: new Date(),
          },
        ],
        sessionOption
      );
      batchCreated = true;

      // Find or create daily usage document
      const query = {
        senderUserId,
        recipientUserId: recipientId,
        filterId,
        date,
      };

      let usageDoc = useTransaction
        ? await TimeManagementUsageModel.findOne(query).session(session)
        : await TimeManagementUsageModel.findOne(query);

      if (!usageDoc) {
        usageDoc = new TimeManagementUsageModel({
          shareId: share._id,
          senderUserId,
          recipientUserId: recipientId,
          filterId,
          date,
          totalDuration: 0,
          apps: [],
          lastSyncAt: new Date(),
        });
      }

      // An absolute batch carries the full state of that day, so it replaces
      // what was stored. This keeps re-sharing the same day idempotent instead
      // of adding the totals a second time.
      if (syncType === "absolute") {
        usageDoc.totalDuration = totalDuration;
        usageDoc.apps = apps.map((app) => ({
          appName: app.appName,
          totalDuration: app.totalDuration || 0,
          windows: (app.windows || []).map((w) => ({
            title: w.title,
            durationMs: w.durationMs || 0,
          })),
        }));
        usageDoc.lastSyncAt = new Date();

        if (useTransaction) {
          await usageDoc.save({ session });
          await session.commitTransaction();
        } else {
          await usageDoc.save();
        }

        return {
          batchId,
          filterId,
          recipientId,
          date,
          totalDuration,
          recordedAt: new Date(),
          idempotent: false,
          message: "Usage batch synchronized successfully",
        };
      }

      // Aggregate totalDuration
      usageDoc.totalDuration += totalDuration;

      // Merge application and window totals using stable keys
      for (const app of apps) {
        let existingApp = usageDoc.apps.find((a) => a.appName === app.appName);
        if (!existingApp) {
          usageDoc.apps.push({
            appName: app.appName,
            totalDuration: app.totalDuration || 0,
            windows: (app.windows || []).map((w) => ({
              title: w.title,
              durationMs: w.durationMs || 0,
            })),
          });
        } else {
          existingApp.totalDuration += app.totalDuration || 0;
          const windowsToAdd = app.windows || [];
          for (const win of windowsToAdd) {
            let existingWin = existingApp.windows.find((w) => w.title === win.title);
            if (!existingWin) {
              existingApp.windows.push({
                title: win.title,
                durationMs: win.durationMs || 0,
              });
            } else {
              existingWin.durationMs += win.durationMs || 0;
            }
          }
        }
      }

      usageDoc.lastSyncAt = new Date();

      if (useTransaction) {
        await usageDoc.save({ session });
        await session.commitTransaction();
      } else {
        await usageDoc.save();
      }

      return {
        batchId,
        filterId,
        recipientId,
        date,
        totalDuration,
        recordedAt: new Date(),
        idempotent: false,
        message: "Usage batch synchronized successfully",
      };
    } catch (error) {
      if (useTransaction && session) {
        try {
          await session.abortTransaction();
        } catch {
          // ignore session abort errors
        }
      } else if (batchCreated) {
        // Rollback created batch if standalone mongo failed during usage aggregation
        try {
          await TimeManagementSyncBatchModel.deleteOne({ batchId });
        } catch {
          // ignore cleanup errors
        }
      }

      // Handle concurrent submission (duplicate key code 11000 or WriteConflict code 112)
      if (
        error.code === 11000 ||
        error.code === 112 ||
        (error.hasErrorLabel && error.hasErrorLabel("TransientTransactionError"))
      ) {
        // Wait briefly for the concurrent winning transaction to commit
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          const concurrentBatch = await TimeManagementSyncBatchModel.findOne({ batchId });
          if (concurrentBatch) {
            return {
              batchId,
              filterId,
              recipientId,
              date,
              totalDuration: concurrentBatch.totalDuration,
              recordedAt: concurrentBatch.processedAt,
              idempotent: true,
              message: "Batch already processed",
            };
          }
        }
      }

      throw error;
    } finally {
      if (session) {
        try {
          session.endSession();
        } catch {
          // ignore session end errors
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Deliveries (manual sharing + scheduled automatic sharing)
  // -------------------------------------------------------------------------

  /** Throws unless the relationship currently authorizes a delivery. */
  assertCanDeliver(share) {
    if (share.status === "pending") {
      throw new ApiError("Sharing invitation has not been accepted yet", 403);
    }
    if (CLOSED_STATUSES.includes(share.status)) {
      throw new ApiError(`Sharing relationship is ${share.status}`, 403);
    }
    if (share.status !== "accepted") {
      throw new ApiError("Sharing relationship is not active", 403);
    }
  }

  /**
   * Summarises the usage already synced for this configuration over an
   * inclusive local date range. The recipient only ever sees usage that the
   * owner explicitly synced for this filter.
   */
  async buildDeliverySnapshot(share, dateFrom, dateTo) {
    const query = {
      senderUserId: share.senderUserId,
      recipientUserId: share.recipientUserId,
      filterId: share.filterId,
    };

    if (dateFrom && dateTo) {
      query.date = { $gte: dateFrom, $lte: dateTo };
    } else if (dateFrom) {
      query.date = { $gte: dateFrom };
    } else if (dateTo) {
      query.date = { $lte: dateTo };
    }

    const records = await TimeManagementUsageModel.find(query).lean();

    const appNames = new Set();
    let totalDuration = 0;
    for (const record of records) {
      totalDuration += record.totalDuration || 0;
      for (const app of record.apps || []) appNames.add(app.appName);
    }

    return {
      totalDuration,
      appCount: appNames.size,
      dayCount: records.length,
    };
  }

  /**
   * Records one delivery. Safe to call twice for the same occurrence: the
   * unique (shareId, occurrenceKey) index makes the second call return the
   * delivery already stored instead of creating a duplicate.
   */
  async createDelivery(share, { occurrenceKey, trigger, dateFrom, dateTo }) {
    const existing = await TimeManagementShareDeliveryModel.findOne({
      shareId: share._id,
      occurrenceKey,
    });
    if (existing) {
      return { delivery: existing, duplicate: true };
    }

    const snapshot = await this.buildDeliverySnapshot(share, dateFrom, dateTo);

    let delivery;
    try {
      delivery = await TimeManagementShareDeliveryModel.create({
        shareId: share._id,
        senderUserId: share.senderUserId,
        recipientUserId: share.recipientUserId,
        filterId: share.filterId,
        occurrenceKey,
        trigger,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        totalDuration: snapshot.totalDuration,
        appCount: snapshot.appCount,
        dayCount: snapshot.dayCount,
        status: snapshot.dayCount === 0 ? "empty" : "delivered",
      });
    } catch (error) {
      // Concurrent delivery of the same occurrence: keep the winner.
      if (error.code === 11000) {
        const winner = await TimeManagementShareDeliveryModel.findOne({
          shareId: share._id,
          occurrenceKey,
        });
        if (winner) return { delivery: winner, duplicate: true };
      }
      throw error;
    }

    // Person-scope deliveries are the only ones another user has to be told
    // about; personal and company configurations deliver to the owner.
    if (
      share.shareScope === "person" &&
      delivery.status === "delivered" &&
      share.recipientUserId.toString() !== share.senderUserId.toString()
    ) {
      const sender = await UserModel.findById(share.senderUserId);
      await this.sendShareNotification(share, {
        userId: share.recipientUserId,
        createdBy: share.senderUserId,
        type: NotificationType.GENERAL,
        actionType: "time_management_delivery",
        title: "Tracked time shared",
        body: `${sender ? sender.fullName : "A user"} shared the tracked time of "${share.filterName}"`,
        metadata: {
          deliveryId: delivery._id.toString(),
          totalDuration: delivery.totalDuration,
          dateFrom: delivery.dateFrom,
          dateTo: delivery.dateTo,
          trigger: delivery.trigger,
        },
      });
    }

    return { delivery, duplicate: false };
  }

  /** Owner-initiated ("manual") sharing of the saved configuration. */
  async shareNow(userId, shareId, data = {}) {
    const share = await TimeManagementShareModel.findById(shareId);
    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    if (share.senderUserId.toString() !== userId.toString()) {
      throw new ApiError("Only the owner can share this configuration", 403);
    }

    this.assertCanDeliver(share);

    const tz = share.schedule ? share.schedule.timezoneOffsetMinutes : 0;
    const today = localDateString(new Date(), tz);
    const dateFrom = data.dateFrom || data.startDate || today;
    const dateTo = data.dateTo || data.endDate || today;

    if (dateFrom > dateTo) {
      throw new ApiError("dateFrom must not be after dateTo", 400);
    }

    const result = await this.createDelivery(share, {
      occurrenceKey:
        data.occurrenceKey || `manual:${new Date().toISOString()}`,
      trigger: "manual",
      dateFrom,
      dateTo,
    });

    share.lastRunAt = new Date();
    await share.save();

    return {
      shareId: share._id,
      delivery: result.delivery,
      duplicate: result.duplicate,
    };
  }

  async getDeliveries(userId, shareId, queryParams = {}) {
    const share = await TimeManagementShareModel.findById(shareId);
    if (!share) {
      throw new ApiError("Share not found", 404);
    }

    const allowed = await this.canReadShare(userId, share);
    if (!allowed) {
      throw new ApiError("Unauthorized to access this share", 403);
    }

    const { page = 1, limit = 20 } = queryParams;
    const skip = (page - 1) * limit;

    const [deliveries, total] = await Promise.all([
      TimeManagementShareDeliveryModel.find({ shareId: share._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .exec(),
      TimeManagementShareDeliveryModel.countDocuments({ shareId: share._id }),
    ]);

    return {
      deliveries,
      pagination: {
        total,
        page: parseInt(page, 10),
        pages: Math.ceil(total / limit),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Scheduler
  // -------------------------------------------------------------------------

  /**
   * Atomically claims one due configuration and moves its `nextRunAt` to the
   * following occurrence, so a second worker (or a retry of this one) cannot
   * pick up the same occurrence.
   *
   * Returns `{ share, occurrenceAt }` or `null` when nothing is due.
   */
  async claimDueShare(now = new Date()) {
    const candidate = await TimeManagementShareModel.findOne({
      shareMode: "automatic",
      status: "accepted",
      "schedule.enabled": true,
      nextRunAt: { $ne: null, $lte: now },
    }).sort({ nextRunAt: 1 });

    if (!candidate) return null;

    const occurrenceAt = candidate.nextRunAt;
    const nextRunAt = computeNextRunAt(candidate.schedule, now);

    const claimed = await TimeManagementShareModel.findOneAndUpdate(
      { _id: candidate._id, nextRunAt: occurrenceAt },
      { $set: { nextRunAt, lockedAt: now } },
      { new: true }
    );

    // Another worker claimed it first.
    if (!claimed) return null;

    return { share: claimed, occurrenceAt };
  }

  /** Delivers one claimed occurrence. */
  async runShareOccurrence(share, occurrenceAt) {
    const tz = share.schedule ? share.schedule.timezoneOffsetMinutes : 0;
    const periodStart = share.lastRunAt || share.acceptedAt || share.createdAt;

    const dateFrom = localDateString(periodStart, tz);
    const dateTo = localDateString(occurrenceAt, tz);

    const result = await this.createDelivery(share, {
      occurrenceKey: occurrenceKeyFor(occurrenceAt),
      trigger: "scheduled",
      dateFrom: dateFrom <= dateTo ? dateFrom : dateTo,
      dateTo,
    });

    if (!result.duplicate) {
      await TimeManagementShareModel.updateOne(
        { _id: share._id },
        { $set: { lastRunAt: occurrenceAt, lockedAt: null } }
      );
    } else {
      await TimeManagementShareModel.updateOne(
        { _id: share._id },
        { $set: { lockedAt: null } }
      );
    }

    return result;
  }

  /**
   * Processes every configuration that is due. Called by the scheduler worker;
   * exposed so it can also be triggered from a test or an ops endpoint.
   */
  async runDueShares({ now = new Date(), limit = 50 } = {}) {
    const processed = [];

    for (let i = 0; i < limit; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const claim = await this.claimDueShare(now);
      if (!claim) break;

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.runShareOccurrence(
          claim.share,
          claim.occurrenceAt
        );
        processed.push({
          shareId: claim.share._id.toString(),
          occurrenceAt: claim.occurrenceAt,
          deliveryId: result.delivery._id.toString(),
          duplicate: result.duplicate,
          status: result.delivery.status,
        });
      } catch (error) {
        // Leave `nextRunAt` on the following occurrence: one failed delivery
        // must not stop the schedule or block the other configurations.
        // eslint-disable-next-line no-await-in-loop
        await TimeManagementShareModel.updateOne(
          { _id: claim.share._id },
          { $set: { lockedAt: null } }
        );
        processed.push({
          shareId: claim.share._id.toString(),
          occurrenceAt: claim.occurrenceAt,
          error: error.message,
        });
      }
    }

    return processed;
  }

  async getSyncBatchStatus(userId, batchId) {
    const batch = await TimeManagementSyncBatchModel.findOne({ batchId });
    if (!batch) {
      throw new ApiError("Sync batch not found", 404);
    }

    if (
      batch.senderUserId.toString() !== userId.toString() &&
      batch.recipientUserId.toString() !== userId.toString()
    ) {
      throw new ApiError("Unauthorized to view this sync batch", 403);
    }

    return batch;
  }

  async getReport(userId, queryParams) {
    const {
      role = "recipient",
      startDate,
      dateFrom,
      endDate,
      dateTo,
      filterId,
      employeeId,
      userId: targetUserId,
      companyId,
      appName,
    } = queryParams;

    const start = startDate || dateFrom;
    const end = endDate || dateTo;

    const query = {};

    if (role === "sender") {
      query.senderUserId = userId;
      if (employeeId && employeeId.toString() !== userId.toString()) {
        throw new ApiError("Cannot query another employee's sender data", 403);
      }
    } else {
      // Recipient view: only usage explicitly shared with this recipient
      query.recipientUserId = userId;

      const targetEmp = employeeId || targetUserId;
      if (targetEmp) {
        // Verify relationship exists
        const shareExists = await TimeManagementShareModel.findOne({
          senderUserId: targetEmp,
          recipientUserId: userId,
        });
        if (!shareExists) {
          throw new ApiError("No sharing relationship exists with the specified employee", 403);
        }
        query.senderUserId = targetEmp;
      }
    }

    if (companyId) {
      await this.assertCompanyAccess(userId, companyId);
    }

    if (filterId) {
      query.filterId = filterId;
    }

    if (start && end) {
      query.date = { $gte: start, $lte: end };
    } else if (start) {
      query.date = { $gte: start };
    } else if (end) {
      query.date = { $lte: end };
    }

    const usageRecords = await TimeManagementUsageModel.find(query)
      .populate("senderUserId", "fullName email photo role")
      .populate("recipientUserId", "fullName email photo role")
      .sort({ date: 1 })
      .lean();

    // Aggregations
    let totalDuration = 0;
    const datesSet = new Set();
    const appMap = new Map();
    const employeeMap = new Map();
    const byDateList = [];

    for (const record of usageRecords) {
      datesSet.add(record.date);

      // Filter apps if appName is specified
      const relevantApps = appName
        ? (record.apps || []).filter(
            (a) => a.appName.toLowerCase() === appName.toLowerCase()
          )
        : record.apps || [];

      const recordDuration = appName
        ? relevantApps.reduce((acc, a) => acc + (a.totalDuration || 0), 0)
        : record.totalDuration || 0;

      totalDuration += recordDuration;

      // Group by date
      let dateEntry = byDateList.find((d) => d.date === record.date);
      if (!dateEntry) {
        dateEntry = {
          date: record.date,
          totalDuration: 0,
          apps: [],
        };
        byDateList.push(dateEntry);
      }
      dateEntry.totalDuration += recordDuration;

      for (const app of relevantApps) {
        let dateApp = dateEntry.apps.find((a) => a.appName === app.appName);
        if (!dateApp) {
          dateApp = {
            appName: app.appName,
            totalDuration: 0,
            windows: [],
          };
          dateEntry.apps.push(dateApp);
        }
        dateApp.totalDuration += app.totalDuration || 0;
        for (const win of app.windows || []) {
          let dateWin = dateApp.windows.find((w) => w.title === win.title);
          if (!dateWin) {
            dateApp.windows.push({
              title: win.title,
              durationMs: win.durationMs || 0,
            });
          } else {
            dateWin.durationMs += win.durationMs || 0;
          }
        }

        // Group across overall apps
        let aggApp = appMap.get(app.appName);
        if (!aggApp) {
          aggApp = {
            appName: app.appName,
            totalDuration: 0,
            windowsMap: new Map(),
          };
          appMap.set(app.appName, aggApp);
        }
        aggApp.totalDuration += app.totalDuration || 0;
        for (const win of app.windows || []) {
          const currentWinDuration = aggApp.windowsMap.get(win.title) || 0;
          aggApp.windowsMap.set(win.title, currentWinDuration + (win.durationMs || 0));
        }
      }

      // Group by employee
      if (record.senderUserId) {
        const empId = record.senderUserId._id
          ? record.senderUserId._id.toString()
          : record.senderUserId.toString();
        let empEntry = employeeMap.get(empId);
        if (!empEntry) {
          empEntry = {
            userId: empId,
            fullName: record.senderUserId.fullName || null,
            email: record.senderUserId.email || null,
            role: record.senderUserId.role || null,
            totalDuration: 0,
          };
          employeeMap.set(empId, empEntry);
        }
        empEntry.totalDuration += recordDuration;
      }
    }

    const byAppList = Array.from(appMap.values()).map((a) => ({
      appName: a.appName,
      totalDuration: a.totalDuration,
      windows: Array.from(a.windowsMap.entries()).map(([title, durationMs]) => ({
        title,
        durationMs,
      })),
    }));

    const byEmployeeList = Array.from(employeeMap.values());

    return {
      summary: {
        totalDuration,
        totalDays: datesSet.size,
        totalApps: byAppList.length,
        startDate: start || (byDateList.length > 0 ? byDateList[0].date : null),
        endDate:
          end || (byDateList.length > 0 ? byDateList[byDateList.length - 1].date : null),
      },
      byDate: byDateList,
      byApp: byAppList,
      byEmployee: byEmployeeList,
    };
  }
}

module.exports = new TimeManagementSharingService();
