const crypto = require("crypto");
// Required explicitly rather than taken from the global: the configured
// Node baseline predates the global `URL`, the same reason googleOAuthService
// imports it.
const { URL } = require("url");
const { OAuth2Client } = require("google-auth-library");
const ApiError = require("../../utils/apiError");
const { GmailAccount } = require("./gmailAccountModel");
const {
  GmailPushNotification,
} = require("./gmailPushNotificationModel");
const syncService = require("./gmailSyncService");

/**
 * The endpoint Google Cloud Pub/Sub pushes Gmail notifications to.
 *
 * This is the only part of the feature reachable without a BM session, so it
 * is the only part that has to defend itself. Three things are true of it at
 * once, and each one shapes the design:
 *
 * **It is a public URL.** Anyone can POST to it. A notification is therefore
 * not trusted to say anything except "this mailbox may have changed" — it
 * carries no mail, and nothing in it is stored as fact. The address and
 * history id inside are used only to *look up* accounts we already hold and
 * to ask for a sync that runs on our own stored grant. A forged notification
 * at worst causes a sync that finds nothing; it cannot inject a message,
 * cannot name a mailbox we do not have, and cannot move a cursor forward
 * past unseen changes, because the sync replays from the stored cursor
 * rather than from the number in the payload.
 *
 * **It must still be authenticated**, because an unauthenticated public
 * endpoint that triggers API work is a free quota-exhaustion lever. Two
 * independent mechanisms are supported and *at least one must be configured*
 * — with neither, this refuses every request rather than defaulting open:
 *
 *   - an OIDC token Pub/Sub signs with a service account, verified here
 *     against Google's keys (`GMAIL_PUSH_AUDIENCE`,
 *     `GMAIL_PUSH_SERVICE_ACCOUNT`). This is Google's recommended way;
 *   - a shared secret in the query string (`GMAIL_PUSH_TOKEN`), compared in
 *     constant time. Simpler, and enough when the URL is not guessable.
 *
 * **Pub/Sub retries.** Delivery is at-least-once, so the same notification
 * arrives more than once as a matter of course. The Pub/Sub message id is
 * inserted under a unique index *before* any work begins: the insert is the
 * lock, a duplicate loses the race, and the endpoint answers 204 so Pub/Sub
 * stops retrying. A 500 from here means "try again later" and is reserved
 * for failures that really are transient.
 */

/** Verifier for the OIDC tokens Pub/Sub signs its pushes with. */
const oauthClient = new OAuth2Client();

const configuredToken = () =>
  String(process.env.GMAIL_PUSH_TOKEN || "").trim();

const configuredAudience = () =>
  String(process.env.GMAIL_PUSH_AUDIENCE || "").trim();

const configuredServiceAccount = () =>
  String(process.env.GMAIL_PUSH_SERVICE_ACCOUNT || "")
    .trim()
    .toLowerCase();

/**
 * The public URL this endpoint is reachable at, as registered with Pub/Sub.
 *
 * Recorded only so the diagnostics can check it: nothing here calls it. It
 * exists because the most common reason push silently never arrives is an
 * endpoint Pub/Sub cannot reach, and that is invisible from inside the
 * server — Google reports the failure on its side, not ours.
 */
const configuredEndpoint = () =>
  String(process.env.GMAIL_PUSH_ENDPOINT || "").trim();

/** True when at least one authentication mechanism is configured. */
const isConfigured = () =>
  Boolean(configuredToken()) || Boolean(configuredAudience());

/** Which mechanism will actually be used, in the order `assertAuthentic` tries. */
const authMode = () => {
  if (configuredToken()) return "token";
  if (configuredAudience()) return "oidc";
  return "none";
};

/**
 * Checks the registered endpoint against Google's documented requirements.
 *
 * Pub/Sub requires "a publicly accessible HTTPS address" whose server has "a
 * valid SSL certificate signed by a certificate authority", and it cannot
 * reach private addresses at all. Those rules are easy to miss and produce
 * the worst possible symptom: `users.watch` succeeds, Pub/Sub accepts the
 * subscription, and no notification is ever delivered — which looks exactly
 * like a quiet mailbox.
 *
 * So each rule is checked here and reported as a sentence an operator can
 * act on. A bare IP address is flagged because no public CA issues
 * certificates for one, which makes the certificate requirement
 * unsatisfiable rather than merely unmet.
 */
