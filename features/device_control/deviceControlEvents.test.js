const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");

const {
  createEventDispatcher,
  setEventDispatcher,
} = require("../../core/events/eventDispatcher");
const permissionNotifier = require("../../core/notifications/permissionNotifier");
const events = require("./deviceControlEvents");

/**
 * Device Control's live feed: the properties that keep it cheap and quiet.
 *
 * Pure cases — no database, no socket. The dispatcher is replaced with a
 * recorder and `approversFor` with a stub, which is enough to assert the four
 * things that would be expensive to get wrong:
 *
 *  1. an event never carries a secret;
 *  2. an ordinary heartbeat costs nothing;
 *  3. a clean enforcement report does not wake the administrators;
 *  4. a transport failure cannot fail the operation that published.
 */

/** A gateway that writes down what it was asked to send. */
const recorder = () => {
  const sent = [];
  return {
    sent,
    gateway: {
      publish: (event) => sent.push({ to: null, event }),
      broadcast: (event) => sent.push({ to: null, event }),
      sendToUser: (userId, event) => sent.push({ to: String(userId), event }),
      sendToRoom: (roomId, event) => sent.push({ to: String(roomId), event }),
    },
  };
};

const COMPANY = "507f1f77bcf86cd799439011";
const OWNER = "507f1f77bcf86cd799439022";
const ADMIN = "507f1f77bcf86cd799439033";
const DEVICE = "507f1f77bcf86cd799439044";

const deviceDoc = (overrides = {}) => ({
  _id: DEVICE,
  companyId: COMPANY,
  employeeId: OWNER,
  name: "Sales laptop",
  platform: "windows",
  status: "active",
  // Present on a real document and must never reach a payload.
  secretHash: "$2a$10$notarealhash",
  ...overrides,
});

let sink;
let approversCalls;
const realApproversFor = permissionNotifier.approversFor;

beforeEach(() => {
  sink = recorder();
  setEventDispatcher(createEventDispatcher(sink.gateway));

  approversCalls = [];
  permissionNotifier.approversFor = async (args) => {
    approversCalls.push(args);
    return [{ _id: ADMIN, fullName: "An administrator", role: "admin" }];
  };
});

const restore = () => {
  permissionNotifier.approversFor = realApproversFor;
};

describe("payloads", () => {
  test("an event carries ids and statuses, never a secret", async () => {
    await events.deviceEnrolled(deviceDoc());
    restore();

    assert.ok(sink.sent.length > 0, "the event was not published");

    const serialized = JSON.stringify(sink.sent);
    assert.ok(
      !serialized.includes("notarealhash"),
      "a device secret hash reached the payload"
    );
    assert.ok(!/secretHash/.test(serialized), "secretHash reached the payload");
    assert.ok(
      !/deviceSecret|policyPublicKey|tokenHash/.test(serialized),
      "a credential field reached the payload"
    );

    const { event } = sink.sent[0];
    assert.equal(event.type, "device-control");
    assert.equal(event.action, "device.enrolled");
    assert.equal(event.payload.deviceId, DEVICE);
    assert.equal(event.payload.companyId, COMPANY);
  });

  test("the envelope has what the client parses", async () => {
    await events.deviceEnrolled(deviceDoc());
    restore();

    const { event } = sink.sent[0];
    for (const field of ["id", "type", "action", "version", "createdAt"]) {
      assert.ok(event[field], `the envelope is missing ${field}`);
    }
    // The client does `DateTime.parse` on this and drops the frame otherwise.
    assert.ok(!Number.isNaN(Date.parse(event.createdAt)));
  });

  test("the owner and the entitled administrators both receive it", async () => {
    await events.deviceEnrolled(deviceDoc());
    restore();

    const recipients = sink.sent.map((entry) => entry.to).sort();
    assert.deepEqual(recipients, [OWNER, ADMIN].sort());
  });

  test("policy events ask for the devicePolicy grant, device events for device", async () => {
    await events.policyChanged({
      companyId: COMPANY,
      policy: { _id: "p1", name: "Standard", version: 3 },
      action: events.EVENT_ACTIONS.POLICY_UPDATED,
      actorId: ADMIN,
    });
    await events.deviceStatusChanged({
      device: deviceDoc({ status: "blocked" }),
      actorId: ADMIN,
    });
    restore();

    assert.deepEqual(
      approversCalls.map((call) => call.resource),
      ["devicePolicy", "device"]
    );
  });
});

