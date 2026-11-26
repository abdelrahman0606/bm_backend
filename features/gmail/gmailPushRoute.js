const express = require("express");
const controller = require("./gmailController");

const router = express.Router();

/**
 * The Pub/Sub push endpoint, mounted on its own.
 *
 * Separate from `gmailRoute` for the same reason Device Control's agent API
 * is separate from its console API: this one authenticates a **Google service
 * account**, not a BM user, and must never sit behind `verifyAuthToken` —
 * Pub/Sub has no session and would be refused by it.
 *
 * Its own authentication is in `gmailPushService.assertAuthentic`, which
 * requires either the OIDC token Pub/Sub signs or a shared secret in the
 * query string, and refuses everything when neither is configured. See that
 * file for why a notification is treated as a hint rather than as data.
 *
 * `express.json()` is applied here rather than relying on the app-level
 * parser, so this router works wherever it is mounted and so the body size
 * is capped at something a notification could plausibly be — the payload is
 * two fields, and anything near a megabyte is not one.
 */
router.post(
  "/",
  express.json({ limit: "64kb" }),
  controller.receivePush,
);

module.exports = router;