const describeEndpoint = () => {
  const raw = configuredEndpoint();
  if (!raw) {
    return {
      url: null,
      deliverable: null,
      problems: [
        "GMAIL_PUSH_ENDPOINT is not set, so the endpoint cannot be checked. " +
          "Set it to the exact URL registered with the Pub/Sub subscription.",
      ],
    };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      url: raw,
      deliverable: false,
      problems: [`GMAIL_PUSH_ENDPOINT ("${raw}") is not a valid URL.`],
    };
  }

  const problems = [];

  if (parsed.protocol !== "https:") {
    problems.push(
      "Pub/Sub only delivers to an HTTPS endpoint. This one is " +
        `${parsed.protocol.replace(":", "")}.`,
    );
  }

  const host = parsed.hostname;
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  const isPrivate =
    isLoopback ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (isPrivate) {
    problems.push(
      `Pub/Sub cannot reach ${host}: it is a private or loopback address. ` +
        "Use a public hostname, or a tunnel that gives you one.",
    );
  } else if (isIpv4) {
    problems.push(
      `${host} is a bare IP address. Public certificate authorities do not ` +
        "issue certificates for IP addresses, so the certificate requirement " +
        "cannot be met. Put the backend behind a hostname with TLS.",
    );
  }

  return {
    url: raw,
    // Null when there is nothing to judge; the checks above are necessary
    // conditions, never sufficient — only a delivered notification proves it
    // works, which is what `notifications` on each mailbox counts.
    deliverable: problems.length === 0,
    problems,
  };
};

/**
 * Everything an operator needs to answer "why is no mail arriving".
 *
 * Reports configuration only — no secrets, and the service account is an
 * identity rather than a credential.
 */
const describeConfiguration = () => ({
  authMode: authMode(),
  tokenConfigured: Boolean(configuredToken()),
  audience: configuredAudience() || null,
  serviceAccount: configuredServiceAccount() || null,
  endpoint: describeEndpoint(),
  // Stated plainly: with no authentication configured the endpoint refuses
  // every request, so push is off rather than open.
  acceptsRequests: isConfigured(),
});

/** Constant-time comparison, so a wrong token leaks nothing by timing. */
const secretsMatch = (given, expected) => {
  const a = Buffer.from(String(given || ""), "utf8");
  const b = Buffer.from(String(expected || ""), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
};

/**
 * Proves the request came from our Pub/Sub subscription.
 *
 * Fails closed in every direction: no mechanism configured is a refusal, a
 * token that does not match is a refusal, and an OIDC token from the wrong
 * service account is a refusal even when it is otherwise valid.
 */
const assertAuthentic = async ({ token, authorization }) => {
  if (!isConfigured()) {
    throw new ApiError(
      "Gmail push notifications are not configured. Set GMAIL_PUSH_TOKEN " +
        "or GMAIL_PUSH_AUDIENCE before exposing this endpoint.",
      503,
    );
  }

  const expectedToken = configuredToken();
  if (expectedToken && secretsMatch(token, expectedToken)) {
    return { via: "token" };
  }

  const audience = configuredAudience();
  const bearer = String(authorization || "").replace(/^Bearer\s+/i, "");

  if (audience && bearer) {
    try {
      const ticket = await oauthClient.verifyIdToken({
        idToken: bearer,
        audience,
      });
      const payload = ticket.getPayload() || {};
      const serviceAccount = configuredServiceAccount();

      // The signature only proves Google minted it. Checking which service
      // account it was minted for is what ties it to *our* subscription.
      if (
        serviceAccount &&
        String(payload.email || "").toLowerCase() !== serviceAccount
      ) {
        throw new ApiError(
          "The push token belongs to another service account",
          403,
        );
      }
      if (payload.email_verified === false) {
        throw new ApiError("The push token's email is not verified", 403);
      }
      return { via: "oidc", serviceAccount: payload.email || null };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        `The Pub/Sub push token could not be verified: ${error.message}`,
        403,
      );
    }
  }

  throw new ApiError("This push request is not authenticated", 403);
};

/**
 * Reads the `{emailAddress, historyId}` Gmail published.
 *
 * Pub/Sub wraps it: the envelope is `{message: {data, messageId,
 * publishTime}, subscription}`, and `data` is base64 JSON. Anything
 * unparseable is a permanent failure, not a transient one — retrying a
 * malformed message forever is how a dead-letter queue fills up.
 */
const decodeEnvelope = (body) => {
  const message = body?.message;
  if (!message || !message.messageId) {
    throw new ApiError("Not a Pub/Sub push envelope", 400);
  }

  let payload = {};
  if (message.data) {
    try {
      payload = JSON.parse(
        Buffer.from(String(message.data), "base64").toString("utf8"),
      );
    } catch {
      throw new ApiError("The Pub/Sub message data is not JSON", 400);
    }
  }

  const emailAddress = String(payload.emailAddress || "")
    .trim()
    .toLowerCase();
  if (!emailAddress) {
    throw new ApiError("The notification names no mailbox", 400);
  }

  return {
    pubsubMessageId: String(message.messageId),
    emailAddress,
    historyId: payload.historyId ? String(payload.historyId) : null,
    publishedAt: message.publishTime ? new Date(message.publishTime) : null,
    subscription: body.subscription || null,
  };
};

/**
 * Claims a notification, or reports that it has already been claimed.
 *
 * The unique index on `pubsubMessageId` is the whole mechanism: two
 * concurrent deliveries both try to insert, one wins, and the loser gets a
 * duplicate-key error which is the answer rather than a problem.
 */
