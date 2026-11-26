const syncService = require("./gmailSyncService");
const watchService = require("./gmailWatchService");
const pushService = require("./gmailPushService");

/**
 * The background worker that makes Gmail synchronization independent of the
 * frontend.
 *
 * This is the answer to "do not rely on the app being open". Three jobs on
 * one timer, each the safety net for a different thing going quiet:
 *
 *   **sync** — every mailbox whose `nextSyncAt` has passed. Push notifications
 *   set that field, so in the normal case this tick finds the work a
 *   notification queued a second ago; when push is lapsed, misconfigured or
 *   simply dropped, the same tick finds mailboxes that are merely overdue.
 *   One mechanism covers both, which is why there is no separate "poll mode".
 *
 *   **watch renewal** — Gmail expires a watch after seven days whatever
 *   happens, so renewal is the normal cycle rather than an error path. Run
 *   hourly, renewing a day early.
 *
 *   **stuck notifications** — a worker that died between claiming a
 *   notification and queueing the sync leaves a claimed row that Pub/Sub will
 *   never redeliver. Swept so a crash costs latency, not mail.
 *
 * Properties the design depends on:
 *
 * - **Ticks never overlap.** A slow tick would otherwise have two workers
 *   competing for the same leases and spending double the quota.
 * - **One mailbox's failure never stops the sweep.** Every per-account call
 *   is wrapped; a revoked grant must not leave every mailbox behind it in the
 *   list unsynced.
 * - **A failing tick never takes the process down.** The next one retries.
 * - **Safe to run on more than one instance.** The lease in
 *   `gmailSyncService.claimLease` is atomic, so a second instance finds the
 *   mailbox taken and moves on.
 */

const DEFAULT_INTERVAL_MS = 60 * 1000;

/** Watches are checked far less often than mail: they last a week. */
const WATCH_SWEEP_EVERY_MS = 60 * 60 * 1000;

/** Mailboxes synced per tick. Bounds quota spend and tick duration. */
const DEFAULT_SYNC_LIMIT = 10;

let timer = null;
let running = false;
let lastWatchSweep = 0;

const isDisabled = () => process.env.GMAIL_SCHEDULER_DISABLED === "true";

/**
 * Syncs the mailboxes that are due.
 *
 * Sequential rather than parallel: each pass makes several Gmail calls, and
 * ten mailboxes syncing at once is how a project-wide rate limit is hit —
 * which would slow every mailbox instead of one.
 */
const syncDue = async ({ now = new Date(), limit = DEFAULT_SYNC_LIMIT } = {}) => {
  const accounts = await syncService.dueAccounts({ now, limit });
  if (accounts.length === 0) return [];

  return accounts.reduce(
    (previous, account) =>
      previous.then(async (results) => {
        try {
          const result = await syncService.syncAccount(account);
          return [...results, result];
        } catch (error) {
          // `syncAccount` handles its own failures and returns them, so
          // reaching here means something unanticipated — logged, and the
          // sweep carries on to the next mailbox.
          console.error(
            `[gmail-scheduler] unexpected failure syncing ${account.email}: ${error.message}`,
          );
          return [
            ...results,
            { accountId: String(account._id), failed: true, error: error.message },
          ];
        }
      }),
    Promise.resolve([]),
  );
};

/** Renews lapsing watches, at most once an hour. */
const sweepWatches = async ({ now = new Date(), force = false } = {}) => {
  if (!force && now.getTime() - lastWatchSweep < WATCH_SWEEP_EVERY_MS) {
    return [];
  }
  lastWatchSweep = now.getTime();

  if (!watchService.isConfigured()) return [];

  try {
    return await watchService.renewDue({ now });
  } catch (error) {
    console.error(`[gmail-scheduler] watch sweep failed: ${error.message}`);
    return [];
  }
};

/** Re-queues syncs for notifications that were claimed but never finished. */
const sweepStuckNotifications = async () => {
  try {
    return await pushService.recoverStuck();
  } catch (error) {
    console.error(
      `[gmail-scheduler] stuck-notification sweep failed: ${error.message}`,
    );
    return [];
  }
};

/**
 * One tick. Exported so a test can drive it directly, and so an operator can
 * run it from a REPL without starting the timer.
 */
const tick = async ({ limit = DEFAULT_SYNC_LIMIT, now = new Date() } = {}) => {
  if (running) return { skipped: "overlapping" };
  running = true;

  try {
    const synced = await syncDue({ now, limit });
    const watches = await sweepWatches({ now });
    const recovered = await sweepStuckNotifications();

    const failed = synced.filter((result) => result.failed);
    if (synced.length > 0 || watches.length > 0) {
      const failures = failed.length > 0 ? `, ${failed.length} failed` : "";
      const renewals =
        watches.length > 0 ? `, renewed ${watches.length} watch(es)` : "";
      console.log(
        `[gmail-scheduler] synced ${synced.length} mailbox(es)${failures}${renewals}`,
      );
    }

    return { synced, watches, recovered };
  } catch (error) {
    // A failing tick must not take the process down; the next one retries.
    console.error(`[gmail-scheduler] tick failed: ${error.message}`);
    return { error: error.message };
  } finally {
    running = false;
  }
};

const start = ({ intervalMs, limit = DEFAULT_SYNC_LIMIT } = {}) => {
  if (timer) return timer;

  if (isDisabled()) {
    console.log("[gmail-scheduler] disabled by configuration");
    return null;
  }

  const resolved =
    intervalMs ||
    parseInt(process.env.GMAIL_SCHEDULER_INTERVAL_MS || "", 10) ||
    DEFAULT_INTERVAL_MS;

  timer = setInterval(() => {
    tick({ limit });
  }, resolved);

  // Do not hold the event loop open just for the scheduler.
  if (timer.unref) timer.unref();

  const pushNote = watchService.isConfigured()
    ? ""
    : " (GMAIL_PUBSUB_TOPIC is unset: mail arrives on this schedule rather " +
      "than on push)";
  console.log(`[gmail-scheduler] started, every ${resolved}ms${pushNote}`);
  return timer;
};

const stop = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

module.exports = {
  DEFAULT_INTERVAL_MS,
  WATCH_SWEEP_EVERY_MS,
  DEFAULT_SYNC_LIMIT,
  syncDue,
  sweepWatches,
  sweepStuckNotifications,
  tick,
  start,
  stop,
};
