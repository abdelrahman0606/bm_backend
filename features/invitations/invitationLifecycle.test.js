const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

/**
 * Registering used to delete the invitation it consumed. It is now kept and
 * marked accepted, because `core/access/companyResolver.js` reads
 * `User.regiCode` -> `Invitation.regiCode` -> `companyId` to work out which
 * company a user belongs to: delete the row and the account it created
 * belongs to no company at all.
 *
 * Keeping it moves two jobs the deletion used to do onto the status, and
 * these tests pin both: a code cannot be used twice, and the expiry sweep
 * must not reap a row somebody's access now depends on.
 */

const COMPANY_A = "6af43754d00632bfb501f5c0";

const resolvePath = (id) => Module._resolveFilename(id, module);
const define = (id, exports) => {
  const path = resolvePath(id);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
};

const store = { invitations: [], deleted: [], queries: [] };

const reset = () => {
  store.invitations = [];
  store.deleted = [];
  store.queries = [];
};

const invitation = (overrides = {}) => ({
  id: "inv-1",
  regiCode: "74C7EE2B",
  companyId: COMPANY_A,
  status: "pending",
  role: "admin",
  employeeType: "internalEmployee",
  jobs: [],
  permissions: [],
  expiredAt: new Date(Date.now() + 86400000),
  ...overrides,
});

define("./invitationRepository", {
  find: async (filter, skip, limit, sort) => {
    store.queries.push({ filter, skip, limit, sort });
    return store.invitations;
  },
  count: async () => store.invitations.length,
  findById: async (id) =>
    store.invitations.find((row) => row.id === id) || null,
  findByRegiCode: async (regiCode) =>
    store.invitations.find((row) => row.regiCode === regiCode) || null,
  updateById: async (id, data) => {
    const row = store.invitations.find((item) => item.id === id);
    if (!row) return null;
    Object.assign(row, data);
    return row;
  },
  deleteById: async (id) => {
    const row = store.invitations.find((item) => item.id === id);
    if (!row) return null;
    store.deleted.push(id);
    store.invitations = store.invitations.filter((item) => item.id !== id);
    return row;
  },
});

const service = require("./invitationService");

test.beforeEach(reset);

const rejects = async (fn, statusCode, match) => {
  await assert.rejects(fn, (error) => {
    assert.equal(error.statusCode, statusCode);
    if (match) assert.match(error.message, match);
    return true;
  });
};

// ---------------------------------------------------------------------------
// A code is good once
// ---------------------------------------------------------------------------

test("a pending code validates", async () => {
  store.invitations.push(invitation());
  const found = await service.validateRegiCode("74C7EE2B");
  assert.equal(found.companyId, COMPANY_A);
});

test("a code that has already been used is refused", async () => {
  store.invitations.push(invitation({ status: "accepted" }));
  await rejects(
    () => service.validateRegiCode("74C7EE2B"),
    409,
    /already been used/
  );
});

test("a cancelled or revoked invitation is refused", async () => {
  store.invitations.push(invitation({ status: "revoked" }));
  await rejects(
    () => service.validateRegiCode("74C7EE2B"),
    409,
    /no longer valid/
  );
});

test("a code that matches nothing is refused", async () => {
  await rejects(() => service.validateRegiCode("NOPE"), 404);
});

test("accepting an invitation marks it, and the row stays", async () => {
  store.invitations.push(invitation());
  const accepted = await service.acceptInvitation("inv-1");
  assert.equal(accepted.status, "accepted");
  assert.equal(store.invitations.length, 1);
  assert.deepEqual(store.deleted, []);
});

test("accepting an invitation that is gone is an error", async () => {
  await rejects(() => service.acceptInvitation("inv-1"), 404);
});

// ---------------------------------------------------------------------------
// The expiry sweep must not break a live link
// ---------------------------------------------------------------------------

test("an expired pending invitation is still deleted", async () => {
  store.invitations.push(invitation({ expiredAt: new Date(Date.now() - 1000) }));
  await rejects(() => service.validateRegiCode("74C7EE2B"), 400, /expired/);
  assert.deepEqual(store.deleted, ["inv-1"]);
});

test("an accepted invitation past its expiry is kept", async () => {
  // Its expiry date stopped meaning anything the moment it was accepted:
  // deleting it here would unlink the user who registered with it.
  store.invitations.push(
    invitation({ status: "accepted", expiredAt: new Date(Date.now() - 1000) })
  );

  const found = await service.getInvitationById("inv-1");

  assert.equal(found.status, "accepted");
  assert.deepEqual(store.deleted, []);
  assert.equal(store.invitations.length, 1);
});

test("an accepted invitation can still be updated without being reaped", async () => {
  store.invitations.push(
    invitation({ status: "accepted", expiredAt: new Date(Date.now() - 1000) })
  );
  const updated = await service.updateInvitation("inv-1", { role: "manager" });
  assert.equal(updated.role, "manager");
  assert.deepEqual(store.deleted, []);
});

test("an expired invitation can be renewed instead of being swept away", async () => {
  // The edit screen's whole reason for touching an expired invitation.
  store.invitations.push(
    invitation({ expiredAt: new Date(Date.now() - 1000) })
  );

  const renewedUntil = new Date(Date.now() + 7 * 86400000);
  const updated = await service.updateInvitation("inv-1", {
    expiredAt: renewedUntil,
    role: "manager",
  });

  assert.equal(updated.role, "manager");
  assert.equal(Number(updated.expiredAt), Number(renewedUntil));
  assert.deepEqual(store.deleted, []);
});

test("an edit that does not move the expiry still reaps an expired one", async () => {
  store.invitations.push(
    invitation({ expiredAt: new Date(Date.now() - 1000) })
  );
  await rejects(
    () => service.updateInvitation("inv-1", { role: "manager" }),
    400,
    /expired/
  );
  assert.deepEqual(store.deleted, ["inv-1"]);
});

test("an expiry still in the past is not a renewal", async () => {
  store.invitations.push(
    invitation({ expiredAt: new Date(Date.now() - 2000) })
  );
  await rejects(
    () =>
      service.updateInvitation("inv-1", {
        expiredAt: new Date(Date.now() - 1000),
      }),
    400,
    /expired/
  );
});

// ---------------------------------------------------------------------------
// What the invitations list shows
// ---------------------------------------------------------------------------

test("used codes are left out of the list by default", async () => {
  await service.getInvitations({});
  assert.deepEqual(store.queries[0].filter.status, { $ne: "accepted" });
});

test("an explicit status reaches the used ones", async () => {
  await service.getInvitations({ status: "accepted" });
  assert.equal(store.queries[0].filter.status, "accepted");
});

test("the other filters still apply", async () => {
  await service.getInvitations({ companyId: COMPANY_A, type: "personal" });
  assert.equal(store.queries[0].filter.companyId, COMPANY_A);
  assert.equal(store.queries[0].filter.type, "personal");
});
