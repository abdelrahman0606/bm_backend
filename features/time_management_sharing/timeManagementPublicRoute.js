const express = require("express");
const router = express.Router();
const linkService = require("./timeManagementShareLinkService");
const reportPage = require("./timeManagementReportPage");

/**
 * Public, unauthenticated access to a shared time report.
 *
 * Authorization is the token itself: it is resolved server-side to the exact
 * report it was issued for, and an unknown, revoked or expired token is
 * answered with the same "not available" response so links cannot be probed.
 * No other route of this feature is reachable without a bearer token.
 */

// Rendered page — this is what a recipient opens from a chat message.
router.get("/:token", async (req, res) => {
  try {
    const report = await linkService.resolveReport(req.params.token);
    res
      .status(200)
      .set("Cache-Control", "no-store")
      .type("html")
      .send(reportPage.renderReport(report));
  } catch (error) {
    res
      .status(error.statusCode === 404 ? 404 : 500)
      .set("Cache-Control", "no-store")
      .type("html")
      .send(reportPage.renderNotFound());
  }
});

// Same report as JSON, for a client that wants to render it itself.
router.get("/:token/data", async (req, res, next) => {
  try {
    const report = await linkService.resolveReport(req.params.token);
    res.status(200).set("Cache-Control", "no-store").json({
      success: true,
      data: report,
      message: "Report fetched successfully",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
