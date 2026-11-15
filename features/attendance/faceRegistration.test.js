const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

/**
 * These tests drive the service's decision-making without a database.
 *
 * The models, the notifier and the company resolver are replaced in the
 * require cache before the service is loaded, so what is exercised is the
 * lifecycle, the authority checks and the concurrency guards — the parts that
 * decide things — rather than mongoose.
 */

const COMPANY_A = "6a81bbf2067c36176e40aa1c";
const COMPANY_B = "6a834bff067c36176e40aa2d";
const APPLICANT = "6a4efa79067c36176e40aa1c";
const APPROVER = "6a4efa79067c36176e40aa2b";
const OUTSIDER = "6a4efa79067c36176e40aa3c";
const REQUEST_ID = "6a900000067c36176e40aa99";

/** The fake store the fake model reads and writes. */
const store = {
  registrations: [],
  users: {},
  companies: {},
  notifications: [],
  resolveCompany: null,
  belongs: null,
};

const reset = () => {
  store.registrations = [];
  store.users = {};
  store.companies = {};
  store.notifications = [];
  store.resolveCompany = async (userId, claimed) => claimed || COMPANY_A;
  store.belongs = async () => true;
};

const grant = (resourceType, resourceId, actions) => ({
  resourceType,
  resourceId,
  resourceName: "whatever",
  actions,
});

// ---------------------------------------------------------------------------
// Fakes, installed in the require cache before the service loads
// ---------------------------------------------------------------------------

const resolve = (id) => Module._resolveFilename(id, module);

const define = (id, exports) => {
  const path = resolve(id);
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
};

const clone = (doc) => JSON.parse(JSON.stringify(doc));

/** Just enough of a mongoose model for the service's queries. */
const fakeRegistrationModel = {
  async findOne(filter) {
    return (
      store.registrations.find(
        (doc) =>
          (!filter.userId || String(doc.userId) === String(filter.userId)) &&
          (!filter.companyId ||
            String(doc.companyId) === String(filter.companyId))
      ) || null
    );
  },

  async findById(id) {
    return (
      store.registrations.find((doc) => String(doc._id) === String(id)) || null
    );
  },

  async create(data) {
    const duplicate = store.registrations.find(
      (doc) =>
        String(doc.userId) === String(data.userId) &&
        String(doc.companyId) === String(data.companyId)
    );
    if (duplicate) {
      const error = new Error("duplicate key");
      error.code = 11000;
      throw error;
    }
    const doc = {
      _id: REQUEST_ID,
      history: [],
      attempts: 1,
      photo: null,
      modelVersion: null,
      decidedBy: null,
      decidedAt: null,
      rejectionReason: null,
      ...data,
    };
    store.registrations.push(doc);
    return doc;
  },

  async findOneAndUpdate(filter, update) {
    const doc = store.registrations.find(
      (candidate) =>
        String(candidate._id) === String(filter._id) &&
        (!filter.status || candidate.status === filter.status)
    );
    if (!doc) return null;
    Object.assign(doc, update.$set || {});
    if (update.$inc) {
      Object.entries(update.$inc).forEach(([key, by]) => {
        doc[key] = (doc[key] || 0) + by;
      });
    }
    if (update.$push) {
      Object.entries(update.$push).forEach(([key, value]) => {
        doc[key] = [...(doc[key] || []), value];
      });
    }
    return doc;
  },

  find() {
    const chain = {
      _docs: store.registrations.slice(),
      populate() {
        return chain;
      },
      skip() {
        return chain;
      },
      limit() {
        return chain;
      },
      sort() {
        return Promise.resolve(chain._docs);
      },
    };
    return chain;
  },

  async countDocuments(filter = {}) {
    return store.registrations.filter(
      (doc) =>
        (!filter.companyId ||
          String(doc.companyId) === String(filter.companyId)) &&
        (!filter.status || doc.status === filter.status)
    ).length;
  },
};
fakeRegistrationModel.FACE_REGISTRATION_STATUSES = [
  "pending",
  "approved",
  "rejected",
];

const selectable = (value) => ({
  select: async () => value,
  then: (resolve_) => resolve_(value),
});

const fakeUserModel = {
  findById(id) {
    return selectable(store.users[String(id)] || null);
  },
  find() {
    return selectable(Object.values(store.users));
  },
};

const fakeCompanyModel = {
  findById(id) {
    return selectable(store.companies[String(id)] || null);
  },
  find() {
    return selectable(Object.values(store.companies));
  },
};

