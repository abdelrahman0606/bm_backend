const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

/**
 * The company a request belongs to is derived here, never accepted from the
 * caller. These tests pin that: what counts as a link, what a claim can and
 * cannot do, and that an unresolvable user is refused rather than defaulted.
 */

const COMPANY_A = "6a81bbf2067c36176e40aa1c";
const COMPANY_B = "6a834bff067c36176e40aa2d";
const OWNER = "6a4efa79067c36176e40aa1c";
const INVITED = "6a4efa79067c36176e40aa2b";
const STRANGER = "6a4efa79067c36176e40aa3c";

const store = { companies: [], users: {}, invitations: [] };

const reset = () => {
  store.companies = [];
  store.users = {};
  store.invitations = [];
};

const resolvePath = (id) => Module._resolveFilename(id, module);
const define = (id, exports) => {
  const path = resolvePath(id);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
};

const selectable = (value) => ({ select: async () => value });

define("../../features/companies/companyModel", {
  find(filter) {
    const createdBy = filter && filter.createdBy ? String(filter.createdBy) : null;
    return selectable(
      store.companies.filter(
        (company) => !createdBy || String(company.createdBy) === createdBy
      )
    );
  },
});

define("../../features/invitations/invitationModel", {
  findOne(filter) {
    const code = filter && filter.regiCode ? String(filter.regiCode) : null;
    return selectable(
      store.invitations.find(
        (invitation) => String(invitation.regiCode) === code
      ) || null
    );
  },
});

define("../../features/users/userModel", {
  findById(id) {
    return selectable(store.users[String(id)] || null);
  },
});

const resolver = require("./companyResolver");

test.beforeEach(reset);

// ---------------------------------------------------------------------------
// What counts as a link
// ---------------------------------------------------------------------------

test("creating a company links you to it", async () => {
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  assert.deepEqual(await resolver.companiesForUser(OWNER), [COMPANY_A]);
});

test("the invitation an account was created from links you to its company", async () => {
  store.users[INVITED] = { _id: INVITED, regiCode: "CODE-1" };
  store.invitations.push({ regiCode: "CODE-1", companyId: COMPANY_B });
  assert.deepEqual(await resolver.companiesForUser(INVITED), [COMPANY_B]);
});

test("ownership comes before the invitation", async () => {
  // The strongest link first, so a single-company answer is the owned one.
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  store.users[OWNER] = { _id: OWNER, regiCode: "CODE-1" };
  store.invitations.push({ regiCode: "CODE-1", companyId: COMPANY_B });
  assert.deepEqual(await resolver.companiesForUser(OWNER), [
    COMPANY_A,
    COMPANY_B,
  ]);
});

test("the same company through both links is not listed twice", async () => {
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  store.users[OWNER] = { _id: OWNER, regiCode: "CODE-1" };
  store.invitations.push({ regiCode: "CODE-1", companyId: COMPANY_A });
  assert.deepEqual(await resolver.companiesForUser(OWNER), [COMPANY_A]);
});

test("a user with no links has none", async () => {
  assert.deepEqual(await resolver.companiesForUser(STRANGER), []);
});

test("an invitation code that matches nothing is not a link", async () => {
  store.users[INVITED] = { _id: INVITED, regiCode: "GHOST" };
  assert.deepEqual(await resolver.companiesForUser(INVITED), []);
});

test("a blank invitation code is not a link", async () => {
  store.users[INVITED] = { _id: INVITED, regiCode: "   " };
  store.invitations.push({ regiCode: "", companyId: COMPANY_B });
  assert.deepEqual(await resolver.companiesForUser(INVITED), []);
});

test("an invitation naming a non-id company is ignored", async () => {
  store.users[INVITED] = { _id: INVITED, regiCode: "CODE-1" };
  store.invitations.push({ regiCode: "CODE-1", companyId: "not-an-id" });
  assert.deepEqual(await resolver.companiesForUser(INVITED), []);
});

test("a malformed user id resolves to nothing rather than throwing", async () => {
  assert.deepEqual(await resolver.companiesForUser("nonsense"), []);
  assert.deepEqual(await resolver.companiesForUser(null), []);
});

// ---------------------------------------------------------------------------
// Resolving one company for a request
// ---------------------------------------------------------------------------

test("a user in one company needs to claim nothing", async () => {
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  assert.equal(await resolver.resolveCompanyForUser(OWNER), COMPANY_A);
});

test("a user with no company is refused, never defaulted", async () => {
  // The constraint this exists for: no guessing. There is deliberately no
  // "first company in the collection" fallback.
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  await assert.rejects(
    () => resolver.resolveCompanyForUser(STRANGER),
    /not linked to a company/
  );
});

test("a claim for a company you belong to is honoured", async () => {
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  store.users[OWNER] = { _id: OWNER, regiCode: "CODE-1" };
  store.invitations.push({ regiCode: "CODE-1", companyId: COMPANY_B });

  assert.equal(
    await resolver.resolveCompanyForUser(OWNER, COMPANY_B),
    COMPANY_B
  );
});

test("a claim for somebody else's company is refused", async () => {
  // Not silently replaced with their own: the request is not one we
  // understand, and answering it anyway would hide the mistake.
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  await assert.rejects(
    () => resolver.resolveCompanyForUser(OWNER, COMPANY_B),
    /do not belong to that company/
  );
});

test("a claim can narrow but never widen", async () => {
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  await assert.rejects(
    () => resolver.resolveCompanyForUser(OWNER, "6a900000067c36176e40aa99"),
    /do not belong to that company/
  );
  assert.equal(await resolver.resolveCompanyForUser(OWNER), COMPANY_A);
});

test("a malformed claim falls back to the derived company, not to trust", async () => {
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  assert.equal(
    await resolver.resolveCompanyForUser(OWNER, "'; drop collection"),
    COMPANY_A
  );
});

test("membership can be checked directly", async () => {
  store.companies.push({ _id: COMPANY_A, createdBy: OWNER });
  assert.equal(await resolver.userBelongsToCompany(OWNER, COMPANY_A), true);
  assert.equal(await resolver.userBelongsToCompany(OWNER, COMPANY_B), false);
  assert.equal(await resolver.userBelongsToCompany(OWNER, "nonsense"), false);
  assert.equal(await resolver.userBelongsToCompany(OWNER, null), false);
});
