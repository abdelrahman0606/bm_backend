const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert");

const {
  createEventDispatcher,
  setEventDispatcher,
} = require("../../core/events/eventDispatcher");
const { EVENT_TYPES } = require("../../core/events/eventTypes");
const events = require("./gmailEvents");
const push = require("./gmailPushService");
const sendService = require("./gmailSendService");

/**
 * The live feed and the public push endpoint.
 *
 * Two different kinds of risk, tested together because both are about what
 * crosses a boundary.
 *
 * The event feed leaves this process: so the questions are whether a payload
 * can carry a credential or a message body, whether it can reach the wrong
 * user, and whether a transport failure can turn a successful write into a
 * failed request.
 *
 * The push endpoint is the one part of the feature reachable without a BM
 * session: so the questions are whether it can be called without
 * authentication, whether a forged notification can name a mailbox it should
 * not, and whether a malformed body is refused rather than retried forever.
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

const USER = "507f1f77bcf86cd799439011";
const OTHER_USER = "507f1f77bcf86cd799439099";
const ACCOUNT = "507f1f77bcf86cd799439022";

/** An account document, including fields that must never reach a payload. */
const accountDoc = (overrides = {}) => ({
  _id: ACCOUNT,
  userId: USER,
  email: "ops@example.com",
  displayName: "Ops",
  accessLevel: "modify",
  isPrimary: true,
  isEnabled: true,
  // Present on a real document, and the thing this whole feature protects.
  refreshToken: "v1.c2VhbGVk.dGFn.Y2lwaGVy",
  syncState: { lastHistoryId: "99887766", lockedBy: "host:123" },
  ...overrides,
});

/** A stored message, with a body that must not travel with the event. */
const messageDoc = (overrides = {}) => ({
  _id: "507f1f77bcf86cd799439033",
  gmailId: "m1",
  threadId: "t1",
  subject: "Invoice 42",
  from: { name: "Jane", email: "jane@x.com" },
  to: [{ email: "ops@example.com" }],
  snippet: "Please see attached",
  internalDate: new Date("2026-11-20T10:00:00Z"),
  labelIds: ["INBOX", "UNREAD"],
  isUnread: true,
  hasAttachments: true,
  attachments: [{ attachmentId: "A1", filename: "invoice.pdf" }],
  bodyText: "THE ENTIRE CONFIDENTIAL BODY OF THE EMAIL",
  bodyHtml: "<p>THE ENTIRE CONFIDENTIAL BODY OF THE EMAIL</p>",
  ...overrides,
});

let sink;

beforeEach(() => {
  sink = recorder();
  setEventDispatcher(createEventDispatcher(sink.gateway));
});

describe("what an event payload may contain", () => {
  test("a connected mailbox event carries no token and no cursor", () => {
    events.accountConnected(accountDoc());

    const serialized = JSON.stringify(sink.sent);
    assert.ok(!/refreshToken/.test(serialized), "refreshToken reached the wire");
    assert.ok(!/c2VhbGVk/.test(serialized), "a sealed token reached the wire");
    assert.ok(!/99887766/.test(serialized), "the history cursor reached the wire");
    assert.ok(!/lockedBy/.test(serialized), "lease bookkeeping reached the wire");
  });

  test("new mail carries the envelope and never the body", () => {
    // The deviation from "ids only": the whole point of the feature is a
    // notification that says who wrote and about what. The line is the
    // envelope — enough to notify, never the body.
    events.messageReceived({
      userId: USER,
      accountId: ACCOUNT,
      accountEmail: "ops@example.com",
      message: messageDoc(),
    });

    const [frame] = sink.sent;
    assert.equal(frame.event.payload.subject, "Invoice 42");
    assert.deepEqual(frame.event.payload.from, {
      name: "Jane",
      email: "jane@x.com",
    });
    assert.equal(frame.event.payload.snippet, "Please see attached");
    assert.equal(frame.event.payload.attachmentCount, 1);

    const serialized = JSON.stringify(frame);
    assert.ok(
      !/ENTIRE CONFIDENTIAL BODY/.test(serialized),
      "the message body reached the wire",
    );
    assert.equal(frame.event.payload.bodyText, undefined);
    assert.equal(frame.event.payload.bodyHtml, undefined);
  });

  test("an envelope reports attachments without describing them", () => {
    const envelope = events.envelopeOf(messageDoc());
    assert.equal(envelope.hasAttachments, true);
    assert.equal(envelope.attachmentCount, 1);
    // Filenames can themselves be sensitive, and a client that wants them
    // fetches the message.
    assert.equal(envelope.attachments, undefined);
  });

  test("a failed send says why and whether retrying could work", () => {
    events.messageSendFailed({
      userId: USER,
      accountId: ACCOUNT,
      operationId: "507f1f77bcf86cd799439044",
      subject: "Hello",
      to: [{ email: "a@x.com" }],
      error: { reason: "rateLimitExceeded", message: "slow down", retryable: true },
    });

    const { payload } = sink.sent[0].event;
    assert.equal(payload.reason, "rateLimitExceeded");
    assert.equal(payload.retryable, true);
    assert.deepEqual(payload.to, ["a@x.com"]);
  });

  test("a sent event claims acceptance and nothing more", () => {
    // Gmail took it. That is not delivery and not a read receipt, and no
    // field here may imply one.
    events.messageSent({
      userId: USER,
      accountId: ACCOUNT,
      operationId: "507f1f77bcf86cd799439044",
      message: { gmailId: "m9", threadId: "t9", subject: "Hi", to: [] },
    });

    const { payload } = sink.sent[0].event;
    assert.ok(payload.acceptedAt, "acceptance is not timestamped");
    assert.equal(payload.deliveredAt, undefined);
    assert.equal(payload.readAt, undefined);
  });
});