define("./faceRegistrationModel", fakeRegistrationModel);
define("../users/userModel", fakeUserModel);
define("../companies/companyModel", fakeCompanyModel);
define("../../core/access/companyResolver", {
  resolveCompanyForUser: (...args) => store.resolveCompany(...args),
  userBelongsToCompany: (...args) => store.belongs(...args),
  companiesForUser: async () => [COMPANY_A],
});
define("../../core/notifications/permissionNotifier", {
  notifyEntitled: async (payload) => {
    store.notifications.push({ kind: "entitled", payload });
    return { recipients: [APPROVER], delivered: 1 };
  },
  notifyUser: async (payload) => {
    store.notifications.push({ kind: "user", payload });
    return { delivered: 1 };
  },
  approversFor: async () => [],
});

const service = require("./faceRegistrationService");

// ---------------------------------------------------------------------------

const withUser = (id, role, permissions = []) => {
  store.users[id] = { _id: id, fullName: `User ${id}`, role, permissions };
};

const withPendingRequest = (overrides = {}) => {
  const doc = {
    _id: REQUEST_ID,
    userId: APPLICANT,
    companyId: COMPANY_A,
    status: "pending",
    requestedAt: new Date(),
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    photo: null,
    attempts: 1,
    history: [],
    ...overrides,
  };
  store.registrations.push(doc);
  return doc;
};

test.beforeEach(reset);

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------

test("no record reads as notRegistered, not as registered", async () => {
  const status = await service.getMyStatus(APPLICANT);
  assert.equal(status.status, "notRegistered");
  assert.equal(status.companyId, COMPANY_A);
});

test("a request is created as pending and nothing else", async () => {
  withUser(APPLICANT, "junior");
  const result = await service.requestRegistration(APPLICANT, {});
  assert.equal(result.created, true);
  assert.equal(result.registration.status, "pending");
  assert.equal(result.registration.companyId, COMPANY_A);
});

test("a client cannot request itself into approved", async () => {
  withUser(APPLICANT, "junior");
  // Even when the body says so: the service writes the status, not the body.
  const result = await service.requestRegistration(APPLICANT, {
    status: "approved",
    approve: true,
  });
  assert.equal(result.registration.status, "pending");
});

test("a second request while pending is idempotent, not a duplicate", async () => {
  withUser(APPLICANT, "junior");
  await service.requestRegistration(APPLICANT, {});
  const again = await service.requestRegistration(APPLICANT, {});
  assert.equal(again.created, false);
  assert.equal(store.registrations.length, 1);
});

test("requesting again once approved is refused", async () => {
  withUser(APPLICANT, "junior");
  withPendingRequest({ status: "approved" });
  await assert.rejects(
    () => service.requestRegistration(APPLICANT, {}),
    /already approved/
  );
});

test("a rejection can be appealed, and the attempt count rises", async () => {
  withUser(APPLICANT, "junior");
  withPendingRequest({
    status: "rejected",
    rejectionReason: "Photo too dark",
    attempts: 1,
  });

  const result = await service.requestRegistration(APPLICANT, {});
  assert.equal(result.registration.status, "pending");
  assert.equal(result.registration.attempts, 2);
  assert.equal(result.registration.rejectionReason, null);
});

test("a duplicate insert race returns the winner's record", async () => {
  withUser(APPLICANT, "junior");
  // The unique index fires; the user's intent was satisfied either way.
  store.registrations.push({
    _id: REQUEST_ID,
    userId: APPLICANT,
    companyId: COMPANY_A,
    status: "pending",
    history: [],
    attempts: 1,
  });
  const original = fakeRegistrationModel.findOne;
  let firstCall = true;
  fakeRegistrationModel.findOne = async (filter) => {
    if (firstCall) {
      firstCall = false;
      return null; // the read that made us think we should create
    }
    return original.call(fakeRegistrationModel, filter);
  };

  try {
    const result = await service.requestRegistration(APPLICANT, {});
    assert.equal(result.created, false);
    assert.equal(result.registration.status, "pending");
  } finally {
    fakeRegistrationModel.findOne = original;
  }
});

// ---------------------------------------------------------------------------
// Who may decide
// ---------------------------------------------------------------------------

test("a grant on the company makes an approver", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  assert.equal(await service.canApproveForCompany(APPROVER, COMPANY_A), true);
});

test("a role on its own does not", async () => {
  // The constraint this exists for: seniority is not an entitlement.
  withUser(APPROVER, "admin");
  assert.equal(await service.canApproveForCompany(APPROVER, COMPANY_A), false);
});

test("a grant on another company does not", async () => {
  withUser(APPROVER, "admin", [grant("attendance", COMPANY_B, ["update"])]);
  assert.equal(await service.canApproveForCompany(APPROVER, COMPANY_A), false);
});

