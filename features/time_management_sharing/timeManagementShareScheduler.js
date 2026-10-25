const service = require("./timeManagementSharingService");
const {
  isLocalMongoReady,
} = require("../../infrastructure/database/database.manager");

/**
 * Backend worker that delivers automatic Share Time configurations.
 *
 * It ticks on a fixed interval and asks the service for every configuration
 * whose `nextRunAt` has passed. Claiming is atomic and each delivery is keyed
 * by its occurrence, so the worker is safe to run repeatedly, to restart
 * mid-tick, and (with the claim guard) to run on more than one instance.
 *
 * Automatic sharing therefore does not depend on the desktop app being open:
 * the client only syncs usage, the backend decides when it is delivered.
 */

const DEFAULT_INTERVAL_MS = 60 * 1000;

let timer = null;
let running = false;

async function tick({ limit }) {
  // Never let two ticks overlap: a slow tick would otherwise claim the same
  // occurrences twice in a row and waste work on duplicate-key retries.
  if (running) return [];
  // Every collection this worker touches lives in local MongoDB. With that
  // connection down there is nothing to claim, and nothing to retry against
  // Atlas: the next tick picks the occurrences up once it is back.
  if (!isLocalMongoReady()) {
    console.error(
      "[time-management-scheduler] skipped: local MongoDB is not ready"
    );
    return [];
  }
  running = true;
  try {
    const processed = await service.runDueShares({ now: new Date(), limit });
    if (processed.length > 0) {
      const failed = processed.filter((p) => p.error);
      console.log(
        `[time-management-scheduler] processed ${processed.length} share(s)` +
          (failed.length > 0 ? `, ${failed.length} failed` : "")
      );
      for (const failure of failed) {
        console.error(
          `[time-management-scheduler] share ${failure.shareId} failed: ${failure.error}`
        );
      }
    }
    return processed;
  } catch (error) {
    // A failing tick must not take the process down; the next tick retries.
    console.error("[time-management-scheduler] tick failed:", error.message);
    return [];
  } finally {
    running = false;
  }
}

function start({ intervalMs, limit = 50 } = {}) {
  if (timer) return timer;

  const resolvedInterval =
    intervalMs ||
    parseInt(process.env.TIME_SHARE_SCHEDULER_INTERVAL_MS || "", 10) ||
    DEFAULT_INTERVAL_MS;

  if (process.env.TIME_SHARE_SCHEDULER_DISABLED === "true") {
    console.log("[time-management-scheduler] disabled by configuration");
    return null;
  }

  timer = setInterval(() => {
    tick({ limit });
  }, resolvedInterval);

  // Do not hold the event loop open just for the scheduler.
  if (timer.unref) timer.unref();

  console.log(
    `[time-management-scheduler] started, every ${resolvedInterval}ms`
  );
  return timer;
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { start, stop, tick };
