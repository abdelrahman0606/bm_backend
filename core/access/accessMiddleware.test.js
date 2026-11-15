const test = require("node:test");
const assert = require("node:assert/strict");

const { objectIdScopeFilter, requirePermission, actorOf } = require("./accessMiddleware");
const { scopeEnforced } = require("./accessConfig");
const { Actor } = require("./permissionEngine");
const { ALL_ENTITIES } = require("./permissionModel");

const COMPANY_A = "6a81bbf2067c36176e40aa1c";

const grant = (resourceType, resourceId, actions) => ({
  resourceType,
  resourceId,
  resourceName: "whatever",
  actions,
});

const actor = (role, permissions = []) =>
  new Actor({ id: "6a4efa79067c36176e40aa1c", role, permissions });

/** Runs a middleware and reports what it passed to next(). */
const run = async (middleware, req) => {
  let passed;
  let called = false;
  await middleware(req, {}, (value) => {
    called = true;
    passed = value;
  });
  return { called, error: passed };
};

// ---------------------------------------------------------------------------
// The scope filter
// ---------------------------------------------------------------------------

test("an unrestricted actor contributes no filter", () => {
  assert.deepEqual(objectIdScopeFilter(actor("master"), "company", "view"), {});
});

test("ids that are not ObjectIds are dropped rather than throwing", () => {
  // The old mock resource loader handed out ids like "comp_1"; casting one
  // would throw a CastError and take the whole request down.
  const subject = actor("admin", [
    grant("company", COMPANY_A, ["view"]),
    grant("company", "comp_1", ["view"]),
  ]);
  assert.deepEqual(objectIdScopeFilter(subject, "company", "view"), {
    _id: { $in: [COMPANY_A] },
  });
});

test("an actor with only unusable ids matches nothing", () => {
  const subject = actor("admin", [grant("company", "comp_1", ["view"])]);
  assert.deepEqual(objectIdScopeFilter(subject, "company", "view"), {
    _id: { $in: [] },
  });
});

test("an all-entities grant lifts the filter entirely", () => {
  const subject = actor("admin", [grant("company", ALL_ENTITIES, ["view"])]);
  assert.deepEqual(objectIdScopeFilter(subject, "company", "view"), {});
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test("a request with no actor is refused as unauthenticated", async () => {
  const gate = requirePermission("company", "view");
  const { error } = await run(gate, { actor: Actor.anonymous() });
  assert.equal(error.statusCode ?? error.status, 401);
});

test("a gate without an entity asks only whether some entity is reachable", async () => {
  const gate = requirePermission("company", "view");
  const subject = actor("admin", [grant("company", COMPANY_A, ["view"])]);
  const { error } = await run(gate, { actor: subject });
  assert.equal(error, undefined);
});

test("a gate on an entity checks that one entity", async () => {
  const gate = requirePermission("company", "update", { entityIdFrom: "id" });
  const subject = actor("admin", [grant("company", COMPANY_A, ["view"])]);

  const refused = await run(gate, { actor: subject, params: { id: COMPANY_A } });
  assert.equal(refused.error.statusCode ?? refused.error.status, 403);

  const allowed = await run(
    requirePermission("company", "view", { entityIdFrom: "id" }),
    { actor: subject, params: { id: COMPANY_A } }
  );
  assert.equal(allowed.error, undefined);
});

test("a gate on an entity with no id is refused", async () => {
  const gate = requirePermission("company", "view", { entityIdFrom: "id" });
  const subject = actor("admin", [grant("company", COMPANY_A, ["view"])]);
  const { error } = await run(gate, { actor: subject, params: {} });
  assert.equal(error.statusCode ?? error.status, 403);
});

test("an actor holding nothing is refused", async () => {
  const gate = requirePermission("company", "view");
  const { error } = await run(gate, { actor: actor("junior") });
  assert.equal(error.statusCode ?? error.status, 403);
});

test("master passes every gate", async () => {
  const gate = requirePermission("company", "delete", { entityIdFrom: "id" });
  const { error } = await run(gate, { actor: actor("master"), params: { id: COMPANY_A } });
  assert.equal(error, undefined);
});

test("actorOf never returns undefined", () => {
  assert.equal(actorOf({}).isAuthenticated, false);
  assert.equal(actorOf({ actor: actor("master") }).isMaster, true);
});

// ---------------------------------------------------------------------------
// The staging switch
// ---------------------------------------------------------------------------

test("scope enforcement is off unless the environment turns it on", () => {
  const original = process.env.ACCESS_ENFORCE;
  try {
    delete process.env.ACCESS_ENFORCE;
    assert.equal(scopeEnforced(), false);

    process.env.ACCESS_ENFORCE = "false";
    assert.equal(scopeEnforced(), false);

    process.env.ACCESS_ENFORCE = "true";
    assert.equal(scopeEnforced(), true);

    process.env.ACCESS_ENFORCE = "1";
    assert.equal(scopeEnforced(), true);

    process.env.ACCESS_ENFORCE = "nonsense";
    assert.equal(scopeEnforced(), false);
  } finally {
    if (original === undefined) delete process.env.ACCESS_ENFORCE;
    else process.env.ACCESS_ENFORCE = original;
  }
});
