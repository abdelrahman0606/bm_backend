/**
 * The staging switch for entity-scope authorization.
 *
 * Permissions were never persisted before, so no account carries grants yet.
 * Turning scope checks on before they are assigned would refuse every
 * non-master user, so this starts off and is turned on with
 * `ACCESS_ENFORCE=true` once grants exist. It mirrors Flutter's
 * `AccessRouteGuard.enforce`, and is a staging switch, not a setting.
 *
 * It governs only *which entities* a user may reach. Two things are never
 * switchable, because neither can lock anyone out of work they already do:
 *
 *  - authentication: every user route requires a verified token;
 *  - the escalation ceiling: nobody may grant themselves a role or a
 *    permission above their own, whatever this is set to.
 */
const scopeEnforced = () => {
  const raw = process.env.ACCESS_ENFORCE;
  if (raw === undefined || raw === null) return false;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
};

module.exports = { scopeEnforced };
