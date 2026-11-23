const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

/**
 * Who a company's user directory may show, and to whom.
 *
 * `GET /users` used to ignore both `companyId` and the caller: every account
 * on the deployment came back for every company, to anybody holding a token.
 * These tests pin the three things that replaced that — who counts as a
 * member, who may read a company's members, and what an unscoped listing
 * answers with.
 */

const COMPANY_A = "6a81bbf2067c36176e40aa1c";
const COMPANY_B = "6a834bff067c36176e40aa2d";

const OWNER_A = "6a4efa79067c36176e40aa1c";
const INVITED_A = "6a4efa79067c36176e40aa2b";
const GRANTED_A = "6a4efa79067c36176e40aa3c";
const ALL_COMPANIES = "6a4efa79067c36176e40aa4d";
const OWNER_B = "6a4efa79067c36176e40aa5e";
const LONER = "6a4efa79067c36176e40aa6f";
const MASTER = "6a4efa79067c36176e40aa7a";

const CODE_A = "code-a";
const CODE_B = "code-b";

const store = { companies: [], users: [], invitations: [] };

const resolvePath = (id) => Module._resolveFilename(id, module);
const define = (id, exports) => {
  const path = resolvePath(id);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
};

const selectable = (value) => ({ select: async () => value });

/**
 * The subset of the mongo query language these filters are built from.
 *
 * Written out rather than mocked away, because the filters *are* the
 * behaviour under test: a composition mistake (an `$or` overwriting another,
 * a scope dropped) would pass against a stub that ignored the query.
 */
const matches = (doc, filter) => {
  if (!filter || typeof filter !== "object") return true;

  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$and") return expected.every((part) => matches(doc, part));
    if (key === "$or") return expected.some((part) => matches(doc, part));

    const actual = key === "_id" ? String(doc._id) : doc[key];

    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      return Object.entries(expected).every(([operator, operand]) => {
        switch (operator) {
          case "$in":
            return (operand || []).map(String).includes(String(actual));
          case "$ne":
            return String(actual) !== String(operand);
          case "$elemMatch":
            return (Array.isArray(actual) ? actual : []).some((element) =>
              matches(element, operand)
            );
          case "$regex":
            return new RegExp(operand, "i").test(String(actual ?? ""));
          case "$options":
            return true;
          default:
            throw new Error(`unsupported operator ${operator}`);
        }
      });
    }

    return String(actual) === String(expected);
  });
};

const usersMatching = (filter) =>
  store.users.filter((user) => matches(user, filter));

define("./companyModel", {
  findById(id) {
    return selectable(
      store.companies.find((company) => String(company._id) === String(id)) ||
        null
    );
  },
  find(filter) {
    return selectable(store.companies.filter((company) => matches(company, filter)));
  },
});

define("../invitations/invitationModel", {
  find(filter) {
    return selectable(
      store.invitations.filter((invitation) => matches(invitation, filter))
    );
  },
  findOne(filter) {
    return selectable(
      store.invitations.find((invitation) => matches(invitation, filter)) || null
    );
  },
});

const chainable = (rows) => {
  const chain = {
    skip: () => chain,
    limit: () => chain,
    sort: async () => rows,
    then: (resolve) => resolve(rows),
  };
  return chain;
};

define("../users/userModel", {
  find(filter) {
    return chainable(usersMatching(filter));
  },
  findById(id) {
    return selectable(
      store.users.find((user) => String(user._id) === String(id)) || null
    );
  },
  async countDocuments(filter) {
    return usersMatching(filter).length;
  },
  async exists(filter) {
    const found = usersMatching(filter)[0];
    return found ? { _id: found._id } : null;
  },
});

const {
  companyMembersFilter,
  mayListCompanyMembers,
  visibleUsersFilter,
} = require("./companyMembers");
const userService = require("../users/userService");
const engine = require("../../core/access/permissionEngine");

const companyGrant = (companyId) => ({
  resourceType: "company",
  resourceId: companyId,
  resourceName: "Company",
  actions: ["view"],
});

const user = (id, extra = {}) => ({
  _id: id,
  id,
  fullName: `User ${id}`,
  email: `${id}@example.com`,
  role: "junior",
  permissions: [],
  regiCode: null,
  ...extra,
});

const actorFor = (id) => {
  const found = store.users.find((row) => String(row._id) === String(id));
  return new engine.Actor({
    id: String(found._id),
    role: found.role,
    permissions: found.permissions,
  });
};

