const { test, describe } = require("node:test");
const assert = require("node:assert");

const policySigner = require("./policySigner");
const policyService = require("./devicePolicyService");
const EnforcementReport = require("./enforcementReportModel");
const { CONTROL_KEYS } = require("./deviceControlConstants");

/**
 * Device Control: the properties the feature's safety rests on.
 *
 * Every case here is pure — no database, no network — so they run on any
 * machine and in CI. They cover the four claims that would be most expensive
 * to get wrong: a policy cannot be forged or moved between devices, an
 * exception cannot widen a control it does not name, a report is only
 * "applied" when every control applied, and a pinned policy beats a
 * company-wide one however the priorities are set.
 */

const samplePolicy = () => ({
  applicationControl: {
    enabled: true,
    mode: "blacklist",
    rules: [
      { kind: "path", value: "steam.exe" },
      { kind: "path", value: "discord.exe" },
    ],
  },
  websiteControl: {
    enabled: true,
    mode: "blacklist",
    disableSecureDns: true,
    rules: [
      { domain: "facebook.com", includeSubdomains: true },
      { domain: "youtube.com", includeSubdomains: true },
    ],
  },
  fileTransferControl: {
    enabled: true,
    blockDownloads: true,
    blockUploads: true,
    domains: [],
  },
  usbControl: {
    enabled: true,
    blockStorage: true,
    denyRead: true,
    denyWrite: true,
    approvedDeviceIds: [],
  },
  systemRestrictions: {
    enabled: true,
    blockInstallers: true,
    blockAdminTools: true,
    restrictedPaths: ["C:/Windows/System32"],
  },
});

describe("policy signing", () => {
  test("a signed policy verifies", () => {
    const envelope = policySigner.sign({ deviceId: "d1", effectiveVersion: 10 });
    assert.equal(policySigner.verify(envelope), true);
  });

  test("key order does not change the signature input", () => {
    const a = policySigner.canonicalize({ b: 1, a: { d: 2, c: 3 } });
    const b = policySigner.canonicalize({ a: { c: 3, d: 2 }, b: 1 });
    assert.equal(a, b);
  });

  test("a tampered payload fails verification", () => {
    const envelope = policySigner.sign({ deviceId: "d1", effectiveVersion: 10 });
    envelope.payload.effectiveVersion = 11;
    assert.equal(policySigner.verify(envelope), false);
  });

  test("a policy signed for one device does not verify for another", () => {
    // The device id is inside the signed payload, so an agent cannot be fed
    // a weaker policy that was issued to a different machine.
    const envelope = policySigner.sign({ deviceId: "device-a", effectiveVersion: 10 });
    envelope.payload.deviceId = "device-b";
    assert.equal(policySigner.verify(envelope), false);
  });

  test("a missing or malformed envelope verifies as false, never throws", () => {
    assert.equal(policySigner.verify(null), false);
    assert.equal(policySigner.verify({}), false);
    assert.equal(policySigner.verify({ payload: {}, signature: "not-base64!!" }), false);
  });
});

