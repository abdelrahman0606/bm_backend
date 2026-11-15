const test = require("node:test");
const assert = require("node:assert/strict");

const engine = require("./permissionEngine");
const { sanitizeUserWrite } = require("./userWriteGuard");
const { ALL_ENTITIES } = require("./permissionModel");

const { Actor } = engine;

const COMPANY_A = "6a81bbf2067c36176e40aa1c";
const COMPANY_B = "6a834bff067c36176e40aa2d";

const grant = (resourceType, resourceId, actions) => ({
  resourceType,
  resourceId,
  resourceName: "whatever",
  actions,
});

const actor = (role, permissions = []) =>
  new Actor({ id: "actor-1", role, permissions });

// ---------------------------------------------------------------------------
// Fail-closed basics
// ---------------------------------------------------------------------------

test("an unauthenticated caller is refused everything", () => {
  const nobody = Actor.anonymous();
  assert.equal(engine.can(nobody, "company", "view", COMPANY_A), false);
  assert.equal(engine.canAny(nobody, "company", "view"), false);
  assert.equal(engine.canAll(nobody, "company", "view"), false);
});

test("an unauthenticated master-by-claim is still refused", () => {
  // No session: the role alone must never read as authority, and the scope
  // must never read as "no restriction".
  const claimed = new Actor({ id: null, role: "master", permissions: [] });
  assert.equal(engine.canAny(claimed, "company", "view"), false);
  assert.deepEqual(engine.visibleEntityIds(claimed, "company", "view"), []);
});

test("a role on its own grants no resource access", () => {
  for (const role of ["admin", "manager", "supervisor", "departmentHead", "senior", "midLevel", "junior", "trainer"]) {
    const subject = actor(role);
    assert.equal(
      engine.canAny(subject, "company", "view"),
      false,
      `${role} should hold nothing without a grant`
    );
  }
});

test("master is unrestricted", () => {
  const owner = actor("master");
  assert.equal(engine.can(owner, "company", "delete", COMPANY_A), true);
  assert.equal(engine.canAll(owner, "settings", "update"), true);
  assert.equal(engine.visibleEntityIds(owner, "company", "view"), null);
});

test("an unknown resource type grants nothing", () => {
  const subject = actor("admin", [grant("galaxy", ALL_ENTITIES, ["fullAccess"])]);
  assert.equal(engine.canAny(subject, "galaxy", "view"), false);
  assert.equal(engine.canAny(subject, "company", "view"), false);
});

test("an unknown action grants nothing", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["view"])]);
  assert.equal(engine.can(subject, "company", "annihilate", COMPANY_A), false);
});

test("a malformed grant is ignored rather than throwing", () => {
  const subject = actor("admin", [null, "nonsense", {}, grant("company", COMPANY_A, ["view"])]);
  assert.equal(engine.can(subject, "company", "view", COMPANY_A), true);
  assert.equal(engine.can(subject, "company", "view", COMPANY_B), false);
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test("a grant on one company does not reach another", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["view", "update"])]);
  assert.equal(engine.can(subject, "company", "view", COMPANY_A), true);
  assert.equal(engine.can(subject, "company", "view", COMPANY_B), false);
});

test("fullAccess on one company is not access to every company", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["fullAccess"])]);
  assert.equal(engine.can(subject, "company", "delete", COMPANY_A), true);
  assert.equal(engine.canAll(subject, "company", "view"), false);
  assert.deepEqual(engine.visibleEntityIds(subject, "company", "view"), [COMPANY_A]);
});

test("view is not treated as full access", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["view"])]);
  assert.equal(engine.can(subject, "company", "view", COMPANY_A), true);
  assert.equal(engine.can(subject, "company", "update", COMPANY_A), false);
  assert.equal(engine.can(subject, "company", "delete", COMPANY_A), false);
});

test("an all-entities grant covers any id and lifts the restriction", () => {
  const subject = actor("manager", [grant("company", ALL_ENTITIES, ["view"])]);
  assert.equal(engine.can(subject, "company", "view", COMPANY_B), true);
  assert.equal(engine.canAll(subject, "company", "view"), true);
  assert.equal(engine.visibleEntityIds(subject, "company", "view"), null);
});

test("an action on no entity is refused, not waved through", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["view"])]);
  assert.equal(engine.can(subject, "company", "view", ""), false);
  assert.equal(engine.can(subject, "company", "view", null), false);
  assert.equal(engine.can(subject, "company", "view", undefined), false);
});

