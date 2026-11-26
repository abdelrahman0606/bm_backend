const { GmailOperationLog } = require("./gmailOperationLogModel");

/**
 * Writes the operation log.
 *
 * Small on purpose, and used by every service that changes something, so that
 * "what happened to this mailbox" has one answer rather than one per service.
 *
 * Two properties it guarantees.
 *
 * **Logging never fails the operation.** A send that Gmail accepted has been
 * sent; losing the record of it is bad, and refusing to admit it happened is
 * worse. So every write here is wrapped and failures are logged to the
 * console. The one exception is `claim`, where the write *is* the mechanism
 * and a failure is the answer.
 *
 * **The actor is recorded, not inferred.** Every caller says who it is. A
 * user action carries the user id; the scheduler carries `system`; an
 * automated agent would carry `agent` and its own label. That field is the
 * difference between an audit log and a list of events.
 */

/** The actor for something a signed-in person asked for. */
const userActor = (userId) => ({ kind: "user", id: userId, label: null });

/** The actor for background work: a sync pass, a watch renewal. */
const systemActor = (label) => ({ kind: "system", id: null, label });

/**
 * Opens a log entry before the work starts, returning the document.
 *
 * `idempotencyKey` is what makes a send safe to retry. The unique index does
 * the enforcing: if two requests race with the same key, one insert wins and
 * the other throws a duplicate-key error, which `claim` reports as the
 * already-existing entry rather than as a failure. The caller then returns
 * the first attempt's result instead of sending the message twice.
 */
const claim = async ({
  accountId,
  userId,
  operation,
  actor,
  request = {},
  idempotencyKey = null,
}) => {
  try {
    const entry = await GmailOperationLog.create({
      accountId,
      userId,
      operation,
      status: "queued",
      actor: actor || userActor(userId),
      request,
      idempotencyKey: idempotencyKey || undefined,
      attempts: 0,
      startedAt: new Date(),
    });
    return { entry, duplicate: null };
  } catch (error) {
    if (error.code === 11000 && idempotencyKey) {
      const existing = await GmailOperationLog.findOne({ idempotencyKey });
      // The key was used before. The caller must not act again; it returns
      // what that attempt produced.
      return { entry: null, duplicate: existing || null };
    }
    throw error;
  }
};

/** Records that Gmail accepted the operation. */
const succeeded = async (entry, result = {}) => {
  if (!entry) return null;
  try {
    const finishedAt = new Date();
    entry.status = "accepted";
    entry.result = { ...(entry.result || {}), ...result };
    entry.attempts += 1;
    entry.finishedAt = finishedAt;
    entry.durationMs = entry.startedAt
      ? finishedAt.getTime() - new Date(entry.startedAt).getTime()
      : null;
    await entry.save();
    return entry;
  } catch (error) {
    console.error("[gmail] could not record a successful operation:", error.message);
    return entry;
  }
};

/** Records that it did not, with enough detail to act on. */
const failed = async (entry, error) => {
  if (!entry) return null;
  try {
    const finishedAt = new Date();
    entry.status = "failed";
    entry.attempts += 1;
    entry.error = {
      code: error?.reason || error?.code || null,
      httpStatus: error?.httpStatus || error?.statusCode || null,
      message: error?.message || "Unknown failure",
      retryable: error?.retryable === true,
    };
    entry.finishedAt = finishedAt;
    entry.durationMs = entry.startedAt
      ? finishedAt.getTime() - new Date(entry.startedAt).getTime()
      : null;
    await entry.save();
    return entry;
  } catch (saveError) {
    console.error("[gmail] could not record a failed operation:", saveError.message);
    return entry;
  }
};

/**
 * One-shot entry for something that has already happened and cannot fail —
 * an account connected, a watch renewed. No claim/settle pair needed.
 */
const record = async ({
  accountId,
  userId,
  operation,
  actor,
  request = {},
  result = {},
  status = "accepted",
}) => {
  try {
    return await GmailOperationLog.create({
      accountId,
      userId,
      operation,
      status,
      actor: actor || userActor(userId),
      request,
      result,
      attempts: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 0,
    });
  } catch (error) {
    console.error(`[gmail] could not record "${operation}":`, error.message);
    return null;
  }
};

/**
 * The history view: what has been done to a mailbox, newest first.
 *
 * Paginated the same way as every other list in this feature, and filterable
 * by operation and status — which is what makes "show me failed sends" a
 * single indexed query.
 */
const history = async (
  userId,
  { accountId, operation, status, page = 0, limit = 25 } = {},
) => {
  const safePage = Math.max(0, Number(page) || 0);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 25), 100);

  const query = { userId };
  if (accountId) query.accountId = accountId;
  if (operation) {
    query.operation = Array.isArray(operation)
      ? { $in: operation }
      : operation;
  }
  if (status) query.status = Array.isArray(status) ? { $in: status } : status;

  const [entries, total] = await Promise.all([
    GmailOperationLog.find(query)
      .sort({ createdAt: -1 })
      .skip(safePage * safeLimit)
      .limit(safeLimit)
      .exec(),
    GmailOperationLog.countDocuments(query),
  ]);

  return {
    entries,
    total,
    page: safePage,
    limit: safeLimit,
    hasMore: (safePage + 1) * safeLimit < total,
  };
};

module.exports = {
  userActor,
  systemActor,
  claim,
  succeeded,
  failed,
  record,
  history,
};