describe("exceptions widen one control and no other", () => {
  test("a website exception removes one domain and touches nothing else", () => {
    const sections = policyService.sectionsOf(samplePolicy());
    const before = JSON.stringify({
      app: sections.applicationControl,
      usb: sections.usbControl,
      files: sections.fileTransferControl,
      system: sections.systemRestrictions,
    });

    policyService.applyException(sections, {
      category: "website",
      resource: "youtube.com",
    });

    assert.deepEqual(
      sections.websiteControl.rules.map((rule) => rule.domain),
      ["facebook.com"]
    );
    const after = JSON.stringify({
      app: sections.applicationControl,
      usb: sections.usbControl,
      files: sections.fileTransferControl,
      system: sections.systemRestrictions,
    });
    assert.equal(after, before, "a website exception changed another control");
  });

  test("a blanket USB exception does not unblock downloads", () => {
    const sections = policyService.sectionsOf(samplePolicy());
    policyService.applyException(sections, {
      category: "usb",
      resource: policyService.ALL_RESOURCES,
    });

    assert.equal(sections.usbControl.blockStorage, false);
    assert.equal(sections.fileTransferControl.blockDownloads, true);
    assert.equal(sections.fileTransferControl.blockUploads, true);
  });

  test("an application exception in whitelist mode adds, in blacklist mode removes", () => {
    const whitelisted = policyService.sectionsOf(samplePolicy());
    whitelisted.applicationControl.mode = "whitelist";
    policyService.applyException(whitelisted, {
      category: "application",
      resource: "zoom.exe",
    });
    assert.ok(
      whitelisted.applicationControl.rules.some((rule) => rule.value === "zoom.exe")
    );

    const blacklisted = policyService.sectionsOf(samplePolicy());
    policyService.applyException(blacklisted, {
      category: "application",
      resource: "steam.exe",
    });
    assert.ok(
      !blacklisted.applicationControl.rules.some((rule) => rule.value === "steam.exe")
    );
  });

  test("an unknown category widens nothing", () => {
    const sections = policyService.sectionsOf(samplePolicy());
    const before = JSON.stringify(sections);
    policyService.applyException(sections, { category: "nonsense", resource: "x" });
    assert.equal(JSON.stringify(sections), before);
  });

  test("an empty resource widens nothing", () => {
    const sections = policyService.sectionsOf(samplePolicy());
    const before = JSON.stringify(sections);
    policyService.applyException(sections, { category: "website", resource: "   " });
    assert.equal(JSON.stringify(sections), before);
  });
});

describe("enforcement status is pessimistic", () => {
  const reportWith = (statuses) =>
    new EnforcementReport({
      companyId: "c1",
      deviceId: "d1",
      policyVersion: 1,
      controls: statuses.map((status, index) => ({
        key: CONTROL_KEYS[index],
        status,
      })),
    });

  test("every control applied is applied", () => {
    assert.equal(reportWith(["applied", "applied"]).overallStatus(), "applied");
  });

  test("any failure makes the whole report failed", () => {
    assert.equal(reportWith(["applied", "failed"]).overallStatus(), "failed");
  });

  test("applied beside unsupported is partial, never applied", () => {
    // The console must not show green for a machine that could not enforce
    // half the policy.
    assert.equal(reportWith(["applied", "unsupported"]).overallStatus(), "partial");
  });

  test("all unsupported is unsupported, not applied", () => {
    assert.equal(reportWith(["unsupported", "unsupported"]).overallStatus(), "unsupported");
  });

  test("a report with no controls is pending", () => {
    assert.equal(reportWith([]).overallStatus(), "pending");
  });
});

describe("assignment precedence", () => {
  const assignment = (scope, priority, createdAt) => ({
    scope,
    priority,
    createdAt: new Date(createdAt),
  });

  test("a device assignment beats an employee and a company one", () => {
    const sorted = [
      assignment("company", 900, "2026-01-03"),
      assignment("employee", 500, "2026-01-02"),
      assignment("device", 0, "2026-01-01"),
    ].sort(policyService.compareAssignments);

    // Priority must not let a company-wide policy outrank a pinned one:
    // pinning a policy to one machine is the most specific thing an
    // administrator can say, and it has to win.
    assert.equal(sorted[0].scope, "device");
  });

  test("inside one scope, higher priority wins", () => {
    const sorted = [
      assignment("employee", 1, "2026-01-01"),
      assignment("employee", 7, "2026-01-01"),
    ].sort(policyService.compareAssignments);
    assert.equal(sorted[0].priority, 7);
  });

  test("equal scope and priority falls back to the newest", () => {
    const sorted = [
      assignment("device", 0, "2026-01-01"),
      assignment("device", 0, "2026-06-01"),
    ].sort(policyService.compareAssignments);
    assert.equal(sorted[0].createdAt.toISOString().slice(0, 7), "2026-06");
  });
});