describe("who receives an event", () => {
  test("it goes to the mailbox's owner, taken from the account row", () => {
    events.accountConnected(accountDoc());
    assert.equal(sink.sent.length, 1);
    assert.equal(sink.sent[0].to, USER);
  });

  test("there is no broadcast and no company room", () => {
    // A connected mailbox is personal: nobody else may see that it exists,
    // let alone what is in it. Unlike Device Control, whose audience is the
    // administrators of a fleet.
    events.accountConnected(accountDoc());
    events.messageReceived({
      userId: USER,
      accountId: ACCOUNT,
      message: messageDoc(),
    });
    events.syncCompleted({ userId: USER, accountId: ACCOUNT, mode: "incremental" });

    sink.sent.forEach((frame) => {
      assert.equal(frame.to, USER, "an event was not addressed to the owner");
    });
  });

  test("one user's mail never reaches another's socket", () => {
    events.messageReceived({
      userId: OTHER_USER,
      accountId: ACCOUNT,
      message: messageDoc(),
    });
    assert.equal(sink.sent[0].to, OTHER_USER);
    assert.notEqual(sink.sent[0].to, USER);
  });

  test("an event with no owner is not sent at all", () => {
    // Fail closed: an unaddressed frame must not fall back to a broadcast.
    assert.equal(events.messageReceived({ message: messageDoc() }), false);
    assert.equal(sink.sent.length, 0);
  });
});

describe("the envelope every event is wrapped in", () => {
  test("it is one type, with the change named in the action", () => {
    events.accountConnected(accountDoc());
    const { event } = sink.sent[0];

    assert.equal(event.type, EVENT_TYPES.GMAIL);
    assert.equal(event.type, "gmail");
    assert.equal(event.action, "account.connected");
    assert.ok(event.id, "the event has no id");
    assert.ok(event.createdAt, "the event has no timestamp");
    assert.equal(event.version, "1.0");
  });

  test("every action is a dotted name a client can route on", () => {
    Object.values(events.EVENT_ACTIONS).forEach((action) => {
      assert.match(action, /^[a-z]+\.[a-zA-Z]+$/, `"${action}" is not routable`);
    });
  });

  test("the account id travels with every event", () => {
    events.syncFailed({
      userId: USER,
      accountId: ACCOUNT,
      mode: "incremental",
      error: new Error("nope"),
      willRetry: true,
    });
    assert.equal(sink.sent[0].event.payload.accountId, ACCOUNT);
  });
});

describe("when realtime delivery fails", () => {
  test("publishing a frame cannot fail the operation that caused it", () => {
    // A message that was stored is stored whether or not the frame went out.
    setEventDispatcher(
      createEventDispatcher({
        publish: () => {
          throw new Error("socket gone");
        },
        broadcast: () => {
          throw new Error("socket gone");
        },
        sendToUser: () => {
          throw new Error("socket gone");
        },
        sendToRoom: () => {
          throw new Error("socket gone");
        },
      }),
    );

    assert.doesNotThrow(() => {
      const delivered = events.messageReceived({
        userId: USER,
        accountId: ACCOUNT,
        message: messageDoc(),
      });
      assert.equal(delivered, false);
    });
  });
});