test("view access is not approval access", async () => {
  withUser(APPROVER, "manager", [grant("attendance", COMPANY_A, ["view"])]);
  assert.equal(await service.canApproveForCompany(APPROVER, COMPANY_A), false);
});

test("the company's creator may decide for it", async () => {
  withUser(APPROVER, "junior");
  store.companies[COMPANY_A] = { _id: COMPANY_A, createdBy: APPROVER };
  assert.equal(await service.canApproveForCompany(APPROVER, COMPANY_A), true);
});

test("master may decide", async () => {
  withUser(APPROVER, "master");
  assert.equal(await service.canApproveForCompany(APPROVER, COMPANY_A), true);
});

test("an unknown user may not decide", async () => {
  assert.equal(await service.canApproveForCompany(OUTSIDER, COMPANY_A), false);
  assert.equal(await service.canApproveForCompany(null, COMPANY_A), false);
});

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

test("an approver approves, and the record records who and when", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  withPendingRequest();

  const result = await service.decide(APPROVER, REQUEST_ID, { approve: true });
  assert.equal(result.registration.status, "approved");
  assert.equal(result.registration.decidedBy, APPROVER);
  assert.ok(result.registration.decidedAt);
});

test("a rejection needs a reason", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  withPendingRequest();

  await assert.rejects(
    () => service.decide(APPROVER, REQUEST_ID, { approve: false }),
    /needs a reason/
  );
});

test("a rejection keeps its reason", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  withPendingRequest();

  const result = await service.decide(APPROVER, REQUEST_ID, {
    approve: false,
    reason: "  Face not clearly visible  ",
  });
  assert.equal(result.registration.status, "rejected");
  assert.equal(result.registration.rejectionReason, "Face not clearly visible");
});

test("a decision must actually say which way", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  withPendingRequest();
  await assert.rejects(
    () => service.decide(APPROVER, REQUEST_ID, {}),
    /approve: true or false/
  );
});

test("somebody with no authority over the company is refused", async () => {
  withUser(OUTSIDER, "admin", [grant("attendance", COMPANY_B, ["update"])]);
  withPendingRequest();

  await assert.rejects(
    () => service.decide(OUTSIDER, REQUEST_ID, { approve: true }),
    /do not have permission/
  );
  assert.equal(store.registrations[0].status, "pending");
});

test("a request id from elsewhere does not become authority", async () => {
  // The record's own company decides who may act, not the caller's claim.
  withUser(OUTSIDER, "junior", [grant("attendance", COMPANY_B, ["update"])]);
  withPendingRequest({ companyId: COMPANY_B });
  store.registrations[0].companyId = COMPANY_A;

  await assert.rejects(
    () => service.decide(OUTSIDER, REQUEST_ID, { approve: true, companyId: COMPANY_B }),
    /do not have permission/
  );
});

test("nobody approves their own registration", async () => {
  withUser(APPLICANT, "master");
  withPendingRequest({ userId: APPLICANT });

  await assert.rejects(
    () => service.decide(APPLICANT, REQUEST_ID, { approve: true }),
    /cannot approve your own/
  );
});

test("a second decision on the same request is refused", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  withPendingRequest();

  await service.decide(APPROVER, REQUEST_ID, { approve: true });
  await assert.rejects(
    () => service.decide(APPROVER, REQUEST_ID, { approve: false, reason: "no" }),
    /already been approved/
  );
});

test("two approvers racing resolve to one decision", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  withUser(OUTSIDER, "master");
  withPendingRequest();

  const [first, second] = await Promise.allSettled([
    service.decide(APPROVER, REQUEST_ID, { approve: true }),
    service.decide(OUTSIDER, REQUEST_ID, { approve: false, reason: "nope" }),
  ]);

  const outcomes = [first, second];
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
  // And the record holds exactly one decision.
  assert.equal(store.registrations[0].history.length, 1);
});

