const ApiError = require("../../utils/apiError");
const { GmailAccount } = require("./gmailAccountModel");
const accountService = require("./gmailAccountService");
const syncService = require("./gmailSyncService");
const audit = require("./gmailAuditService");
const events = require("./gmailEvents");

/**
 * Gmail's `users.watch`: the subscription that makes new mail arrive as a
 * push notification instead of being discovered by a poll.
 *
 * How it fits together, because the moving parts are in three different
 * systems:
 *
 *   1. a Pub/Sub topic exists in the Google Cloud project, and
 *      `gmail-api-push@system.gserviceaccount.com` has Publisher on it;
 *   2. this service calls `users.watch` with that topic, once per mailbox;
 *   3. Gmail publishes `{emailAddress, historyId}` to the topic on every
 *      mailbox change;
 *   4. a Pub/Sub *push* subscription POSTs that to our endpoint, which asks
 *      for a sync.
 *
 * **A watch expires after seven days, always.** Google documents this plainly
 * and there is no way to ask for longer. So renewal is the normal operating
 * cycle rather than an error path, and it is done a day early: a watch that
 * lapses is not an error anybody sees — mail simply stops arriving promptly,
 * which is the worst kind of failure because it looks like a quiet mailbox.
 *
 * **Push is never the only path.** Every account also carries `nextSyncAt`,
 * swept by the scheduler, so a lapsed watch, a Pub/Sub outage or a dropped
 * notification costs latency and nothing else.
 */

/** Renew a watch when this little of its life is left. */
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

/** What Google gives us, for reference: seven days. */
const WATCH_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The Pub/Sub topic Gmail publishes to.
 *
 * `projects/<project>/topics/<topic>`. Required: there is no sensible default
 * and a wrong one would mean a watch that silently publishes nowhere, so this
 * refuses rather than guesses.
 */
const topicName = () => {
  const topic = String(process.env.GMAIL_PUBSUB_TOPIC || "").trim();
  if (!topic) {
    throw new ApiError(
      "GMAIL_PUBSUB_TOPIC is not configured, so Gmail cannot be asked to " +
        "push notifications. Set it to projects/<project>/topics/<topic>.",
      500,
    );
  }
  if (!/^projects\/[^/]+\/topics\/[^/]+$/.test(topic)) {
    throw new ApiError(
      `GMAIL_PUBSUB_TOPIC ("${topic}") must look like ` +
        "projects/<project>/topics/<topic>",
      500,
    );
  }
  return topic;
};

/** True when push is configured at all. Nothing here runs without it. */
const isConfigured = () => {
  try {
    topicName();
    return true;
  } catch {
    return false;
  }
};

/**
 * Which changes Gmail should publish.
 *
 * Unset by default, meaning every change in the mailbox. Narrowing it to
 * INBOX would halve the notifications, and would also stop us hearing about a
 * message being read in Gmail itself or filed into a label — changes the
 * client is showing and would then show wrongly. Latency is cheaper than
 * being wrong, so the default is everything; `GMAIL_WATCH_LABEL_IDS` is there
 * for a deployment that would rather trade.
 */
const watchLabelIds = () => {
  const raw = String(process.env.GMAIL_WATCH_LABEL_IDS || "").trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
};

/**
 * Asks Gmail to start publishing a mailbox's changes.
 *
 * The response carries a `historyId`, and it is adopted as the cursor only
 * when the mailbox has none — for a mailbox mid-sync, that id is *ahead* of
 * what has been stored, and taking it would skip everything in between.
 */
const startWatch = async (account) => {
  const topic = topicName();
  const client = accountService.clientFor(account);
  const labelIds = watchLabelIds();

  try {
    const response = await client.watch({
      topicName: topic,
      ...(labelIds ? { labelIds, labelFilterBehavior: "include" } : {}),
    });

    const expiration = response.expiration
      ? new Date(Number(response.expiration))
      : new Date(Date.now() + WATCH_LIFETIME_MS);

    const update = {
      "watch.active": true,
      "watch.topicName": topic,
      "watch.historyId": response.historyId
        ? String(response.historyId)
        : null,
      "watch.expiration": expiration,
      "watch.lastRenewedAt": new Date(),
      "watch.lastError": null,
    };

    if (!account.syncState?.lastHistoryId && response.historyId) {
      update["syncState.lastHistoryId"] = String(response.historyId);
    }

    await GmailAccount.updateOne({ _id: account._id }, { $set: update });

    await audit.record({
      accountId: account._id,
      userId: account.userId,
      operation: "watch.started",
      actor: audit.systemActor("gmail-watch"),
      result: { affected: 1 },
    });

    events.watchStarted({
      userId: account.userId,
      accountId: account._id,
      expiration,
    });

    return { active: true, expiration, historyId: response.historyId || null };
  } catch (error) {
    await GmailAccount.updateOne(
      { _id: account._id },
      {
        $set: {
          "watch.active": false,
          "watch.lastError": error.message,
        },
      },
    );
    throw error;
  }
};