const claim = async (envelope) => {
  try {
    const row = await GmailPushNotification.create({
      pubsubMessageId: envelope.pubsubMessageId,
      emailAddress: envelope.emailAddress,
      historyId: envelope.historyId,
      subscription: envelope.subscription,
      publishedAt: envelope.publishedAt,
      receivedAt: new Date(),
      status: "received",
    });
    return { row, duplicate: false };
  } catch (error) {
    if (error.code === 11000) return { row: null, duplicate: true };
    throw error;
  }
};

/**
 * Handles one push.
 *
 * Returns quickly on purpose. Pub/Sub holds the HTTP connection open until
 * this answers and redelivers if it takes too long, so the work done here is
 * exactly: authenticate, dedupe, mark the accounts due. The sync itself
 * happens on the scheduler's next tick, which is a durable handoff — it
 * survives a restart between the acknowledgement and the work.
 */
const handleNotification = async ({ body, token, authorization }) => {
  await assertAuthentic({ token, authorization });

  const envelope = decodeEnvelope(body);
  const { row, duplicate } = await claim(envelope);

  if (duplicate) {
    // Already seen. Answering success is what stops Pub/Sub retrying.
    return {
      status: "duplicate",
      pubsubMessageId: envelope.pubsubMessageId,
      accounts: 0,
    };
  }

  try {
    // One Gmail address can be connected by several BM users, and each has
    // its own grant and its own copy. All of them are told.
    const accounts = await GmailAccount.find({
      email: envelope.emailAddress,
      isEnabled: true,
      needsReauth: false,
    }).select("_id userId email watch");

    if (accounts.length === 0) {
      // A mailbox nobody has connected — a watch left running after an
      // account was removed, or a forged notification. Recorded and dropped.
      await GmailPushNotification.updateOne(
        { _id: row._id },
        {
          $set: {
            status: "skipped",
            processedAt: new Date(),
            error: "No connected mailbox for this address",
          },
        },
      );
      return {
        status: "skipped",
        pubsubMessageId: envelope.pubsubMessageId,
        accounts: 0,
      };
    }

    await Promise.all(
      accounts.map((account) =>
        Promise.all([
          syncService.requestSync(account._id),
          GmailAccount.updateOne(
            { _id: account._id },
            {
              $inc: { "watch.notificationCount": 1 },
              $set: { "watch.lastNotificationAt": new Date() },
            },
          ),
        ]),
      ),
    );

    await GmailPushNotification.updateOne(
      { _id: row._id },
      {
        $set: {
          status: "processed",
          processedAt: new Date(),
          accountIds: accounts.map((account) => account._id),
        },
      },
    );

    return {
      status: "queued",
      pubsubMessageId: envelope.pubsubMessageId,
      accounts: accounts.length,
      emailAddress: envelope.emailAddress,
    };
  } catch (error) {
    await GmailPushNotification.updateOne(
      { _id: row._id },
      {
        $set: {
          status: "failed",
          processedAt: new Date(),
          error: error.message,
        },
      },
    );
    throw error;
  }
};

/**
 * Notifications that were claimed but never finished.
 *
 * A worker that died between claiming and queueing leaves one of these, and
 * Pub/Sub will not redeliver it — the claim already succeeded. The scheduler
 * sweeps them so a crash costs latency rather than a lost notification.
 */
const stuckNotifications = ({ olderThanMs = 5 * 60 * 1000, limit = 50 } = {}) =>
  GmailPushNotification.find({
    status: { $in: ["received", "failed"] },
    receivedAt: { $lt: new Date(Date.now() - olderThanMs) },
  })
    .sort({ receivedAt: 1 })
    .limit(limit);

/** Re-queues a sync for every mailbox a stuck notification named. */
const recoverStuck = async (options = {}) => {
  const stuck = await stuckNotifications(options);

  return stuck.reduce(
    (previous, row) =>
      previous.then(async (results) => {
        const accounts = await GmailAccount.find({
          email: row.emailAddress,
          isEnabled: true,
          needsReauth: false,
        }).select("_id");

        await Promise.all(
          accounts.map((account) => syncService.requestSync(account._id)),
        );
        await GmailPushNotification.updateOne(
          { _id: row._id },
          {
            $set: {
              status: accounts.length > 0 ? "processed" : "skipped",
              processedAt: new Date(),
              accountIds: accounts.map((account) => account._id),
            },
          },
        );

        return [
          ...results,
          {
            pubsubMessageId: row.pubsubMessageId,
            emailAddress: row.emailAddress,
            accounts: accounts.length,
          },
        ];
      }),
    Promise.resolve([]),
  );
};

module.exports = {
  isConfigured,
  authMode,
  configuredEndpoint,
  describeEndpoint,
  describeConfiguration,
  secretsMatch,
  assertAuthentic,
  decodeEnvelope,
  claim,
  handleNotification,
  stuckNotifications,
  recoverStuck,
};