test("a missing request is a 404, not a crash", async () => {
  withUser(APPROVER, "master");
  await assert.rejects(
    () => service.decide(APPROVER, REQUEST_ID, { approve: true }),
    /not found/
  );
  await assert.rejects(
    () => service.decide(APPROVER, "not-an-id", { approve: true }),
    /not found/
  );
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

test("a request notifies the entitled, and excludes the applicant", async () => {
  withUser(APPLICANT, "junior");
  const result = await service.requestRegistration(APPLICANT, {});
  assert.equal(result.notified.delivered, 1);

  const sent = store.notifications.at(-1);
  assert.equal(sent.kind, "entitled");
  assert.equal(sent.payload.resource, "attendance");
  assert.equal(sent.payload.action, "update");
  assert.deepEqual(sent.payload.excludeUserIds, [APPLICANT]);
});

test("withNotify false records the request and sends nothing", async () => {
  withUser(APPLICANT, "junior");
  const result = await service.requestRegistration(APPLICANT, {
    withNotify: false,
  });
  assert.equal(result.registration.status, "pending");
  assert.equal(result.notified, null);
  assert.equal(store.notifications.length, 0);
});

test("no biometric data reaches a notification payload", async () => {
  withUser(APPLICANT, "junior");
  await service.requestRegistration(APPLICANT, {
    photo: { id: "file-1", path: "/uploads/face.jpg" },
    modelVersion: "2.0",
  });

  const sent = store.notifications.at(-1);
  const serialized = JSON.stringify(sent.payload);
  for (const forbidden of ["embedding", "face.jpg", "/uploads", "photo"]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `payload must not carry ${forbidden}`
    );
  }
  // What it does carry is ids and a name.
  assert.equal(sent.payload.metadata.applicantId, APPLICANT);
  assert.equal(sent.payload.metadata.companyId, COMPANY_A);
});

test("a decision notifies the applicant", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  withPendingRequest();

  await service.decide(APPROVER, REQUEST_ID, { approve: true });
  const sent = store.notifications.at(-1);
  assert.equal(sent.kind, "user");
  assert.equal(sent.payload.userId, APPLICANT);
  assert.equal(sent.payload.type, "face_registration_approved");
});

test("a rejection tells the applicant why", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  withPendingRequest();

  await service.decide(APPROVER, REQUEST_ID, {
    approve: false,
    reason: "Photo too dark",
  });
  const sent = store.notifications.at(-1);
  assert.equal(sent.payload.type, "face_registration_rejected");
  assert.match(sent.payload.body, /Photo too dark/);
});

// ---------------------------------------------------------------------------
// The queue and the count
// ---------------------------------------------------------------------------

test("the pending count is zero for somebody who is not an approver", async () => {
  withUser(OUTSIDER, "admin");
  withPendingRequest();
  const result = await service.pendingCountForApprover(OUTSIDER);
  assert.deepEqual(result, { pending: 0, companyId: null });
});

test("the pending count is the approver's own company's", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  withPendingRequest();
  withPendingRequest({ _id: "other", userId: OUTSIDER, status: "approved" });

  const result = await service.pendingCountForApprover(APPROVER);
  assert.equal(result.pending, 1);
  assert.equal(result.companyId, COMPANY_A);
});

test("the count never raises for a user with no company", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  store.resolveCompany = async () => {
    const error = new Error("Your account is not linked to a company");
    error.statusCode = 400;
    throw error;
  };
  const result = await service.pendingCountForApprover(APPROVER);
  assert.deepEqual(result, { pending: 0, companyId: null });
});

test("the queue is refused to somebody with no authority", async () => {
  withUser(OUTSIDER, "admin");
  await assert.rejects(
    () => service.listForApprover(OUTSIDER, {}),
    /do not have permission/
  );
});

test("the queue refuses a company the approver does not belong to", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_B, ["update"])]);
  store.belongs = async () => false;
  await assert.rejects(
    () => service.listForApprover(APPROVER, { companyId: COMPANY_B }),
    /do not belong to that company/
  );
});

test("the queue carries a name for the reviewer but no embedding", async () => {
  withUser(APPROVER, "junior", [grant("attendance", COMPANY_A, ["update"])]);
  store.registrations.push({
    _id: REQUEST_ID,
    userId: { _id: APPLICANT, fullName: "Sam Patel", email: "sam@example.com" },
    companyId: COMPANY_A,
    status: "pending",
    history: [],
    attempts: 1,
    photo: { id: "file-1" },
  });

  const result = await service.listForApprover(APPROVER, {});
  const row = result.registrations[0];
  assert.equal(row.user.fullName, "Sam Patel");
  assert.equal("embedding" in row, false);
});

// ---------------------------------------------------------------------------
// The attendance gate
// ---------------------------------------------------------------------------

test("face attendance is allowed only once approved", async () => {
  const states = {
    notRegistered: false,
    pending: false,
    rejected: false,
    approved: true,
  };

  for (const [status, expected] of Object.entries(states)) {
    reset();
    if (status !== "notRegistered") withPendingRequest({ status });
    const result = await service.faceVerificationAllowed(APPLICANT, COMPANY_A);
    assert.equal(
      result.allowed,
      expected,
      `${status} should ${expected ? "" : "not "}allow face attendance`
    );
    assert.equal(result.status, status);
  }
});

test("an approval in one company does not carry to another", async () => {
  withPendingRequest({ status: "approved", companyId: COMPANY_A });
  const other = await service.faceVerificationAllowed(APPLICANT, COMPANY_B);
  assert.equal(other.allowed, false);
  assert.equal(other.status, "notRegistered");
});
