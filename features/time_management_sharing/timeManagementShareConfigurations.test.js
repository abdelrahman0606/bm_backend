const { test, describe, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const http = require("http");
const dotenv = require("dotenv");
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

dotenv.config({ path: path.join(__dirname, "../../config.env") });

const sharingRoute = require("./timeManagementSharingRoute");
const publicRoute = require("./timeManagementPublicRoute");
const globalError = require("../../middlewares/errorMiddleware");
const service = require("./timeManagementSharingService");
const linkService = require("./timeManagementShareLinkService");
const TimeManagementShareModel = require("./timeManagementShareModel");
const TimeManagementUsageModel = require("./timeManagementUsageModel");
const TimeManagementSyncBatchModel = require("./timeManagementSyncBatchModel");
const TimeManagementShareDeliveryModel = require("./timeManagementShareDeliveryModel");
const TimeManagementShareLinkModel = require("./timeManagementShareLinkModel");
const UserModel = require("../users/userModel");
const CompanyModel = require("../companies/companyModel");
const InvitationModel = require("../invitations/invitationModel");
const NotificationModel = require("../notifications/notificationModel");
const {
  connectLocalTestDatabase,
  closeLocalTestDatabase,
  testDatabaseName,
} = require("./timeManagementTestDatabase");

/** Keeps this suite's local-MongoDB database separate from the other suites'. */
const SUITE_TAG = "configurations";

/**
 * Share Configuration management: the three directions (personal, outgoing,
 * incoming), listing with search and filters, company approval, and the
 * token-authorized read-only report links.
 */
describe("Share Configuration management", () => {
  // The Time Management models these routes use live on local MongoDB, not on
  // the Atlas connection the users and companies are created on, so both have
  // to be open or every guarded route answers 503 and the cleanup buffers out
  // — see timeManagementTestDatabase.js.
  let localDbReady = false;
  let server;
  let baseUrl;
  let publicBase;
  let owner; // creates configurations
  let peer; // target of person sharing
  let admin; // company administrator
  let stranger;
  let company; // owned by `admin`
  let invitation; // links `owner` to the company
  let tokens = {};
  const suffix = Date.now().toString();

  const tokenFor = (user) =>
    jwt.sign(
      { id: user._id.toString() },
      process.env.JWT_SECRET || "your-secret-key-change-in-production",
      { expiresIn: "1h" }
    );

  const call = async (method, pathname, { token, body, root } = {}) => {
    const response = await fetch(`${root || baseUrl}${pathname}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    return { status: response.status, body: payload, text };
  };

  before(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }

    localDbReady = await connectLocalTestDatabase(SUITE_TAG);
    if (!localDbReady) return;

    const makeUser = (name, phone, role, regiCode) =>
      UserModel.create({
        fullName: `${name} ${suffix}`,
        email: `${name.toLowerCase()}_cfg_${suffix}@example.com`,
        phone,
        type: "business",
        role,
        relation: "internal",
        birthday: new Date("1990-01-01"),
        password: "password123",
        ...(regiCode ? { regiCode } : {}),
      });

    // `owner` is an ordinary employee: no managing role, but a member of the
    // company through the registration code they signed up with.
    const memberCode = `CFG${suffix}`;
    owner = await makeUser("CfgOwner", "0100000031", "senior", memberCode);
    peer = await makeUser("CfgPeer", "0100000032", "manager");
    admin = await makeUser("CfgAdmin", "0100000033", "admin");
    stranger = await makeUser("CfgStranger", "0100000034", "junior");

    company = await CompanyModel.create({
      title: `Cfg Company ${suffix}`,
      createdBy: admin._id.toString(),
      isPrimary: true,
      index: 1,
    });

    invitation = await InvitationModel.create({
      companyId: company._id.toString(),
      type: "employee",
      status: "accepted",
      regiCode: memberCode,
      role: "senior",
      employeeType: "internalEmployee",
      expiredAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    tokens = {
      owner: tokenFor(owner),
      peer: tokenFor(peer),
      admin: tokenFor(admin),
      stranger: tokenFor(stranger),
    };

    const app = express();
    app.use(express.json());
    app.use("/api/v1/time-management-shares", sharingRoute);
    app.use("/api/v1/public/time-reports", publicRoute);
    app.use(globalError);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}/api/v1/time-management-shares`;
    publicBase = `http://127.0.0.1:${port}/api/v1/public/time-reports`;
  });

  beforeEach((t) => {
    if (!localDbReady) {
      t.skip(
        `local MongoDB (${testDatabaseName(SUITE_TAG)}) is not running; start scripts/start-local-mongod.cmd`,
      );
    }
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));

    // With no local database there is nothing to clean up, and the test users
    // were never created either.
    if (!localDbReady) {
      await closeLocalTestDatabase();
      await mongoose.disconnect();
      return;
    }

    const ids = [owner._id, peer._id, admin._id, stranger._id];
    const either = {
      $or: [{ senderUserId: { $in: ids } }, { recipientUserId: { $in: ids } }],
    };
    await TimeManagementShareLinkModel.deleteMany({
      ownerUserId: { $in: ids },
    });
    await TimeManagementShareDeliveryModel.deleteMany(either);
    await TimeManagementUsageModel.deleteMany(either);
    await TimeManagementSyncBatchModel.deleteMany(either);
    await TimeManagementShareModel.deleteMany(either);
    await NotificationModel.deleteMany({ userId: { $in: ids } });
    if (invitation) await InvitationModel.deleteOne({ _id: invitation._id });
    if (company) await CompanyModel.deleteOne({ _id: company._id });
    await UserModel.deleteMany({ _id: { $in: ids } });

    await closeLocalTestDatabase();
    await mongoose.disconnect();
  });

  const today = () => new Date().toISOString().split("T")[0];

  // -------------------------------------------------------------------------

  test("1. Personal configurations are saved without a target and never go automatic", async () => {
    const created = await call("POST", "/", {
      token: tokens.owner,
      body: {
        shareScope: "personal",
        filterId: `cfg-personal-${suffix}`,
        filterName: "My own focus time",
        filterDefinition: { schemaVersion: 1, selectedApps: [] },
      },
    });

    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.data.shareScope, "personal");
    assert.strictEqual(created.body.data.status, "accepted");
    assert.strictEqual(created.body.data.shareMode, "manual");

    // Automatic sharing is meaningless with no recipient and is refused.
    const automatic = await call("POST", "/", {
      token: tokens.owner,
      body: {
        shareScope: "personal",
        filterId: `cfg-personal-auto-${suffix}`,
        filterName: "Personal automatic",
        filterDefinition: { schemaVersion: 1 },
        shareMode: "automatic",
        schedule: { type: "daily", hour: 9, minute: 0 },
      },
    });
    assert.strictEqual(automatic.status, 400);
    assert.match(
      automatic.body.message,
      /not available for a personal configuration/i
    );

    const shareId = created.body.data.id;
    const switched = await call("PATCH", `/${shareId}/schedule`, {
      token: tokens.owner,
      body: {
        shareMode: "automatic",
        schedule: { type: "daily", hour: 9, minute: 0 },
      },
    });
    assert.strictEqual(switched.status, 400);
  });

  test("2. A company configuration waits for the company administrator", async () => {
    const filterId = `cfg-company-${suffix}`;
    const created = await call("POST", "/", {
      token: tokens.owner,
      body: {
        shareScope: "company",
        companyId: company._id.toString(),
        filterId,
        filterName: "Company report",
        filterDefinition: { schemaVersion: 1 },
      },
    });

    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.data.status, "pending");
    assert.strictEqual(
      created.body.data.recipientUserId.id || created.body.data.recipientUserId,
      admin._id.toString(),
      "the administrator is the approver"
    );

    const shareId = created.body.data.id;

    // No delivery before the administrator approves.
    const early = await call("POST", `/${shareId}/share-now`, {
      token: tokens.owner,
      body: {},
    });
    assert.strictEqual(early.status, 403);

    // The administrator sees it as an incoming request and approves it.
    const incoming = await call("GET", "/?direction=incoming", {
      token: tokens.admin,
    });
    assert.strictEqual(incoming.status, 200);
    assert.ok(incoming.body.data.some((s) => s.id === shareId));

    const accepted = await call("PATCH", `/${shareId}/accept`, {
      token: tokens.admin,
    });
    assert.strictEqual(accepted.status, 200);
    assert.strictEqual(accepted.body.data.status, "accepted");

    // A user with no relationship to the company cannot share with it.
    const outsider = await call("POST", "/", {
      token: tokens.stranger,
      body: {
        shareScope: "company",
        companyId: company._id.toString(),
        filterId: `cfg-company-outsider-${suffix}`,
        filterName: "Outsider",
        filterDefinition: { schemaVersion: 1 },
      },
    });
    assert.strictEqual(outsider.status, 403);

    // The administrator sharing with their own company needs no approval.
    const ownCompany = await call("POST", "/", {
      token: tokens.admin,
      body: {
        shareScope: "company",
        companyId: company._id.toString(),
        filterId: `cfg-company-own-${suffix}`,
        filterName: "Admin own company report",
        filterDefinition: { schemaVersion: 1 },
      },
    });
    assert.strictEqual(ownCompany.status, 201);
    assert.strictEqual(ownCompany.body.data.status, "accepted");
  });

  test("3. Listing separates personal, outgoing and incoming", async () => {
    // owner -> peer (outgoing for owner, incoming for peer)
    const outgoing = await call("POST", "/", {
      token: tokens.owner,
      body: {
        shareScope: "person",
        recipientUserId: peer._id.toString(),
        filterId: `cfg-outgoing-${suffix}`,
        filterName: "Daily report for peer",
        filterDefinition: { schemaVersion: 1 },
      },
    });
    assert.strictEqual(outgoing.status, 201);

    const personal = await call("GET", "/?direction=personal", {
      token: tokens.owner,
    });
    assert.strictEqual(personal.status, 200);
    assert.ok(personal.body.data.length >= 1);
    assert.ok(
      personal.body.data.every((s) => s.shareScope === "personal"),
      "personal direction returns only personal configurations"
    );

    const sent = await call("GET", "/?direction=outgoing", {
      token: tokens.owner,
    });
    assert.ok(
      sent.body.data.every((s) => s.shareScope !== "personal"),
      "outgoing never contains personal configurations"
    );
    assert.ok(sent.body.data.some((s) => s.id === outgoing.body.data.id));

    const received = await call("GET", "/?direction=incoming", {
      token: tokens.peer,
    });
    assert.ok(received.body.data.some((s) => s.id === outgoing.body.data.id));
    assert.ok(
      received.body.data.every(
        (s) => (s.senderUserId.id || s.senderUserId) !== peer._id.toString()
      ),
      "incoming never contains what the user sent"
    );

    // A stranger sees none of it.
    const strangerList = await call("GET", "/", { token: tokens.stranger });
    assert.strictEqual(strangerList.status, 200);
    assert.ok(
      !strangerList.body.data.some((s) => s.id === outgoing.body.data.id)
    );
  });

  test("4. Listing carries human-readable identities and pagination", async () => {
    const list = await call("GET", "/?direction=outgoing&limit=1&page=1", {
      token: tokens.owner,
    });

    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.data.length, 1);
    assert.strictEqual(list.body.pagination.limit, 1);
    assert.ok(list.body.pagination.total >= 2);
    assert.ok(list.body.pagination.pages >= 2);

    const second = await call("GET", "/?direction=outgoing&limit=1&page=2", {
      token: tokens.owner,
    });
    assert.notStrictEqual(second.body.data[0].id, list.body.data[0].id);

    // The recipient is populated with a name and an email, not just an id.
    const person = await call("GET", "/?direction=outgoing&shareScope=person", {
      token: tokens.owner,
    });
    const entry = person.body.data[0];
    assert.ok(entry.recipientUserId.fullName, "recipient has a display name");
    assert.ok(entry.recipientUserId.email, "recipient has an email");
  });

  test("5. Search matches the configuration name and the recipient", async () => {
    const byName = await call(
      `GET`,
      `/?search=${encodeURIComponent("Daily report for peer")}`,
      { token: tokens.owner }
    );
    assert.strictEqual(byName.status, 200);
    assert.ok(byName.body.data.some((s) => s.filterName === "Daily report for peer"));

    const byRecipient = await call(
      "GET",
      `/?direction=outgoing&search=${encodeURIComponent(peer.fullName)}`,
      { token: tokens.owner }
    );
    assert.ok(
      byRecipient.body.data.length >= 1,
      "a recipient name finds the configuration"
    );
    assert.ok(
      byRecipient.body.data.every(
        (s) => (s.recipientUserId.id || s.recipientUserId) === peer._id.toString()
      )
    );

    const noMatch = await call("GET", "/?search=zzz-nothing-matches-zzz", {
      token: tokens.owner,
    });
    assert.strictEqual(noMatch.body.data.length, 0);
    assert.strictEqual(noMatch.body.pagination.total, 0);

    // A regex metacharacter must be treated as text, not as a pattern.
    const metacharacter = await call("GET", "/?search=.*", {
      token: tokens.owner,
    });
    assert.strictEqual(metacharacter.status, 200);
    assert.strictEqual(metacharacter.body.data.length, 0);
  });

  test("6. A report link opens the report and hides internal identifiers", async () => {
    const filterId = `cfg-link-${suffix}`;
    const created = await call("POST", "/", {
      token: tokens.owner,
      body: {
        shareScope: "personal",
        filterId,
        filterName: "Shared snapshot",
        filterDefinition: { schemaVersion: 1 },
      },
    });
    const shareId = created.body.data.id;

    await call("POST", "/sync", {
      token: tokens.owner,
      body: {
        batchId: `cfg-link-batch-${suffix}`,
        filterId,
        recipientId: owner._id.toString(),
        date: today(),
        syncType: "absolute",
        totalDuration: 7200000,
        apps: [
          {
            appName: "Code.exe",
            totalDuration: 7200000,
            windows: [{ title: "secret_project.dart", durationMs: 7200000 }],
          },
        ],
      },
    });

    const link = await call("POST", `/${shareId}/links`, {
      token: tokens.owner,
      body: { dateFrom: today(), dateTo: today(), expiresInDays: 2 },
    });

    assert.strictEqual(link.status, 201);
    const url = link.body.data.url;
    assert.ok(url, "a URL is returned");
    assert.ok(
      !url.includes(shareId) && !url.includes(owner._id.toString()),
      "the URL carries a token, not database ids"
    );
    assert.strictEqual(
      link.body.data.tokenHash,
      undefined,
      "the stored hash is never returned"
    );

    const token = url.split("/").pop();
    assert.ok(token.length >= 40, "high-entropy token");

    // Anonymous read works and renders the report.
    const page = await fetch(`${publicBase}/${token}`);
    assert.strictEqual(page.status, 200);
    const html = await page.text();
    assert.match(html, /Shared snapshot/);
    assert.match(html, /Code\.exe/);
    assert.match(html, /2h 0m/, "the total is rendered as a duration");
    assert.ok(
      !html.includes(shareId) && !html.includes(owner._id.toString()),
      "the page exposes no database ids"
    );
    assert.ok(
      !html.includes("secret_project.dart"),
      "window titles stay private unless the owner opted in"
    );

    const data = await call("GET", `/${token}/data`, { root: publicBase });
    assert.strictEqual(data.status, 200);
    assert.strictEqual(data.body.data.totalDuration, 7200000);
    assert.strictEqual(data.body.data.byApp[0].appName, "Code.exe");
    assert.strictEqual(data.body.data.byApp[0].windows.length, 0);

    // An unknown token is indistinguishable from a revoked one.
    const unknown = await fetch(`${publicBase}/${"a".repeat(43)}`);
    assert.strictEqual(unknown.status, 404);
    assert.match(await unknown.text(), /not available/i);
  });

  test("7. Window titles are included only when the owner opts in", async () => {
    const filterId = `cfg-link-win-${suffix}`;
    const created = await call("POST", "/", {
      token: tokens.owner,
      body: {
        shareScope: "personal",
        filterId,
        filterName: "Detailed snapshot",
        filterDefinition: { schemaVersion: 1 },
      },
    });
    const shareId = created.body.data.id;

    await call("POST", "/sync", {
      token: tokens.owner,
      body: {
        batchId: `cfg-link-win-batch-${suffix}`,
        filterId,
        recipientId: owner._id.toString(),
        date: today(),
        syncType: "absolute",
        totalDuration: 600000,
        apps: [
          {
            appName: "Chrome.exe",
            totalDuration: 600000,
            windows: [{ title: "Release checklist", durationMs: 600000 }],
          },
        ],
      },
    });

    const link = await call("POST", `/${shareId}/links`, {
      token: tokens.owner,
      body: { dateFrom: today(), dateTo: today(), includeWindows: true },
    });
    const token = link.body.data.url.split("/").pop();

    const data = await call("GET", `/${token}/data`, { root: publicBase });
    assert.strictEqual(data.body.data.includesWindows, true);
    assert.strictEqual(
      data.body.data.byApp[0].windows[0].title,
      "Release checklist"
    );
  });

  test("8. Links are owner-only, revocable and expiring", async () => {
    const filterId = `cfg-link-auth-${suffix}`;
    const created = await call("POST", "/", {
      token: tokens.owner,
      body: {
        shareScope: "person",
        recipientUserId: peer._id.toString(),
        filterId,
        filterName: "Link authorization",
        filterDefinition: { schemaVersion: 1 },
      },
    });
    const shareId = created.body.data.id;

    // The recipient of a configuration is not the owner of the data.
    const peerAttempt = await call("POST", `/${shareId}/links`, {
      token: tokens.peer,
      body: {},
    });
    assert.strictEqual(peerAttempt.status, 403);

    const strangerAttempt = await call("POST", `/${shareId}/links`, {
      token: tokens.stranger,
      body: {},
    });
    assert.strictEqual(strangerAttempt.status, 403);

    const link = await call("POST", `/${shareId}/links`, {
      token: tokens.owner,
      body: { dateFrom: today(), dateTo: today() },
    });
    assert.strictEqual(link.status, 201);
    const token = link.body.data.url.split("/").pop();
    const linkId = link.body.data.id;

    assert.strictEqual((await fetch(`${publicBase}/${token}`)).status, 200);

    const listed = await call("GET", `/${shareId}/links`, {
      token: tokens.owner,
    });
    assert.strictEqual(listed.status, 200);
    assert.ok(listed.body.data.some((l) => l.id === linkId));
    assert.strictEqual(listed.body.data[0].tokenHash, undefined);

    // A stranger cannot revoke somebody else's link.
    const wrongRevoke = await call("PATCH", `/links/${linkId}/revoke`, {
      token: tokens.stranger,
    });
    assert.strictEqual(wrongRevoke.status, 403);

    const revoked = await call("PATCH", `/links/${linkId}/revoke`, {
      token: tokens.owner,
    });
    assert.strictEqual(revoked.status, 200);
    assert.ok(revoked.body.data.revokedAt);

    assert.strictEqual(
      (await fetch(`${publicBase}/${token}`)).status,
      404,
      "a revoked link stops serving the report"
    );

    // An expired link is refused as well.
    const expiring = await linkService.createReportLink(owner._id, shareId, {
      dateFrom: today(),
      dateTo: today(),
      expiresInDays: 1,
    });
    await TimeManagementShareLinkModel.updateOne(
      { _id: expiring.link._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    assert.strictEqual(
      (await fetch(`${publicBase}/${expiring.token}`)).status,
      404
    );

    // Validation of the link payload.
    const badExpiry = await call("POST", `/${shareId}/links`, {
      token: tokens.owner,
      body: { expiresInDays: 500 },
    });
    assert.strictEqual(badExpiry.status, 400);
  });

  test("9. The token is stored only as a hash", async () => {
    const filterId = `cfg-link-hash-${suffix}`;
    const share = await service.createShare(owner._id, {
      shareScope: "personal",
      filterId,
      filterName: "Hash check",
      filterDefinition: { schemaVersion: 1 },
    });

    const created = await linkService.createReportLink(owner._id, share._id, {
      dateFrom: today(),
      dateTo: today(),
    });

    const stored = await TimeManagementShareLinkModel.findById(
      created.link._id
    ).lean();

    assert.ok(stored.tokenHash);
    assert.notStrictEqual(stored.tokenHash, created.token);
    assert.strictEqual(
      stored.tokenHash,
      linkService.hashTokenForTest(created.token)
    );
  });
});