test("company access does not reach into departments", () => {
  const subject = actor("admin", [grant("company", ALL_ENTITIES, ["fullAccess"])]);
  // No parent-child link is stored, so no inheritance is invented.
  assert.equal(engine.canAny(subject, "department", "view"), false);
});

test("visibleEntityIds on no grants is an empty list, never null", () => {
  const subject = actor("junior");
  assert.deepEqual(engine.visibleEntityIds(subject, "company", "view"), []);
});

test("visibleEntityIds is per action", () => {
  const subject = actor("admin", [
    grant("company", COMPANY_A, ["view"]),
    grant("company", COMPANY_B, ["view", "delete"]),
  ]);
  assert.deepEqual(
    engine.visibleEntityIds(subject, "company", "view").sort(),
    [COMPANY_A, COMPANY_B].sort()
  );
  assert.deepEqual(engine.visibleEntityIds(subject, "company", "delete"), [COMPANY_B]);
});

test("duplicate grants collapse", () => {
  const subject = actor("admin", [
    grant("company", COMPANY_A, ["view"]),
    grant("company", COMPANY_A, ["view"]),
  ]);
  assert.deepEqual(engine.visibleEntityIds(subject, "company", "view"), [COMPANY_A]);
});

// ---------------------------------------------------------------------------
// Mongo filters
// ---------------------------------------------------------------------------

test("scopeFilter is empty for an unrestricted actor", () => {
  assert.deepEqual(engine.scopeFilter(actor("master"), "company", "view"), {});
});

test("scopeFilter narrows to the granted ids", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["view"])]);
  assert.deepEqual(engine.scopeFilter(subject, "company", "view"), {
    _id: { $in: [COMPANY_A] },
  });
});

test("scopeFilter for no grants matches nothing rather than everything", () => {
  const filter = engine.scopeFilter(actor("junior"), "company", "view");
  assert.deepEqual(filter, { _id: { $in: [] } });
});

test("scopeFilter can name another field", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["view"])]);
  assert.deepEqual(
    engine.scopeFilter(subject, "company", "view", { field: "companyId" }),
    { companyId: { $in: [COMPANY_A] } }
  );
});

// ---------------------------------------------------------------------------
// Role hierarchy
// ---------------------------------------------------------------------------

test("seniority follows the chain", () => {
  assert.equal(engine.isAtLeast("admin", "supervisor"), true);
  assert.equal(engine.isAtLeast("junior", "supervisor"), false);
  assert.equal(engine.isAtLeast("supervisor", "supervisor"), true);
});

test("master outranks even a role off the chain", () => {
  assert.equal(engine.isAtLeast("master", "trainer"), true);
  assert.equal(engine.isAtLeast("trainer", "junior"), false);
});

test("a missing role is never senior enough", () => {
  assert.equal(engine.isAtLeast(null, "junior"), false);
  assert.equal(engine.isAtLeast("", "junior"), false);
  assert.equal(engine.isAtLeast("archduke", "junior"), false);
});

test("a role cannot assign its own level or above", () => {
  assert.equal(engine.canAssignRole(actor("admin"), "admin"), false);
  assert.equal(engine.canAssignRole(actor("admin"), "master"), false);
  assert.equal(engine.canAssignRole(actor("admin"), "manager"), true);
  assert.equal(engine.canAssignRole(actor("master"), "master"), true);
});

// ---------------------------------------------------------------------------
// The grant ceiling
// ---------------------------------------------------------------------------

test("a user may not grant access they do not hold", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["view"])]);
  assert.equal(engine.canGrant(subject, grant("company", COMPANY_A, ["view"])), true);
  assert.equal(engine.canGrant(subject, grant("company", COMPANY_A, ["delete"])), false);
  assert.equal(engine.canGrant(subject, grant("company", COMPANY_B, ["view"])), false);
});

test("holding one company does not let you grant the whole type", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["fullAccess"])]);
  assert.equal(engine.canGrant(subject, grant("company", ALL_ENTITIES, ["view"])), false);
});

test("holding the whole type lets you grant it", () => {
  const subject = actor("admin", [grant("company", ALL_ENTITIES, ["fullAccess"])]);
  assert.equal(engine.canGrant(subject, grant("company", ALL_ENTITIES, ["view"])), true);
  assert.equal(engine.canGrant(subject, grant("company", COMPANY_B, ["update"])), true);
});

