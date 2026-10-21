const crypto = require("crypto");
const TimeManagementShareModel = require("./timeManagementShareModel");
const TimeManagementShareLinkModel = require("./timeManagementShareLinkModel");
const TimeManagementUsageModel = require("./timeManagementUsageModel");
const UserModel = require("../users/userModel");
const ApiError = require("../../utils/apiError");

const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Public path a report token is served under. */
const PUBLIC_PATH = "/api/v1/public/time-reports";

const isDateString = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const todayString = () => new Date().toISOString().split("T")[0];

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

/**
 * Read-only report links.
 *
 * A link is a bearer credential: whoever holds the token can read exactly the
 * report the link was created for, until it expires or is revoked. The token is
 * high entropy (256 bits) and only its hash is stored, and nothing in the URL
 * or the rendered report exposes a database id.
 */
class TimeManagementShareLinkService {
  /** The owner of the data is the only one who may publish a link to it. */
  async assertOwnedShare(userId, shareId) {
    const share = await TimeManagementShareModel.findById(shareId);
    if (!share) {
      throw new ApiError("Share not found", 404);
    }
    if (share.senderUserId.toString() !== userId.toString()) {
      throw new ApiError(
        "Only the owner of the tracked time can create a report link",
        403
      );
    }
    return share;
  }

  async createReportLink(userId, shareId, options = {}) {
    const share = await this.assertOwnedShare(userId, shareId);

    const definition = share.filterDefinition || {};
    const fallbackFrom =
      (isDateString(options.dateFrom) && options.dateFrom) ||
      (typeof definition.dateFrom === "string"
        ? definition.dateFrom.split("T")[0]
        : null) ||
      (typeof definition.equalDate === "string"
        ? definition.equalDate.split("T")[0]
        : null) ||
      todayString();
    const fallbackTo =
      (isDateString(options.dateTo) && options.dateTo) ||
      (typeof definition.dateTo === "string"
        ? definition.dateTo.split("T")[0]
        : null) ||
      (typeof definition.equalDate === "string"
        ? definition.equalDate.split("T")[0]
        : null) ||
      fallbackFrom;

    if (!isDateString(fallbackFrom) || !isDateString(fallbackTo)) {
      throw new ApiError("dateFrom and dateTo must be YYYY-MM-DD dates", 400);
    }
    if (fallbackFrom > fallbackTo) {
      throw new ApiError("dateFrom must not be after dateTo", 400);
    }

    const requestedDays = Number(options.expiresInDays);
    const days = Number.isFinite(requestedDays)
      ? Math.trunc(requestedDays)
      : DEFAULT_EXPIRY_DAYS;
    if (days < 1 || days > MAX_EXPIRY_DAYS) {
      throw new ApiError(
        `expiresInDays must be between 1 and ${MAX_EXPIRY_DAYS}`,
        400
      );
    }

    // 256 bits of entropy, URL safe, so the token cannot be guessed or
    // enumerated the way a sequential id could.
    const token = crypto.randomBytes(32).toString("base64url");

    const link = await TimeManagementShareLinkModel.create({
      tokenHash: hashToken(token),
      shareId: share._id,
      ownerUserId: share.senderUserId,
      filterId: share.filterId,
      reportTitle: share.filterName,
      dateFrom: fallbackFrom,
      dateTo: fallbackTo,
      includeWindows: Boolean(options.includeWindows),
      expiresAt: new Date(Date.now() + days * DAY_MS),
    });

    const base = (options.baseUrl || process.env.PUBLIC_BASE_URL || "").replace(
      /\/+$/,
      ""
    );

    return {
      link,
      token,
      // The token lives in the path, never a database id.
      url: `${base}${PUBLIC_PATH}/${token}`,
    };
  }

  async listReportLinks(userId, shareId) {
    const share = await this.assertOwnedShare(userId, shareId);
    const links = await TimeManagementShareLinkModel.find({
      shareId: share._id,
    }).sort({ createdAt: -1 });
    return links;
  }

  async revokeReportLink(userId, linkId) {
    const link = await TimeManagementShareLinkModel.findById(linkId);
    if (!link) {
      throw new ApiError("Report link not found", 404);
    }
    if (link.ownerUserId.toString() !== userId.toString()) {
      throw new ApiError("Only the owner can revoke this report link", 403);
    }
    if (!link.revokedAt) {
      link.revokedAt = new Date();
      await link.save();
    }
    return link;
  }

  /**
   * Resolves a token to its report.
   *
   * Throws 404 for an unknown, revoked or expired token — the three cases are
   * deliberately indistinguishable from outside, so a link cannot be probed.
   */
  async resolveReport(token) {
    if (typeof token !== "string" || token.length < 20) {
      throw new ApiError("Report link not found", 404);
    }

    const link = await TimeManagementShareLinkModel.findOne({
      tokenHash: hashToken(token),
    });

    if (!link || link.revokedAt || link.expiresAt <= new Date()) {
      throw new ApiError("Report link not found", 404);
    }

    const records = await TimeManagementUsageModel.find({
      shareId: link.shareId,
      date: { $gte: link.dateFrom, $lte: link.dateTo },
    })
      .sort({ date: 1 })
      .lean();

    const owner = await UserModel.findById(link.ownerUserId)
      .select("fullName")
      .lean();

    let totalDuration = 0;
    const byDate = [];
    const appTotals = new Map();

    for (const record of records) {
      const dayTotal = record.totalDuration || 0;
      totalDuration += dayTotal;
      byDate.push({ date: record.date, totalDuration: dayTotal });

      for (const app of record.apps || []) {
        const current = appTotals.get(app.appName) || {
          appName: app.appName,
          totalDuration: 0,
          windows: new Map(),
        };
        current.totalDuration += app.totalDuration || 0;
        if (link.includeWindows) {
          for (const win of app.windows || []) {
            current.windows.set(
              win.title,
              (current.windows.get(win.title) || 0) + (win.durationMs || 0)
            );
          }
        }
        appTotals.set(app.appName, current);
      }
    }

    const byApp = Array.from(appTotals.values())
      .map((app) => ({
        appName: app.appName,
        totalDuration: app.totalDuration,
        windows: link.includeWindows
          ? Array.from(app.windows.entries())
              .map(([title, durationMs]) => ({ title, durationMs }))
              .sort((a, b) => b.durationMs - a.durationMs)
          : [],
      }))
      .sort((a, b) => b.totalDuration - a.totalDuration);

    link.viewCount += 1;
    link.lastViewedAt = new Date();
    await link.save();

    // Only report content: no share id, no user id, no filter internals.
    return {
      title: link.reportTitle,
      ownerName: owner ? owner.fullName : null,
      dateFrom: link.dateFrom,
      dateTo: link.dateTo,
      totalDuration,
      totalDays: byDate.length,
      totalApps: byApp.length,
      includesWindows: link.includeWindows,
      byDate,
      byApp,
      expiresAt: link.expiresAt,
    };
  }
}

module.exports = new TimeManagementShareLinkService();
module.exports.PUBLIC_PATH = PUBLIC_PATH;
module.exports.DEFAULT_EXPIRY_DAYS = DEFAULT_EXPIRY_DAYS;
module.exports.MAX_EXPIRY_DAYS = MAX_EXPIRY_DAYS;
module.exports.hashTokenForTest = hashToken;
