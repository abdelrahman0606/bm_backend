const timeManagementSharingService = require("./timeManagementSharingService");

exports.createShare = async (req, res, next) => {
  try {
    const share = await timeManagementSharingService.createShare(req.userId, req.body);
    res.status(201).json({
      success: true,
      data: share,
      message: "Filter shared successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.updateShare = async (req, res, next) => {
  try {
    const share = await timeManagementSharingService.updateShare(
      req.userId,
      req.params.shareId,
      req.body
    );
    res.status(200).json({
      success: true,
      data: share,
      message: "Share updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getAllMyShares = async (req, res, next) => {
  try {
    const result = await timeManagementSharingService.getAllMyShares(req.userId, req.query);
    res.status(200).json({
      success: true,
      data: result.shares,
      pagination: result.pagination,
      message: "Shares fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getReceivedShares = async (req, res, next) => {
  try {
    const result = await timeManagementSharingService.getReceivedShares(req.userId, req.query);
    res.status(200).json({
      success: true,
      data: result.shares,
      pagination: result.pagination,
      message: "Received shares fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getSentShares = async (req, res, next) => {
  try {
    const result = await timeManagementSharingService.getSentShares(req.userId, req.query);
    res.status(200).json({
      success: true,
      data: result.shares,
      pagination: result.pagination,
      message: "Sent shares fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getSharesByUser = async (req, res, next) => {
  try {
    const result = await timeManagementSharingService.getSharesByUser(
      req.userId,
      req.params.userId,
      req.query
    );
    res.status(200).json({
      success: true,
      data: result.shares,
      pagination: result.pagination,
      message: "User shares fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getSingleShare = async (req, res, next) => {
  try {
    const share = await timeManagementSharingService.getSingleShare(
      req.userId,
      req.params.shareId
    );
    res.status(200).json({
      success: true,
      data: share,
      message: "Share fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.acceptShare = async (req, res, next) => {
  try {
    const share = await timeManagementSharingService.acceptShare(
      req.userId,
      req.params.shareId
    );
    res.status(200).json({
      success: true,
      data: share,
      message: "Share accepted successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.rejectShare = async (req, res, next) => {
  try {
    const share = await timeManagementSharingService.rejectShare(
      req.userId,
      req.params.shareId
    );
    res.status(200).json({
      success: true,
      data: share,
      message: "Share rejected successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.cancelShare = async (req, res, next) => {
  try {
    const share = await timeManagementSharingService.cancelShare(
      req.userId,
      req.params.shareId
    );
    res.status(200).json({
      success: true,
      data: share,
      message: "Share cancelled successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.revokeShare = async (req, res, next) => {
  try {
    const share = await timeManagementSharingService.revokeShare(
      req.userId,
      req.params.shareId
    );
    res.status(200).json({
      success: true,
      data: share,
      message: "Share revoked successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.disconnectShare = async (req, res, next) => {
  try {
    const share = await timeManagementSharingService.disconnectShare(
      req.userId,
      req.params.shareId
    );
    res.status(200).json({
      success: true,
      data: share,
      message: "Share disconnected successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.updateShareSchedule = async (req, res, next) => {
  try {
    const share = await timeManagementSharingService.updateShareSchedule(
      req.userId,
      req.params.shareId,
      req.body
    );
    res.status(200).json({
      success: true,
      data: share,
      message: "Sharing schedule updated successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.shareNow = async (req, res, next) => {
  try {
    const result = await timeManagementSharingService.shareNow(
      req.userId,
      req.params.shareId,
      req.body || {}
    );
    res.status(200).json({
      success: true,
      data: result.delivery,
      message: result.duplicate
        ? "This occurrence was already delivered"
        : "Tracked time shared successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getDeliveries = async (req, res, next) => {
  try {
    const result = await timeManagementSharingService.getDeliveries(
      req.userId,
      req.params.shareId,
      req.query
    );
    res.status(200).json({
      success: true,
      data: result.deliveries,
      pagination: result.pagination,
      message: "Deliveries fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.syncUsage = async (req, res, next) => {
  try {
    const payload = { ...req.body };
    if (req.params.shareId && (!payload.recipientId || !payload.filterId)) {
      const share = await timeManagementSharingService.getSingleShare(
        req.userId,
        req.params.shareId
      );
      if (share) {
        payload.recipientId =
          payload.recipientId ||
          (share.recipientUserId._id
            ? share.recipientUserId._id.toString()
            : share.recipientUserId.toString());
        payload.filterId = payload.filterId || share.filterId;
      }
    }

    const result = await timeManagementSharingService.syncUsage(req.userId, payload);
    res.status(200).json({
      success: true,
      data: result,
      message: result.message || "Usage batch synchronized successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getSyncBatchStatus = async (req, res, next) => {
  try {
    const batch = await timeManagementSharingService.getSyncBatchStatus(
      req.userId,
      req.params.batchId
    );
    res.status(200).json({
      success: true,
      data: batch,
      message: "Sync batch status fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};

exports.getReport = async (req, res, next) => {
  try {
    const report = await timeManagementSharingService.getReport(req.userId, req.query);
    res.status(200).json({
      success: true,
      data: report,
      message: "Time management report fetched successfully",
    });
  } catch (error) {
    next(error);
  }
};