test("every action in a grant is checked, not just the first", () => {
  const subject = actor("admin", [grant("company", COMPANY_A, ["view", "update"])]);
  assert.equal(
    engine.canGrant(subject, grant("company", COMPANY_A, ["view", "delete"])),
    false
  );
});

test("an empty or malformed grant is not a way in", () => {
  const subject = actor("admin", [grant("company", ALL_ENTITIES, ["fullAccess"])]);
  assert.equal(engine.canGrant(subject, grant("company", COMPANY_A, [])), false);
  assert.equal(engine.canGrant(subject, grant("company", COMPANY_A, ["view", "fly"])), false);
  assert.equal(engine.canGrant(subject, null), false);
});

// ---------------------------------------------------------------------------
// The user write ceiling
// ---------------------------------------------------------------------------

test("a user cannot promote themselves", () => {
  const subject = actor("junior");
  assert.throws(
    () =>
      sanitizeUserWrite(subject, { role: "master" }, {
        current: { role: "junior", permissions: [] },
      }),
    /may not assign the role/
  );
});

test("a user cannot write themselves a grant", () => {
  const subject = actor("junior");
  assert.throws(
    () =>
      sanitizeUserWrite(
        subject,
        { permissions: [grant("company", ALL_ENTITIES, ["fullAccess"])] },
        { current: { role: "junior", permissions: [] } }
      ),
    /only grant access that you hold/
  );
});

test("re-sending the stored role and grants is not an escalation", () => {
  // The client sends the whole user on every edit, so an untouched role and
  // permission list must pass even for an actor who could not hand them out.
  const stored = {
    role: "manager",
    permissions: [grant("company", COMPANY_A, ["fullAccess"])],
  };
  const subject = actor("supervisor");
  const result = sanitizeUserWrite(
    subject,
    { fullName: "New Name", role: "manager", permissions: stored.permissions },
    { current: stored }
  );
  assert.equal(result.fullName, "New Name");
  assert.equal(result.role, "manager");
});

test("a grant added alongside stored ones is still checked", () => {
  const stored = {
    role: "junior",
    permissions: [grant("company", COMPANY_A, ["view"])],
  };
  const subject = actor("supervisor", [grant("company", COMPANY_A, ["view"])]);
  assert.throws(
    () =>
      sanitizeUserWrite(
        subject,
        { permissions: [...stored.permissions, grant("company", COMPANY_B, ["view"])] },
        { current: stored }
      ),
    /only grant access that you hold/
  );
});

test("a grant whose actions are reordered counts as unchanged", () => {
  const stored = {
    role: "junior",
    permissions: [grant("company", COMPANY_A, ["view", "update"])],
  };
  const subject = actor("supervisor");
  const result = sanitizeUserWrite(
    subject,
    { permissions: [grant("company", COMPANY_A, ["update", "view"])] },
    { current: stored }
  );
  assert.equal(result.permissions.length, 1);
});

test("master may write anything", () => {
  const result = sanitizeUserWrite(
    actor("master"),
    { role: "admin", permissions: [grant("company", ALL_ENTITIES, ["fullAccess"])] },
    { current: { role: "junior", permissions: [] } }
  );
  assert.equal(result.role, "admin");
  assert.equal(result.permissions.length, 1);
});

test("the legacy access list is dropped for anyone but master", () => {
  const result = sanitizeUserWrite(
    actor("admin", [grant("member", ALL_ENTITIES, ["fullAccess"])]),
    { fullName: "x", access: ["page=company&type=fullAccess"] },
    { current: { role: "junior", permissions: [] } }
  );
  assert.equal("access" in result, false);
});

test("a permissions value that is not a list is refused", () => {
  assert.throws(
    () =>
      sanitizeUserWrite(actor("master"), { permissions: "all" }, { current: null }),
    /must be a list/
  );
});

test("an unauthenticated write is refused before anything is read", () => {
  assert.throws(
    () => sanitizeUserWrite(Actor.anonymous(), { fullName: "x" }, { current: null }),
    /Authentication required/
  );
});

test("a create with no stored state checks every grant", () => {
  const subject = actor("admin", [grant("member", ALL_ENTITIES, ["create"])]);
  assert.throws(
    () =>
      sanitizeUserWrite(
        subject,
        { role: "junior", permissions: [grant("company", COMPANY_A, ["view"])] },
        { current: null }
      ),
    /only grant access that you hold/
  );
});