const seed = () => {
  store.companies = [
    { _id: COMPANY_A, createdBy: OWNER_A },
    { _id: COMPANY_B, createdBy: OWNER_B },
  ];
  store.invitations = [
    { _id: "inv-a", companyId: COMPANY_A, regiCode: CODE_A },
    { _id: "inv-b", companyId: COMPANY_B, regiCode: CODE_B },
  ];
  store.users = [
    user(OWNER_A, { role: "admin" }),
    user(INVITED_A, { regiCode: CODE_A }),
    user(GRANTED_A, { permissions: [companyGrant(COMPANY_A)] }),
    user(ALL_COMPANIES, { permissions: [companyGrant("*")] }),
    user(OWNER_B, { role: "admin" }),
    user(LONER),
    user(MASTER, { role: "master" }),
  ];
};

const idsOf = (rows) => rows.map((row) => String(row.id ?? row._id)).sort();

test("a company's members are its owner, its invitees and its grant holders", async () => {
  seed();
  const filter = await companyMembersFilter(COMPANY_A);
  assert.deepEqual(idsOf(usersMatching(filter)), [
    OWNER_A,
    INVITED_A,
    GRANTED_A,
    ALL_COMPANIES,
  ].sort());
});

test("another company's staff is not in the list", async () => {
  seed();
  const filter = await companyMembersFilter(COMPANY_A);
  const ids = idsOf(usersMatching(filter));
  assert.ok(!ids.includes(OWNER_B));
  assert.ok(!ids.includes(LONER));
});

test("a companyId that is not an id matches nobody", async () => {
  seed();
  for (const bogus of ["", "   ", "not-an-id", null, undefined]) {
    const filter = await companyMembersFilter(bogus);
    assert.deepEqual(usersMatching(filter), []);
  }
});

test("only a company's own people may read its member list", async () => {
  seed();
  for (const id of [OWNER_A, INVITED_A, GRANTED_A, ALL_COMPANIES, MASTER]) {
    assert.equal(
      await mayListCompanyMembers(actorFor(id), COMPANY_A),
      true,
      `${id} belongs to company A`
    );
  }
  for (const id of [OWNER_B, LONER]) {
    assert.equal(
      await mayListCompanyMembers(actorFor(id), COMPANY_A),
      false,
      `${id} does not belong to company A`
    );
  }
  assert.equal(await mayListCompanyMembers(null, COMPANY_A), false);
});

test("the listing refuses a company the caller is not in", async () => {
  seed();
  await assert.rejects(
    () => userService.getAllUsers({ companyId: COMPANY_A }, actorFor(OWNER_B)),
    (error) => error.statusCode === 403 || error.status === 403 || /access/i.test(error.message)
  );
});

test("the listing answers a member with that company's members", async () => {
  seed();
  const result = await userService.getAllUsers(
    { companyId: COMPANY_A, limit: 50 },
    actorFor(OWNER_A)
  );
  assert.deepEqual(idsOf(result.users), [
    OWNER_A,
    INVITED_A,
    GRANTED_A,
    ALL_COMPANIES,
  ].sort());
  assert.equal(result.pagination.total, 4);
});

test("an unscoped listing is the whole deployment only for a master", async () => {
  seed();
  const all = await userService.getAllUsers({ limit: 50 }, actorFor(MASTER));
  assert.equal(all.users.length, store.users.length);

  // Everybody else gets the companies they are attached to, and themselves.
  const mine = await userService.getAllUsers({ limit: 50 }, actorFor(INVITED_A));
  assert.deepEqual(idsOf(mine.users), [
    OWNER_A,
    INVITED_A,
    GRANTED_A,
    ALL_COMPANIES,
  ].sort());

  const alone = await userService.getAllUsers({ limit: 50 }, actorFor(LONER));
  assert.deepEqual(idsOf(alone.users), [LONER]);
});

test("a grant on every company reaches every user", async () => {
  seed();
  assert.equal(await visibleUsersFilter(actorFor(ALL_COMPANIES)), null);
  assert.equal(await visibleUsersFilter(actorFor(MASTER)), null);
  assert.notEqual(await visibleUsersFilter(actorFor(LONER)), null);
});

test("the search and the company scope are both applied", async () => {
  seed();
  // Composed under `$and`: when one of them was assigned to `filter.$or` the
  // other was silently dropped, which is how a search could reach outside
  // the company.
  const result = await userService.getAllUsers(
    { companyId: COMPANY_A, search: INVITED_A, limit: 50 },
    actorFor(OWNER_A)
  );
  assert.deepEqual(idsOf(result.users), [INVITED_A]);

  const foreign = await userService.getAllUsers(
    { companyId: COMPANY_A, search: OWNER_B, limit: 50 },
    actorFor(OWNER_A)
  );
  assert.deepEqual(idsOf(foreign.users), []);
});
