const AuditEvent = require("./deviceAuditModel");

/**
 * Writes the audit trail.
 *
 * Deliberately not fire-and-forget: the caller awaits it before replying, so
 * a change can never be reported as done while its record is still in
 * flight. The cost is one insert per administrative action, which is nothing
 * against the cost of an unexplainable policy change.
 *
 * A failure here is swallowed and logged rather than thrown. Losing an audit
 * row is bad; refusing a policy change the operating system has already been
 * told about is worse, because it leaves the console and the device
 * disagreeing.
 */
const record = async ({
  companyId,
  actorId = null,
  actorKind,
  action,
  targetType,
  targetId,
  before = null,
  after = null,
  note = "",
}) => {
  try {
    return await AuditEvent.create({
      companyId,
      actorId,
      actorKind,
      action,
      targetType,
      targetId,
      before,
      after,
      note,
      at: new Date(),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[device-control] audit write failed", {
      action,
      targetType,
      targetId,
      message: error.message,
    });
    return null;
  }
};

/** The trail for one company, newest first. */
const list = async ({ companyId, targetType, targetId, limit = 100, skip = 0 }) => {
  const filter = { companyId };
  if (targetType) filter.targetType = targetType;
  if (targetId) filter.targetId = targetId;

  const [events, total] = await Promise.all([
    AuditEvent.find(filter).sort({ at: -1 }).skip(skip).limit(Math.min(limit, 500)),
    AuditEvent.countDocuments(filter),
  ]);

  return { events, total };
};

module.exports = { record, list };
