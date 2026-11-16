const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

/**
 * An invitation is written with the access the invited person is meant to
 * have. These tests pin that registering actually carries that access onto
 * the account: the grants were being dropped, so every invited user arrived
 * with none and could reach nothing the permission engine guards.
 */

const COMPANY_A = "6af43754d00632bfb501f5c0";
const COMPANY_B = "6a7c728a16a0e75419e6249a";

const resolvePath = (id) => Module._resolveFilename(id, module);
const define = (id, exports) => {
  const path = resolvePath(id);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
};

const store = {
  created: [],
  deleted: [],
  accepted: [],
  invitation: null,
  existing: null,
};

const reset = () => {
  store.created = [];
  store.deleted = [];
  store.accepted = [];
  store.existing = null;
  store.invitation = {
    id: "inv-1",
    regiCode: "74C7EE2B",
    companyId: COMPANY_A,
    role: "admin",
    employeeType: "internalEmployee",
    jobs: ["projectManager"],
    permissions: [
      {
        resourceType: "company",
        resourceId: COMPANY_A,
        resourceName: "Realty Kingdom International",
        actions: ["fullAccess"],
      },
      {
        resourceType: "company",
        resourceId: COMPANY_B,
        resourceName: "Valuation Kingdom",
        actions: ["fullAccess"],
      },
    ],
    expiredAt: new Date(Date.now() + 86400000),
  };
};

reset();

define("../users/userModel", {
  findOne: async () => store.existing,
  create: async (doc) => {
    store.created.push(doc);
    return { _id: "user-1", ...doc };
  },
});

define("../invitations/invitationService", {
  validateRegiCode: async () => store.invitation,
  acceptInvitation: async (id) => {
    store.accepted.push(id);
    return { id, status: "accepted" };
  },
  deleteInvitation: async (id) => {
    store.deleted.push(id);
    return { id };
  },
});

const authService = require("./authService");
const { sanitizePermissions } = require("../../core/access/permissionModel");

const register = () =>
  authService.register({
    email: "Invited@Example.com",
    password: "secret123",
    fullName: "Invited User",
    phone: "0100000000",
    invitationCode: "74C7EE2B",
  });

test.beforeEach(reset);

// ---------------------------------------------------------------------------
// Registering carries the invitation's access
// ---------------------------------------------------------------------------

test("the invitation's grants are stored on the new user", async () => {
  await register();

  assert.equal(store.created.length, 1);
  assert.deepEqual(store.created[0].permissions, [
    {
      resourceType: "company",
      resourceId: COMPANY_A,
      resourceName: "Realty Kingdom International",
      actions: ["fullAccess"],
    },
    {
      resourceType: "company",
      resourceId: COMPANY_B,
      resourceName: "Valuation Kingdom",
      actions: ["fullAccess"],
    },
  ]);
});

test("the grants come back in the response the client builds its user from", async () => {
  const result = await register();

  assert.deepEqual(
    result.user.permissions.map((grant) => grant.resourceId),
    [COMPANY_A, COMPANY_B]
  );
  assert.deepEqual(result.user.permissions[0].actions, ["fullAccess"]);
});

test("role, employee type and jobs still come from the invitation", async () => {
  await register();

  const created = store.created[0];
  assert.equal(created.role, "admin");
  assert.equal(created.employeeType, "internalEmployee");
  assert.deepEqual(created.jobs, ["projectManager"]);
});

test("an invitation with no grants creates an account with none", async () => {
  store.invitation.permissions = undefined;
  await register();
  assert.deepEqual(store.created[0].permissions, []);
});

test("a malformed grant is dropped rather than failing the registration", async () => {
  // `permissions` is Mixed on the invitation, so anything can be in there.
  store.invitation.permissions = [
    { resourceType: "wormhole", resourceId: COMPANY_A, actions: ["view"] },
    { resourceType: "company", resourceId: COMPANY_A, actions: ["view"] },
  ];

  await register();

  assert.deepEqual(store.created[0].permissions, [
    {
      resourceType: "company",
      resourceId: COMPANY_A,
      resourceName: "",
      actions: ["view"],
    },
  ]);
});

test("the invitation is consumed by accepting it, not by deleting it", async () => {
  // Deleting it would take the company link down with it.
  await register();
  assert.deepEqual(store.accepted, ["inv-1"]);
  assert.deepEqual(store.deleted, []);
});

test("the code is stored on the user, so the company link resolves", async () => {
  await register();
  assert.equal(store.created[0].regiCode, "74C7EE2B");
});

// ---------------------------------------------------------------------------
// What survives the copy
// ---------------------------------------------------------------------------

test("an unknown resource type is not stored", () => {
  assert.deepEqual(
    sanitizePermissions([
      { resourceType: "wormhole", resourceId: "x", actions: ["view"] },
    ]),
    []
  );
});

test("an unknown action is not stored", () => {
  assert.deepEqual(
    sanitizePermissions([
      { resourceType: "company", resourceId: "x", actions: ["launch"] },
    ]),
    []
  );
});

test("a grant with no action at all is not stored", () => {
  assert.deepEqual(
    sanitizePermissions([{ resourceType: "company", resourceId: "x" }]),
    []
  );
});

test("an unknown action is dropped from a grant that also has a real one", () => {
  assert.deepEqual(
    sanitizePermissions([
      {
        resourceType: "company",
        resourceId: "x",
        actions: ["launch", "view", "view"],
      },
    ]),
    [
      {
        resourceType: "company",
        resourceId: "x",
        resourceName: "",
        actions: ["view"],
      },
    ]
  );
});

test("an empty resource id keeps meaning every entity of its type", () => {
  // Both engines read a blank id as all-entities, and the schema requires
  // the field, so the meaning is stored explicitly.
  assert.deepEqual(
    sanitizePermissions([
      { resourceType: "project", resourceId: "", actions: ["view"] },
    ]),
    [
      {
        resourceType: "project",
        resourceId: "*",
        resourceName: "",
        actions: ["view"],
      },
    ]
  );
});

test("junk in the list is skipped", () => {
  assert.deepEqual(sanitizePermissions([null, "nope", 7, undefined]), []);
});

test("anything that is not a list is no grants", () => {
  // The invitation schema defaults this field to `{}`.
  assert.deepEqual(sanitizePermissions({}), []);
  assert.deepEqual(sanitizePermissions(undefined), []);
});