// ── The Pub/Sub push endpoint ──────────────────────────────────────────────

/** A Pub/Sub push envelope, as Google really sends it. */
const pubsubBody = ({
  messageId = "pubsub-1",
  emailAddress = "ops@example.com",
  historyId = "123456",
} = {}) => ({
  subscription: "projects/p/subscriptions/s",
  message: {
    messageId,
    publishTime: "2026-11-20T10:00:00.000Z",
    data: Buffer.from(JSON.stringify({ emailAddress, historyId })).toString(
      "base64",
    ),
  },
});

/** Runs `body` with specific push configuration, then restores it. */
const withPushConfig = async (config, body) => {
  const keys = [
    "GMAIL_PUSH_TOKEN",
    "GMAIL_PUSH_AUDIENCE",
    "GMAIL_PUSH_SERVICE_ACCOUNT",
  ];
  const saved = keys.map((key) => [key, process.env[key]]);

  keys.forEach((key) => {
    if (config[key] === undefined) delete process.env[key];
    else process.env[key] = config[key];
  });

  try {
    return await body();
  } finally {
    saved.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
};

describe("reading a push notification", () => {
  test("the mailbox and history id are decoded from the envelope", () => {
    const decoded = push.decodeEnvelope(pubsubBody());
    assert.equal(decoded.pubsubMessageId, "pubsub-1");
    assert.equal(decoded.emailAddress, "ops@example.com");
    assert.equal(decoded.historyId, "123456");
    assert.ok(decoded.publishedAt instanceof Date);
  });

  test("the address is lowercased, so it matches a stored mailbox", () => {
    const decoded = push.decodeEnvelope(
      pubsubBody({ emailAddress: "OPS@Example.COM" }),
    );
    assert.equal(decoded.emailAddress, "ops@example.com");
  });

  test("the history id stays a string", () => {
    // It is a 64-bit value, and the sync compares it as a string precisely
    // so a busy mailbox cannot lose precision here.
    const decoded = push.decodeEnvelope(
      pubsubBody({ historyId: "9007199254740993" }),
    );
    assert.strictEqual(decoded.historyId, "9007199254740993");
  });

  test("a body that is not a Pub/Sub envelope is refused permanently", () => {
    // 400, not 500: retrying a malformed message forever only fills a
    // dead-letter queue.
    assert.throws(() => push.decodeEnvelope({}), (error) => {
      assert.equal(error.statusCode, 400);
      return true;
    });
    assert.throws(() => push.decodeEnvelope({ message: {} }), /envelope/);
  });

  test("data that is not JSON is refused", () => {
    assert.throws(
      () =>
        push.decodeEnvelope({
          message: {
            messageId: "x",
            data: Buffer.from("not json").toString("base64"),
          },
        }),
      /not JSON/,
    );
  });

  test("a notification naming no mailbox is refused", () => {
    assert.throws(
      () =>
        push.decodeEnvelope({
          message: {
            messageId: "x",
            data: Buffer.from(JSON.stringify({ historyId: "1" })).toString(
              "base64",
            ),
          },
        }),
      /names no mailbox/,
    );
  });
});

describe("authenticating a push notification", () => {
  test("with nothing configured, every request is refused", async () => {
    // Fail closed. An unauthenticated public endpoint that triggers API work
    // is a free quota-exhaustion lever.
    await withPushConfig({}, async () => {
      assert.equal(push.isConfigured(), false);
      await assert.rejects(
        push.assertAuthentic({ token: "anything" }),
        (error) => {
          assert.equal(error.statusCode, 503);
          assert.match(error.message, /not configured/);
          return true;
        },
      );
    });
  });

  test("the shared secret is accepted when it matches", async () => {
    await withPushConfig({ GMAIL_PUSH_TOKEN: "s3cret-token-value" }, async () => {
      const result = await push.assertAuthentic({ token: "s3cret-token-value" });
      assert.equal(result.via, "token");
    });
  });

  test("a wrong or missing secret is refused", async () => {
    await withPushConfig({ GMAIL_PUSH_TOKEN: "s3cret-token-value" }, async () => {
      await assert.rejects(push.assertAuthentic({ token: "wrong" }), /not authenticated/);
      await assert.rejects(push.assertAuthentic({}), /not authenticated/);
    });
  });

  test("the secret comparison does not leak length by short-circuiting", () => {
    assert.equal(push.secretsMatch("abc", "abc"), true);
    assert.equal(push.secretsMatch("abc", "abd"), false);
    // Different lengths are not compared byte by byte, and an empty secret
    // never matches — otherwise an unset variable would accept everything.
    assert.equal(push.secretsMatch("abc", "abcd"), false);
    assert.equal(push.secretsMatch("", ""), false);
    assert.equal(push.secretsMatch(undefined, "abc"), false);
  });

  test("an unverifiable OIDC token is refused, not assumed good", async () => {
    await withPushConfig(
      {
        GMAIL_PUSH_AUDIENCE: "https://api.example.com/api/v1/gmail-push",
        GMAIL_PUSH_SERVICE_ACCOUNT: "pubsub@example.iam.gserviceaccount.com",
      },
      async () => {
        await assert.rejects(
          push.assertAuthentic({ authorization: "Bearer not.a.real.token" }),
          (error) => {
            assert.equal(error.statusCode, 403);
            return true;
          },
        );
      },
    );
  });

  test("a configured audience with no token presented is refused", async () => {
    await withPushConfig(
      { GMAIL_PUSH_AUDIENCE: "https://api.example.com/api/v1/gmail-push" },
      async () => {
        await assert.rejects(push.assertAuthentic({}), /not authenticated/);
      },
    );
  });
});

// ── Composition rules, which recipients see the consequences of ────────────

describe("refusing a message that should not be sent", () => {
  const composition = (overrides = {}) => ({
    to: [{ email: "a@x.com" }],
    cc: [],
    bcc: [],
    subject: "Hello",
    text: "Body",
    attachments: [],
    ...overrides,
  });

  test("a message with no recipients is refused", () => {
    assert.throws(
      () => sendService.validateComposition(composition({ to: [] })),
      /at least one recipient/,
    );
  });

  test("a bcc-only message is allowed", () => {
    // Legitimate and common: an announcement where recipients should not see
    // each other.
    const result = sendService.validateComposition(
      composition({ to: [], bcc: [{ email: "b@x.com" }] }),
    );
    assert.equal(result.recipients.length, 1);
  });

  test("an address that is not an address is named in the refusal", () => {
    assert.throws(
      () => sendService.validateComposition(composition({ to: [{ email: "nope" }] })),
      /nope/,
    );
  });

  test("an empty message with no subject is refused", () => {
    assert.throws(
      () =>
        sendService.validateComposition(
          composition({ subject: "   ", text: null, html: null }),
        ),
      /needs a subject or a body/,
    );
  });

  test("a subject with no body is allowed", () => {
    assert.doesNotThrow(() =>
      sendService.validateComposition(composition({ text: null, html: null })),
    );
  });

  test("Gmail's recipient ceiling is enforced before anything is sent", () => {
    // A send is not a transaction: discovering this after half the
    // recipients have been accepted is not an option.
    const many = Array.from({ length: 101 }, (unused, index) => ({
      email: `a${index}@x.com`,
    }));
    assert.throws(
      () => sendService.validateComposition(composition({ to: many })),
      /more than 100 recipients/,
    );
  });

  test("the size limit is checked against the encoded size", () => {
    // Base64 inflates by a third, and that is what travels. Checking the raw
    // bytes would let a 20MB attachment through to be refused by Gmail.
    const justUnder = Buffer.alloc(18 * 1024 * 1024);
    const justOver = Buffer.alloc(20 * 1024 * 1024);

    assert.doesNotThrow(() =>
      sendService.validateComposition(
        composition({ attachments: [{ content: justUnder }] }),
      ),
    );
    assert.throws(
      () =>
        sendService.validateComposition(
          composition({ attachments: [{ content: justOver }] }),
        ),
      /too large/,
    );
  });

  test("the sender name falls back from chosen name to address", () => {
    assert.deepEqual(
      sendService.senderFor({
        email: "ops@example.com",
        sendAsName: "Operations",
        displayName: "Ops",
      }),
      { name: "Operations", email: "ops@example.com" },
    );
    assert.deepEqual(
      sendService.senderFor({ email: "ops@example.com", displayName: "Ops" }),
      { name: "Ops", email: "ops@example.com" },
    );
    assert.deepEqual(
      sendService.senderFor({ email: "ops@example.com" }),
      { name: null, email: "ops@example.com" },
    );
  });
});

describe("checking whether push could ever work", () => {
  const withEndpoint = (url, body) => {
    const saved = process.env.GMAIL_PUSH_ENDPOINT;
    if (url === null) delete process.env.GMAIL_PUSH_ENDPOINT;
    else process.env.GMAIL_PUSH_ENDPOINT = url;
    try {
      return body();
    } finally {
      if (saved === undefined) delete process.env.GMAIL_PUSH_ENDPOINT;
      else process.env.GMAIL_PUSH_ENDPOINT = saved;
    }
  };

  test("an https hostname passes every documented rule", () => {
    withEndpoint("https://api.example.com/api/v1/gmail-push", () => {
      const result = push.describeEndpoint();
      assert.equal(result.deliverable, true);
      assert.deepEqual(result.problems, []);
    });
  });

  test("plain http is refused: Pub/Sub only delivers over HTTPS", () => {
    withEndpoint("http://api.example.com/api/v1/gmail-push", () => {
      const result = push.describeEndpoint();
      assert.equal(result.deliverable, false);
      assert.match(result.problems[0], /only delivers to an HTTPS endpoint/);
    });
  });

  test("a bare IP is refused for a reason that cannot be worked around", () => {
    // No public certificate authority issues for an IP address, so the
    // certificate requirement is unsatisfiable rather than merely unmet —
    // worth saying, because "add TLS" is not the fix.
    withEndpoint("https://62.72.43.136:7070/api/v1/gmail-push", () => {
      const result = push.describeEndpoint();
      assert.equal(result.deliverable, false);
      assert.match(result.problems[0], /bare IP address/);
      assert.match(result.problems[0], /certificate authorities/);
    });
  });

  test("a private or loopback address is refused as unreachable", () => {
    ["https://localhost/push", "https://192.168.1.3/push", "https://10.0.0.5/push"].forEach(
      (url) => {
        withEndpoint(url, () => {
          const result = push.describeEndpoint();
          assert.equal(result.deliverable, false);
          assert.match(result.problems[0], /private or loopback/);
        });
      },
    );
  });

  test("a public IP in the 172.16/12 block is private, 172.15 is not", () => {
    // The boundary the RFC draws and an eyeballed check gets wrong.
    withEndpoint("https://172.20.0.1/push", () => {
      assert.match(push.describeEndpoint().problems[0], /private or loopback/);
    });
    withEndpoint("https://172.15.0.1/push", () => {
      assert.match(push.describeEndpoint().problems[0], /bare IP address/);
    });
  });

  test("an unset endpoint is unknown, not broken", () => {
    // Nothing to judge. Reporting it as a failure would be a false alarm on
    // a deployment that deliberately runs on the scheduler.
    withEndpoint(null, () => {
      const result = push.describeEndpoint();
      assert.equal(result.deliverable, null);
      assert.match(result.problems[0], /GMAIL_PUSH_ENDPOINT is not set/);
    });
  });

  test("a malformed URL is reported as one", () => {
    withEndpoint("api.example.com", () => {
      const result = push.describeEndpoint();
      assert.equal(result.deliverable, false);
      assert.match(result.problems[0], /not a valid URL/);
    });
  });

  test("the auth mode is the one assertAuthentic will actually use", () => {
    withPushConfig({ GMAIL_PUSH_TOKEN: "secret-value-here" }, () => {
      assert.equal(push.authMode(), "token");
    });
    withPushConfig({ GMAIL_PUSH_AUDIENCE: "https://api.example.com/p" }, () => {
      assert.equal(push.authMode(), "oidc");
    });
    withPushConfig({}, () => {
      assert.equal(push.authMode(), "none");
      // Not "open": with nothing configured the endpoint refuses everything.
      assert.equal(push.describeConfiguration().acceptsRequests, false);
    });
  });

  test("the diagnostics carry no secret", () => {
    withPushConfig(
      {
        GMAIL_PUSH_TOKEN: "a-very-secret-token",
        GMAIL_PUSH_SERVICE_ACCOUNT: "pubsub@example.iam.gserviceaccount.com",
      },
      () => {
        const described = JSON.stringify(push.describeConfiguration());
        assert.ok(
          !described.includes("a-very-secret-token"),
          "the shared secret reached the diagnostics",
        );
        // The service account is an identity, not a credential, and naming
        // it is how an operator checks the OIDC token against it.
        assert.ok(described.includes("pubsub@example.iam.gserviceaccount.com"));
        assert.equal(described.includes('"tokenConfigured":true'), true);
      },
    );
  });
});

test("the Gmail event type is registered centrally", () => {
  // So a client registers one handler for the type and routes on the action,
  // the same contract Device Control uses.
  assert.equal(EVENT_TYPES.GMAIL, "gmail");
  assert.equal(events.EVENT_TYPE, EVENT_TYPES.GMAIL);
});