/** Starts a watch unless this mailbox already has a healthy one. */
const ensureWatch = async (account, { force = false } = {}) => {
  if (!isConfigured()) return { skipped: "notConfigured" };
  if (account.needsReauth) return { skipped: "needsReauth" };
  if (!account.isEnabled) return { skipped: "disabled" };

  const expiresAt = account.watch?.expiration
    ? new Date(account.watch.expiration).getTime()
    : 0;
  const healthy =
    account.watch?.active && expiresAt - RENEW_BEFORE_MS > Date.now();

  if (healthy && !force) {
    return { skipped: "healthy", expiration: account.watch.expiration };
  }
  return startWatch(account);
};

/** Tells Gmail to stop publishing. The row keeps its history cursor. */
const stopWatch = async (account, { reason = null } = {}) => {
  const client = accountService.clientFor(account);
  await client.stopWatch();

  await GmailAccount.updateOne(
    { _id: account._id },
    {
      $set: {
        "watch.active": false,
        "watch.lastError": null,
      },
    },
  );

  await audit.record({
    accountId: account._id,
    userId: account.userId,
    operation: "watch.stopped",
    actor: audit.systemActor("gmail-watch"),
  });

  events.watchStopped({
    userId: account.userId,
    accountId: account._id,
    reason,
  });

  return { active: false };
};

/**
 * Mailboxes whose watch is lapsing, or was never started.
 *
 * The second half of that `$or` is what makes a freshly connected mailbox get
 * a watch without anything having to remember to ask for one.
 */
const dueForRenewal = ({ now = new Date(), limit = 25 } = {}) =>
  GmailAccount.find({
    isEnabled: true,
    needsReauth: false,
    $or: [
      { "watch.active": { $ne: true } },
      {
        "watch.expiration": {
          $lte: new Date(now.getTime() + RENEW_BEFORE_MS),
        },
      },
    ],
  })
    .sort({ "watch.expiration": 1 })
    .limit(limit)
    .select("_id email userId isEnabled needsReauth watch syncState");

/**
 * Renews every lapsing watch.
 *
 * One mailbox's failure never stops the sweep: a revoked grant or a mailbox
 * Google has locked would otherwise leave every account after it in the list
 * unwatched, which is exactly the silent failure this whole mechanism exists
 * to avoid.
 */
const renewDue = async ({ now = new Date(), limit = 25 } = {}) => {
  if (!isConfigured()) return [];

  const accounts = await dueForRenewal({ now, limit });

  return accounts.reduce(
    (previous, account) =>
      previous.then(async (results) => {
        try {
          const result = await ensureWatch(account);
          return [...results, { accountId: String(account._id), ...result }];
        } catch (error) {
          console.error(
            `[gmail-watch] could not renew ${account.email}: ${error.message}`,
          );
          return [
            ...results,
            { accountId: String(account._id), error: error.message },
          ];
        }
      }),
    Promise.resolve([]),
  );
};

/**
 * Connects a mailbox's first watch and queues its first sync.
 *
 * Called right after consent. Deliberately tolerant: a mailbox that is
 * connected but not yet watched still syncs on the scheduler's sweep, so a
 * misconfigured Pub/Sub topic must not make connecting an account fail.
 */
const onAccountConnected = async (account) => {
  await syncService.requestSync(account._id);

  if (!isConfigured()) {
    console.warn(
      "[gmail-watch] GMAIL_PUBSUB_TOPIC is not set; " +
        `${account.email} will be synced on a schedule instead of on push.`,
    );
    return { watch: { skipped: "notConfigured" }, syncQueued: true };
  }

  try {
    const watch = await ensureWatch(account, { force: true });
    return { watch, syncQueued: true };
  } catch (error) {
    console.error(
      `[gmail-watch] could not start the watch on ${account.email}: ${error.message}`,
    );
    return { watch: { error: error.message }, syncQueued: true };
  }
};

module.exports = {
  RENEW_BEFORE_MS,
  WATCH_LIFETIME_MS,
  topicName,
  isConfigured,
  watchLabelIds,
  startWatch,
  ensureWatch,
  stopWatch,
  dueForRenewal,
  renewDue,
  onAccountConnected,
};
