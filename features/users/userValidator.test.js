const test = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");

const { validateUserUpdate, validateUserCreate } = require("./userValidator");

/**
 * The update validator, run against what the client actually sends.
 *
 * The app edits a user by sending the whole user back, nulls included, so
 * "optional" has to mean "may be absent *or* empty" for the fields the schema
 * stores as null. It did not, and a save that changed only the permissions
 * was refused with "address must be a string".
 */
const runUpdate = async (body) => {
  const req = { body, cookies: {}, headers: {}, params: {}, query: {} };
  for (const chain of validateUserUpdate) {
    await chain.run(req);
  }
  return validationResult(req)
    .array()
    .map((error) => ({ path: error.path, msg: error.msg }));
};

const runCreate = async (body) => {
  const req = { body, cookies: {}, headers: {}, params: {}, query: {} };
  for (const chain of validateUserCreate) {
    await chain.run(req);
  }
  return validationResult(req)
    .array()
    .map((error) => ({ path: error.path, msg: error.msg }));
};

/** The payload the client sends when it saves a member's permissions. */
const wholeUserWithNulls = (overrides = {}) => ({
  id: "6a4efa79067c36176e40aa1c",
  fullName: "Abdelrahman Shaban",
  email: "someone@example.com",
  phone: "+201000000000",
  createdAt: "2026-07-09T01:33:45.995Z",
  type: "guest",
  status: "active",
  regiCode: null,
  isMale: true,
  birthday: "2026-07-09T01:33:45.984Z",
  address: null,
  token: null,
  refreshToken: null,
  role: "junior",
  employeeType: null,
  notionalId: null,
  relation: "self",
  jobs: [],
  rate: 0,
  bio: null,
  photo: "https://example.com/photo.png",
  files: [],
  permissions: [
    {
      resourceType: "company",
      resourceId: "*",
      resourceName: "All company",
      actions: ["fullAccess"],
    },
  ],
  devicesTokens: ["token-1"],
  isEmailVerified: true,
  ...overrides,
});

test("a whole user round-tripped with nulls is accepted", async () => {
  assert.deepEqual(await runUpdate(wholeUserWithNulls()), []);
});

test("each nullable field is accepted as null on its own", async () => {
  for (const field of ["address", "bio", "employeeType"]) {
    const errors = await runUpdate({ [field]: null });
    assert.deepEqual(errors, [], `${field}: null must be allowed`);
  }
});

test("a wrong value in those fields is still refused", async () => {
  // Nullable is not "unchecked": the wrong *kind* of value must still fail,
  // or the relaxation would have taken the validation with it.
  const errors = await runUpdate({
    address: 42,
    employeeType: "chief-of-vibes",
    bio: "x".repeat(501),
  });

  const paths = errors.map((error) => error.path).sort();
  assert.deepEqual(paths, ["address", "bio", "employeeType"]);
});

test("the other fields are validated as before", async () => {
  const errors = await runUpdate({
    role: "emperor",
    type: "ghost",
    status: "vanished",
    isMale: "yes",
    birthday: "not-a-date",
    jobs: "programmer",
    rate: "high",
  });

  const paths = errors.map((error) => error.path).sort();
  assert.deepEqual(paths, [
    "birthday",
    "isMale",
    "jobs",
    "rate",
    "role",
    "status",
    "type",
  ]);
});

test("creating a user still demands the required fields", async () => {
  const errors = await runCreate({});
  const paths = new Set(errors.map((error) => error.path));

  for (const required of [
    "id",
    "email",
    "fullName",
    "phone",
    "password",
    "type",
    "role",
    "birthday",
    "relation",
  ]) {
    assert.ok(paths.has(required), `${required} must still be required`);
  }
});
