const deviceUsageService = require("./timeManagementDeviceUsageService");

/**
 * Accepts one batch of per-device usage snapshots.
 *
 * The owner is always the authenticated user (`req.userId`); a user id in the
 * body is ignored.
 */
exports.syncDeviceUsage = async (req, res, next) => {
  try {
    const acknowledgement = await deviceUsageService.syncDeviceUsage(
      req.userId,
      req.body
    );
    // 200, not 201: the same batch may legitimately be submitted twice and the
    // second call creates nothing.
    res.status(200).json({
      success: true,
      data: acknowledgement,
      message: acknowledgement.idempotent
        ? "Batch already processed"
        : "Usage snapshots synchronized successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getSyncAcknowledgement = async (req, res, next) => {
  try {
    const acknowledgement = await deviceUsageService.getBatchAcknowledgement(
      req.userId,
      req.params.batchId
    );
    res.status(200).json({
      success: true,
      data: acknowledgement,
      message: "Sync batch fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getAggregatedUsage = async (req, res, next) => {
  try {
    const report = await deviceUsageService.getAggregatedUsage(
      req.userId,
      req.query
    );
    res.status(200).json({
      success: true,
      data: report,
      pagination: report.pagination,
      message: "Aggregated usage fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};