describe("a device coming back online", () => {
  test("an ordinary heartbeat publishes nothing and costs no lookup", async () => {
    const sent = await events.deviceCameOnline({
      device: deviceDoc(),
      previousLastSeenAt: new Date(Date.now() - 60 * 1000),
      now: new Date(),
    });
    restore();

    assert.equal(sent, 0);
    assert.equal(sink.sent.length, 0);
    assert.equal(
      approversCalls.length,
      0,
      "a heartbeat inside the window queried for recipients"
    );
  });

  test("a device that was silent past the window is news", async () => {
    const now = new Date();
    await events.deviceCameOnline({
      device: deviceDoc(),
      previousLastSeenAt: new Date(
        now.getTime() - events.ONLINE_AFTER_SILENCE_MS - 1000
      ),
      now,
    });
    restore();

    assert.ok(sink.sent.length > 0);
    assert.equal(sink.sent[0].event.action, "device.online");
    assert.ok(sink.sent[0].event.payload.silentForMinutes >= 30);
  });

  test("a device that has never reported is news", async () => {
    await events.deviceCameOnline({
      device: deviceDoc(),
      previousLastSeenAt: null,
      now: new Date(),
    });
    restore();

    assert.ok(sink.sent.length > 0);
    assert.equal(sink.sent[0].event.payload.silentForMinutes, null);
  });
});

describe("enforcement reports", () => {
  const report = (controls, policyVersion = 7) => ({
    _id: "r1",
    policyId: "p1",
    policyVersion,
    controls,
  });

  test("a clean report goes to the owner and does not wake administrators", async () => {
    await events.enforcementReported({
      device: deviceDoc(),
      report: report([
        { key: "usbControl", status: "applied" },
        { key: "websiteControl", status: "applied" },
      ]),
      overall: "applied",
    });
    restore();

    assert.equal(sink.sent.length, 1);
    assert.equal(sink.sent[0].to, OWNER);
    assert.equal(sink.sent[0].event.action, "enforcement.reported");
    assert.equal(
      approversCalls.length,
      0,
      "a successful report queried for administrators"
    );
  });

  test("a failed control reaches the administrators and names what failed", async () => {
    await events.enforcementReported({
      device: deviceDoc(),
      report: report([
        { key: "usbControl", status: "applied" },
        { key: "applicationControl", status: "failed", message: "AppLocker unavailable" },
      ]),
      overall: "failed",
    });
    restore();

    const recipients = sink.sent.map((entry) => entry.to).sort();
    assert.deepEqual(recipients, [OWNER, ADMIN].sort());

    const { event } = sink.sent[0];
    assert.equal(event.action, "enforcement.failed");
    assert.deepEqual(event.payload.failedControls, ["applicationControl"]);
  });

  test("unsupported is reported as itself, not as a failure", async () => {
    await events.enforcementReported({
      device: deviceDoc(),
      report: report([{ key: "applicationControl", status: "unsupported" }]),
      overall: "unsupported",
    });
    restore();

    const { event } = sink.sent[0];
    // Not `enforcement.failed`: nothing broke, the machine has no mechanism.
    assert.equal(event.action, "enforcement.reported");
    assert.deepEqual(event.payload.failedControls, []);
    assert.deepEqual(event.payload.unsupportedControls, ["applicationControl"]);
    // Still worth an administrator's attention, because nothing is enforced.
    assert.ok(sink.sent.some((entry) => entry.to === ADMIN));
  });
});

describe("failure policy", () => {
  test("a throwing transport does not throw at the caller", async () => {
    setEventDispatcher(
      createEventDispatcher({
        publish: () => {
          throw new Error("socket is gone");
        },
        broadcast: () => {},
        sendToUser: () => {
          throw new Error("socket is gone");
        },
        sendToRoom: () => {},
      })
    );

    const sent = await events.deviceEnrolled(deviceDoc());
    restore();

    assert.equal(sent, 0);
  });

  test("a failing recipient lookup does not throw at the caller", async () => {
    permissionNotifier.approversFor = async () => {
      throw new Error("the database is down");
    };

    const sent = await events.deviceStatusChanged({
      device: deviceDoc({ status: "blocked" }),
      actorId: ADMIN,
    });
    restore();

    assert.equal(sent, 0);
  });

  test("an event with no company resolves to nobody rather than everybody", async () => {
    const sent = await events.policyChanged({
      companyId: null,
      policy: { _id: "p1", name: "Standard", version: 1 },
      action: events.EVENT_ACTIONS.POLICY_UPDATED,
      actorId: ADMIN,
    });
    restore();

    assert.equal(sent, 0);
    assert.equal(sink.sent.length, 0);
  });
});
