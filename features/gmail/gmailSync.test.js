const { test, describe } = require("node:test");
const assert = require("node:assert");

const sync = require("./gmailSyncService");
const client = require("./gmailClient");
const { GmailThread } = require("./gmailThreadModel");
const directReader = require("./gmailDirectReader");
const storage = require("./gmailStorage");
const messageService = require("./gmailMessageService");

/**
 * The synchronization logic, tested where it can be tested without a
 * database: the mapping from Gmail's JSON to our documents, the folding of a
 * history page into a change set, the cursor comparison, the backoff, and the
 * HTTP client's retry behaviour.
 *
 * These are the parts where a bug is silent. A sync that loses mail does not
 * throw — it just returns fewer messages than the mailbox contains, and
 * nobody notices until someone goes looking for an email they remember
 * receiving. So the cases here are mostly about *not losing things*: a
 * cursor that must never move backwards, a change that must survive being
 * applied twice, a message that was added and deleted in the same breath.
 */

/** A Gmail message as the API really returns it. */
const rawMessage = ({
  id = "m1",
  threadId = "t1",
  labelIds = ["INBOX", "UNREAD"],
  subject = "Hello",
  from = "Jane <jane@x.com>",
  to = "me@bm.com",
  text = "Body text",
  attachments = [],
  internalDate = "1764000000000",
  historyId = "5000",
} = {}) => ({
  id,
  threadId,
  historyId,
  labelIds,
  snippet: "Hello there",
  internalDate,
  sizeEstimate: 4096,
  payload: {
    mimeType: attachments.length > 0 ? "multipart/mixed" : "text/plain",
    headers: [
      { name: "Subject", value: subject },
      { name: "From", value: from },
      { name: "To", value: to },
      { name: "Message-ID", value: `<${id}@x.com>` },
    ],
    ...(attachments.length > 0
      ? {
          parts: [
            {
              mimeType: "text/plain",
              body: { data: Buffer.from(text).toString("base64url") },
            },
            ...attachments,
          ],
        }
      : { body: { data: Buffer.from(text).toString("base64url") } }),
  },
});

// ── Mapping ────────────────────────────────────────────────────────────────

describe("mapping a Gmail message", () => {
  test("the envelope is read from the headers", () => {
    const mapped = sync.mapMessage(rawMessage());
    assert.equal(mapped.subject, "Hello");
    assert.deepEqual(mapped.from, { name: "Jane", email: "jane@x.com" });
    assert.deepEqual(mapped.to, [{ name: null, email: "me@bm.com" }]);
    assert.equal(mapped.rfcMessageId, "<m1@x.com>");
  });

  test("the date comes from internalDate, never from the Date header", () => {
    // The `Date` header is written by the sender and is routinely wrong,
    // sometimes by years. Sorting a mailbox by it produces nonsense.
    const mapped = sync.mapMessage({
      ...rawMessage(),
      internalDate: "1700000000000",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "Date", value: "Thu, 1 Jan 1970 00:00:00 +0000" },
          { name: "Subject", value: "x" },
        ],
        body: { data: "" },
      },
    });
    assert.equal(mapped.internalDate.getTime(), 1700000000000);
  });

  test("the derived flags agree with the labels", () => {
    const mapped = sync.mapMessage(
      rawMessage({ labelIds: ["INBOX", "UNREAD", "STARRED", "IMPORTANT"] }),
    );
    assert.equal(mapped.isUnread, true);
    assert.equal(mapped.isStarred, true);
    assert.equal(mapped.isImportant, true);
    assert.equal(mapped.isInInbox, true);
    assert.equal(mapped.isTrashed, false);
    assert.equal(mapped.isSent, false);
    assert.equal(mapped.isSpam, false);
  });

  test("a read message has no UNREAD label and no unread flag", () => {
    const mapped = sync.mapMessage(rawMessage({ labelIds: ["INBOX"] }));
    assert.equal(mapped.isUnread, false);
  });

  test("an attachment raises the paperclip; an inline image does not", () => {
    const file = {
      mimeType: "application/pdf",
      filename: "a.pdf",
      body: { attachmentId: "A1", size: 100 },
      headers: [{ name: "Content-Disposition", value: "attachment" }],
    };
    const inlineImage = {
      mimeType: "image/png",
      filename: "",
      body: { attachmentId: "I1", size: 50 },
      headers: [
        { name: "Content-ID", value: "<logo>" },
        { name: "Content-Disposition", value: "inline" },
      ],
    };

    assert.equal(
      sync.mapMessage(rawMessage({ attachments: [file] })).hasAttachments,
      true,
    );
    // Otherwise every HTML newsletter looks like it carries a file.
    assert.equal(
      sync.mapMessage(rawMessage({ attachments: [inlineImage] }))
        .hasAttachments,
      false,
    );
  });

  test("a full pass keeps the envelope but not the body", () => {
    // A large mailbox is gigabytes of text nobody has asked to read, so the
    // first pass stores what lists and filters need and nothing more.
    const mapped = sync.mapMessage(rawMessage(), { storeBody: false });
    assert.equal(mapped.bodyText, undefined);
    assert.equal(mapped.bodyFetchedAt, undefined);
    assert.equal(mapped.subject, "Hello");
    assert.equal(mapped.snippet, "Hello there");
  });

  test("new mail is stored with its body", () => {
    const mapped = sync.mapMessage(rawMessage(), { storeBody: true });
    assert.equal(mapped.bodyText, "Body text");
    assert.ok(mapped.bodyFetchedAt instanceof Date);
    assert.equal(mapped.bodyTruncated, false);
  });

  test("an oversized body is left unfetched rather than cut in half", () => {
    // Half a message stored as though it were whole is worse than one the
    // reader has to open.
    const huge = "x".repeat(sync.MAX_STORED_BODY_BYTES + 1);
    const mapped = sync.mapMessage(
      rawMessage({ text: huge }),
      { storeBody: true },
    );
    assert.equal(mapped.bodyText, undefined);
    assert.equal(mapped.bodyTruncated, true);
    assert.equal(mapped.bodyFetchedAt, null);
  });

  test("a message with no headers at all does not throw", () => {
    const mapped = sync.mapMessage({ id: "x", threadId: "t", payload: {} });
    assert.deepEqual(mapped.from, {});
    assert.deepEqual(mapped.to, []);
    assert.equal(mapped.subject, "");
    assert.ok(mapped.internalDate instanceof Date);
  });

  test("the history id is kept as a string", () => {
    // It is an unsigned 64-bit value; a Number would lose precision on a
    // busy mailbox and the cursor would start skipping changes.
    const mapped = sync.mapMessage(rawMessage({ historyId: "9007199254740993" }));
    assert.strictEqual(mapped.historyId, "9007199254740993");
  });
});

// ── The cursor ─────────────────────────────────────────────────────────────

describe("comparing history ids", () => {
  test("longer is newer, which decimal string comparison alone gets wrong", () => {
    assert.equal(sync.historyIdIsNewer("12345", "9999"), true);
    assert.equal(sync.historyIdIsNewer("9999", "12345"), false);
  });

  test("same length compares lexically", () => {
    assert.equal(sync.historyIdIsNewer("12346", "12345"), true);
    assert.equal(sync.historyIdIsNewer("12345", "12346"), false);
    assert.equal(sync.historyIdIsNewer("12345", "12345"), false);
  });

  test("beyond what a Number can hold, it is still correct", () => {
    // The reason this is string comparison and not arithmetic.
    assert.equal(
      sync.historyIdIsNewer("9007199254740993", "9007199254740992"),
      true,
    );
  });

  test("a missing candidate never advances the cursor", () => {
    // A notification that carries no history id must not move it, and
    // certainly must not move it backwards.
    assert.equal(sync.historyIdIsNewer(null, "500"), false);
    assert.equal(sync.historyIdIsNewer(undefined, "500"), false);
    assert.equal(sync.historyIdIsNewer("500", null), true);
  });
});

// ── Folding a history page ─────────────────────────────────────────────────

const fold = (records) => {
  const collected = {
    addedIds: new Set(),
    deletedIds: new Set(),
    labelChanges: new Map(),
  };
  records.forEach((record) => sync.applyHistoryRecord(record, collected));
  return collected;
};

describe("folding history records", () => {
  test("added and deleted messages are collected by id", () => {
    const collected = fold([
      { id: "1", messagesAdded: [{ message: { id: "a", threadId: "t" } }] },
      { id: "2", messagesDeleted: [{ message: { id: "b", threadId: "t" } }] },
    ]);

    assert.deepEqual([...collected.addedIds], ["a"]);
    assert.deepEqual([...collected.deletedIds], ["b"]);
  });

  test("a label added then removed in one page cancels out", () => {
    const collected = fold([
      { id: "1", labelsAdded: [{ message: { id: "m" }, labelIds: ["STARRED"] }] },
      {
        id: "2",
        labelsRemoved: [{ message: { id: "m" }, labelIds: ["STARRED"] }],
      },
    ]);

    const change = collected.labelChanges.get("m");
    assert.deepEqual([...change.add], []);
    assert.deepEqual([...change.remove], ["STARRED"]);
  });

  test("Gmail's own label list wins over the deltas", () => {
    // When Gmail echoes the whole list it is the truth, and the deltas are
    // redundant. Applying the deltas instead can drift.
    const collected = fold([
      {
        id: "1",
        labelsRemoved: [
          {
            message: { id: "m", labelIds: ["INBOX", "IMPORTANT"] },
            labelIds: ["UNREAD"],
          },
        ],
      },
    ]);

    assert.deepEqual(collected.labelChanges.get("m").authoritative, [
      "INBOX",
      "IMPORTANT",
    ]);
  });

  test("the last record in a page wins, because records are in order", () => {
    const collected = fold([
      {
        id: "1",
        labelsAdded: [{ message: { id: "m", labelIds: ["A"] }, labelIds: ["A"] }],
      },
      {
        id: "2",
        labelsAdded: [
          { message: { id: "m", labelIds: ["A", "B"] }, labelIds: ["B"] },
        ],
      },
    ]);

    assert.deepEqual(collected.labelChanges.get("m").authoritative, ["A", "B"]);
  });

  test("records with no message id are ignored, not crashed on", () => {
    const collected = fold([
      { id: "1", messagesAdded: [{}] },
      { id: "2", labelsAdded: [{ labelIds: ["X"] }] },
      { id: "3" },
    ]);

    assert.equal(collected.addedIds.size, 0);
    assert.equal(collected.labelChanges.size, 0);
  });

  test("folding the same page twice changes nothing", () => {
    // The property that makes replaying a history range safe, which is what
    // makes Pub/Sub's at-least-once delivery harmless.
    const records = [
      { id: "1", messagesAdded: [{ message: { id: "a" } }] },
      { id: "2", labelsAdded: [{ message: { id: "a" }, labelIds: ["STARRED"] }] },
    ];

    const once = fold(records);
    const twice = fold([...records, ...records]);

    assert.deepEqual([...once.addedIds], [...twice.addedIds]);
    assert.deepEqual(
      [...once.labelChanges.get("a").add],
      [...twice.labelChanges.get("a").add],
    );
  });
});

// ── Scheduling decisions ───────────────────────────────────────────────────

describe("choosing a pass", () => {
  test("no cursor means a full pass", () => {
    assert.equal(sync.chooseMode({ syncState: {} }, "auto"), "full");
  });

  test("a cursor means an incremental one", () => {
    assert.equal(
      sync.chooseMode({ syncState: { lastHistoryId: "500" } }, "auto"),
      "incremental",
    );
  });

  test("an unfinished initial pass is resumed, cursor or not", () => {
    assert.equal(
      sync.chooseMode(
        { syncState: { lastHistoryId: "500", initialPageToken: "page2" } },
        "auto",
      ),
      "full",
    );
  });

  test("a caller can insist on a full pass", () => {
    assert.equal(
      sync.chooseMode({ syncState: { lastHistoryId: "500" } }, "full"),
      "full",
    );
  });
});

describe("backing off after a failure", () => {
  test("the wait doubles and then stops growing", () => {
    const minutes = (count) =>
      Math.round((sync.backoffFor(count).getTime() - Date.now()) / 60000);

    assert.equal(minutes(1), 1);
    assert.equal(minutes(2), 2);
    assert.equal(minutes(3), 4);
    assert.equal(minutes(4), 8);
    // Capped, so a mailbox that failed overnight is retried in the morning
    // without anyone intervening — and a Gmail outage is not a retry storm.
    assert.equal(minutes(20), 60);
    assert.equal(minutes(100), 60);
  });
});

// ── Fetching in batches ────────────────────────────────────────────────────

describe("fetching messages", () => {
  const fakeClient = (behaviour) => ({
    messages: { get: behaviour },
  });

  test("a message deleted between listing and fetching is skipped", () => {
    // Mail does get deleted while you are reading it. One 404 must not fail
    // the whole batch.
    const gone = new Error("gone");
    gone.httpStatus = 404;

    return sync
      .fetchMessages(
        fakeClient(async (id) => {
          if (id === "b") throw gone;
          return { id };
        }),
        ["a", "b", "c"],
      )
      .then((fetched) => {
        assert.deepEqual(
          fetched.map((message) => message.id),
          ["a", "c"],
        );
      });
  });

  test("any other failure does fail the batch", async () => {
    // A 500 or a rate limit is not "this message is gone": swallowing it
    // would silently store a partial mailbox.
    const broken = new Error("server error");
    broken.httpStatus = 500;

    await assert.rejects(
      sync.fetchMessages(
        fakeClient(async () => {
          throw broken;
        }),
        ["a"],
      ),
      /server error/,
    );
  });

  test("requests are not all fired at once", async () => {
    let inFlight = 0;
    let peak = 0;

    await sync.fetchMessages(
      fakeClient(async (id) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => {
          setTimeout(resolve, 1);
        });
        inFlight -= 1;
        return { id };
      }),
      Array.from({ length: 40 }, (unused, index) => `m${index}`),
    );

    // 40 simultaneous requests is how a sync earns a rate limit, and the
    // client's own backoff would then serialize them anyway — slower, with
    // wasted calls.
    assert.ok(peak <= 5, `fired ${peak} requests at once`);
  });

  test("nothing to fetch is not a request", async () => {
    let called = 0;
    const fetched = await sync.fetchMessages(
      fakeClient(async () => {
        called += 1;
        return {};
      }),
      [],
    );
    assert.deepEqual(fetched, []);
    assert.equal(called, 0);
  });
});

// ── Thread summaries ───────────────────────────────────────────────────────

describe("summarizing a thread", () => {
  const message = (overrides) => ({
    gmailId: "m",
    internalDate: new Date("2026-01-01T00:00:00Z"),
    subject: "Subject",
    snippet: "snip",
    labelIds: [],
    isUnread: false,
    isStarred: false,
    isInInbox: false,
    isTrashed: false,
    hasAttachments: false,
    from: { email: "a@x.com" },
    to: [],
    cc: [],
    ...overrides,
  });

  test("the subject is the first message's, the snippet the newest", () => {
    // What Gmail shows: a conversation keeps its original subject, and the
    // preview line is the latest thing said.
    const summary = GmailThread.summaryFrom([
      message({
        gmailId: "new",
        internalDate: new Date("2026-01-02T00:00:00Z"),
        subject: "Re: Subject",
        snippet: "latest",
      }),
      message({ gmailId: "old", subject: "Subject", snippet: "first" }),
    ]);

    assert.equal(summary.subject, "Subject");
    assert.equal(summary.snippet, "latest");
    assert.equal(summary.lastMessageGmailId, "new");
    assert.equal(summary.messageCount, 2);
  });

  test("participants are deduplicated across the conversation", () => {
    const summary = GmailThread.summaryFrom([
      message({ from: { email: "a@x.com" }, to: [{ email: "b@x.com" }] }),
      message({
        gmailId: "m2",
        internalDate: new Date("2026-01-03T00:00:00Z"),
        from: { email: "b@x.com" },
        to: [{ email: "a@x.com" }],
        cc: [{ email: "c@x.com" }],
      }),
    ]);

    assert.deepEqual(
      summary.participants.map((person) => person.email).sort(),
      ["a@x.com", "b@x.com", "c@x.com"],
    );
  });

  test("a thread is trashed only when nothing is left outside the trash", () => {
    // One trashed reply must not bury the conversation, which is how Gmail
    // behaves too.
    const partly = GmailThread.summaryFrom([
      message({ isTrashed: true }),
      message({ gmailId: "m2", isTrashed: false }),
    ]);
    const fully = GmailThread.summaryFrom([
      message({ isTrashed: true }),
      message({ gmailId: "m2", isTrashed: true }),
    ]);

    assert.equal(partly.isTrashed, false);
    assert.equal(fully.isTrashed, true);
  });

  test("unread counts the unread messages, not the thread", () => {
    const summary = GmailThread.summaryFrom([
      message({ isUnread: true }),
      message({ gmailId: "m2", isUnread: true }),
      message({ gmailId: "m3", isUnread: false }),
    ]);
    assert.equal(summary.unreadCount, 2);
    assert.equal(summary.messageCount, 3);
  });

  test("labels are the union across the conversation", () => {
    const summary = GmailThread.summaryFrom([
      message({ labelIds: ["INBOX"] }),
      message({ gmailId: "m2", labelIds: ["SENT", "IMPORTANT"] }),
    ]);
    assert.deepEqual(summary.labelIds.sort(), ["IMPORTANT", "INBOX", "SENT"]);
  });

  test("an empty thread summarizes to nothing", () => {
    assert.equal(GmailThread.summaryFrom([]), null);
  });
});

// ── The HTTP client ────────────────────────────────────────────────────────

const googleError = (status, reason, extra = {}) => {
  const error = new Error(reason || "failed");
  error.response = {
    status,
    data: {
      error: {
        message: `${reason || "failed"} message`,
        ...(reason ? { errors: [{ reason }] } : {}),
      },
    },
    headers: extra.headers || {},
  };
  return error;
};

/** A client whose transport is `behaviour`. */
const createStubClient = (behaviour) =>
  client.createClient({
    getAccessToken: async () => "token",
    http: behaviour,
    maxAttempts: 4,
  });

describe("the Gmail HTTP client", () => {
  test("a rate limit is retried and then succeeds", async () => {
    let attempts = 0;
    const api = createStubClient(async () => {
      attempts += 1;
      if (attempts < 3) throw googleError(429, "rateLimitExceeded");
      return { data: { ok: true } };
    });

    assert.deepEqual(await api.getProfile(), { ok: true });
    assert.equal(attempts, 3);
  });

  test("an expired token is refreshed exactly once, then replayed", async () => {
    // Twice would mean the grant itself is gone, and retrying forever would
    // hammer Google's token endpoint with a credential it has refused.
    const forced = [];
    let attempts = 0;

    const api = client.createClient({
      getAccessToken: async ({ forceRefresh } = {}) => {
        forced.push(forceRefresh === true);
        return "token";
      },
      http: async () => {
        attempts += 1;
        if (attempts === 1) throw googleError(401, null);
        return { data: { ok: true } };
      },
    });

    assert.deepEqual(await api.getProfile(), { ok: true });
    assert.deepEqual(forced, [false, true]);
  });

  test("a second 401 is reported rather than retried forever", async () => {
    let attempts = 0;
    const api = createStubClient(async () => {
      attempts += 1;
      throw googleError(401, null);
    });

    await assert.rejects(api.getProfile(), (error) => {
      assert.equal(error.name, "GmailApiError");
      // Reported as 502, not 401: a 401 would make a client think its own
      // session expired and log the user out of the whole app.
      assert.equal(error.statusCode, 502);
      return true;
    });
    assert.equal(attempts, 2);
  });

  test("a missing permission is not retried: it will never succeed", async () => {
    let attempts = 0;
    const api = createStubClient(async () => {
      attempts += 1;
      throw googleError(403, "insufficientPermissions");
    });

    await assert.rejects(api.messages.send({ raw: "x" }), (error) => {
      assert.equal(error.reason, "insufficientPermissions");
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(attempts, 1);
  });

  test("a 404 is passed through, because callers branch on it", async () => {
    // A stale history cursor and a deleted message are both 404s, and both
    // have a designed recovery that depends on seeing the status.
    const api = createStubClient(async () => {
      throw googleError(404, "notFound");
    });

    await assert.rejects(api.history.list({ startHistoryId: "1" }), (error) => {
      assert.equal(error.httpStatus, 404);
      assert.equal(error.retryable, false);
      return true;
    });
  });

  test("a dropped connection is retried", async () => {
    let attempts = 0;
    const api = createStubClient(async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("socket hang up");
        error.code = "ECONNRESET";
        throw error;
      }
      return { data: { ok: true } };
    });

    await api.getProfile();
    assert.equal(attempts, 2);
  });

  test("Retry-After is honoured over the computed backoff", () => {
    const wait = client.backoffFor(
      1,
      googleError(429, "rateLimitExceeded", { headers: { "retry-after": "7" } }),
    );
    assert.equal(wait, 7000);
  });

  test("the backoff is jittered and capped", () => {
    const waits = Array.from({ length: 20 }, () =>
      client.backoffFor(10, googleError(429, "rateLimitExceeded")),
    );
    // Capped, so a long outage does not produce a half-hour sleep.
    waits.forEach((wait) => assert.ok(wait <= 20000, `${wait} exceeded the cap`));
    // Jittered, because a mailbox that was just rate-limited is usually one
    // of several, and synchronized retries would collide again.
    assert.ok(new Set(waits).size > 1, "the backoff is not jittered");
  });

  test("Gmail's query language is passed through untouched", async () => {
    let seen = null;
    const api = createStubClient(async (config) => {
      seen = config;
      return { data: { messages: [] } };
    });

    await api.messages.list({ q: "from:x has:attachment older_than:2d" });
    assert.equal(seen.params.q, "from:x has:attachment older_than:2d");
    assert.match(seen.url, /\/users\/me\/messages$/);
  });

  test("a client without a token source is refused at construction", () => {
    assert.throws(
      () => client.createClient({}),
      /needs a getAccessToken function/,
    );
  });
});

test("the retry ceiling is respected", async () => {
  let attempts = 0;
  const api = client.createClient({
    getAccessToken: async () => "token",
    maxAttempts: 2,
    http: async () => {
      attempts += 1;
      throw googleError(503, "serviceUnavailable");
    },
  });

  await assert.rejects(api.getProfile(), /serviceUnavailable/);
  assert.equal(attempts, 2);
});

// ── Reading straight from Gmail ────────────────────────────────────────────

describe("the direct read path", () => {
  test("it is the default, and nothing is written down", () => {
    const saved = process.env.GMAIL_STORE_MESSAGES;
    delete process.env.GMAIL_STORE_MESSAGES;
    try {
      assert.equal(storage.keepsMessages(), false);
      assert.equal(storage.describe().mode, "direct");
      assert.equal(storage.describe().cacheDatabase, null);
    } finally {
      if (saved === undefined) delete process.env.GMAIL_STORE_MESSAGES;
      else process.env.GMAIL_STORE_MESSAGES = saved;
    }
  });

  test("the cache, when enabled, is local MongoDB and never Atlas", () => {
    // The whole point of the split: a mailbox cached in a hosted cluster is
    // a much bigger thing to be responsible for than the same rows on a
    // machine the operator controls.
    const saved = process.env.GMAIL_STORE_MESSAGES;
    process.env.GMAIL_STORE_MESSAGES = "true";
    try {
      assert.equal(storage.keepsMessages(), true);
      assert.equal(storage.describe().cacheDatabase, "local-mongodb");
    } finally {
      if (saved === undefined) delete process.env.GMAIL_STORE_MESSAGES;
      else process.env.GMAIL_STORE_MESSAGES = saved;
    }
  });

  test("our filters become Gmail's own query language", () => {
    assert.equal(
      directReader.queryFor({
        from: "jane@x.com",
        isUnread: true,
        hasAttachments: true,
      }),
      "from:jane@x.com is:unread has:attachment",
    );
  });

  test("a caller's own Gmail query is passed through untouched", () => {
    // It is a language Gmail implements; bolting our terms onto it would
    // change what the user typed.
    assert.equal(
      directReader.queryFor({ q: "from:bob older_than:2d", from: "jane" }),
      "from:bob older_than:2d",
    );
  });

  test("a date range is widened for Gmail and tightened afterwards", () => {
    // Gmail's date terms are day-granular and exclusive at the edges, so the
    // query asks for a day more on each side and the exact bounds are
    // applied to the rows. Being generous then exact is the only way to get
    // both.
    const query = directReader.queryFor({
      after: "2026-11-20T10:00:00Z",
      before: "2026-11-20T18:00:00Z",
    });
    assert.match(query, /after:2026\/11\/19/);
    assert.match(query, /before:2026\/11\/21/);

    const inside = { internalDate: "2026-11-20T12:00:00.000Z" };
    const tooEarly = { internalDate: "2026-11-20T09:00:00.000Z" };
    const tooLate = { internalDate: "2026-11-20T19:00:00.000Z" };
    const filter = {
      after: "2026-11-20T10:00:00Z",
      before: "2026-11-20T18:00:00Z",
    };

    assert.equal(directReader.withinBounds(inside, filter), true);
    assert.equal(directReader.withinBounds(tooEarly, filter), false);
    assert.equal(directReader.withinBounds(tooLate, filter), false);
  });

  test("a row with no date is never excluded by a date bound", () => {
    // Gmail always sends one; dropping a message over a missing field would
    // lose mail rather than filter it.
    assert.equal(
      directReader.withinBounds({ internalDate: null }, { after: "2026-01-01" }),
      true,
    );
  });

  test("the cursor round trips and a bad one is ignored", () => {
    const cursor = directReader.encodeCursor({
      v: 1,
      s: { acc1: { t: "page-2", o: 7, done: false } },
    });
    assert.deepEqual(directReader.decodeCursor(cursor).s.acc1, {
      t: "page-2",
      o: 7,
      done: false,
    });

    // A cursor we cannot read is treated as no cursor: refusing to show a
    // mailbox because a stale token came back would be worse.
    assert.equal(directReader.decodeCursor("not-a-cursor"), null);
    assert.equal(directReader.decodeCursor(null), null);
    // A cursor from a future shape is refused rather than misread.
    assert.equal(
      directReader.decodeCursor(
        Buffer.from(JSON.stringify({ v: 2 })).toString("base64url"),
      ),
      null,
    );
  });

  test("labels arrive as one value or several", () => {
    assert.deepEqual(directReader.labelsFor({ labelIds: "INBOX" }), ["INBOX"]);
    assert.deepEqual(directReader.labelsFor({ labelIds: ["A", "B"] }), [
      "A",
      "B",
    ]);
    assert.deepEqual(directReader.labelsFor({}), []);
  });

  test("a Gmail message becomes the same row shape the cache produced", () => {
    const row = directReader.toRow(
      rawMessage({ labelIds: ["INBOX", "UNREAD", "STARRED"] }),
      "acc-1",
    );

    assert.equal(row.accountId, "acc-1");
    assert.equal(row.subject, "Hello");
    assert.equal(row.from.email, "jane@x.com");
    assert.equal(row.isUnread, true);
    assert.equal(row.isStarred, true);
    assert.equal(row.isInInbox, true);
    assert.equal(row.isSent, false);
    // An ISO string, not a Date: it goes straight out as JSON.
    assert.equal(typeof row.internalDate, "string");
  });

  test("a list row carries a small body and not a large one", () => {
    const small = directReader.toRow(rawMessage({ text: "short" }), "acc-1");
    assert.equal(small.bodyText, "short");
    assert.equal(small.bodyTruncated, false);

    const huge = directReader.toRow(
      rawMessage({
        text: "x".repeat(directReader.MAX_PREVIEW_BODY_BYTES + 1),
      }),
      "acc-1",
    );
    assert.equal(huge.bodyText, null);
    assert.equal(huge.bodyTruncated, true);
  });

  test("an opened message keeps its body whatever the size", () => {
    const row = directReader.toRow(
      rawMessage({
        text: "x".repeat(directReader.MAX_PREVIEW_BODY_BYTES + 1),
      }),
      "acc-1",
      { withBody: true },
    );
    assert.ok(row.bodyText.length > directReader.MAX_PREVIEW_BODY_BYTES);
  });

  test("a thread is summarized from rows already fetched", () => {
    // Saves re-walking the MIME of a conversation we just read in full.
    const rows = [
      directReader.toRow(
        rawMessage({ id: "m1", subject: "Hello", labelIds: ["INBOX"] }),
        "acc-1",
      ),
      directReader.toRow(
        rawMessage({
          id: "m2",
          subject: "Re: Hello",
          labelIds: ["INBOX", "UNREAD"],
          internalDate: "1764100000000",
        }),
        "acc-1",
      ),
    ];

    const summary = directReader.summarizeThreadFromRows(
      "t1",
      "9999",
      rows,
      "acc-1",
    );

    assert.equal(summary.subject, "Hello", "the first message's subject");
    assert.equal(summary.messageCount, 2);
    assert.equal(summary.unreadCount, 1);
    assert.equal(summary.lastMessageGmailId, "m2");
    assert.equal(summary.isTrashed, false);
  });

  test("an empty thread summarizes to nothing rather than throwing", () => {
    const summary = directReader.summarizeThreadFromRows("t1", null, [], "a");
    assert.equal(summary.messageCount, 0);
    assert.equal(summary.lastMessageAt, null);
  });
});

// ── Filtering a list ───────────────────────────────────────────────────────

describe("building a message filter", () => {
  const scope = { userId: "507f1f77bcf86cd799439011" };
  const query = (options) => messageService.buildQuery(scope, options);

  test("labels arrive either repeated or comma separated", () => {
    // `?labelIds=INBOX,UNREAD` is what a hand-written URL looks like.
    // Treating it as one label id returns nothing, which reads as "no mail"
    // rather than as a mistake.
    assert.deepEqual(query({ labelIds: "INBOX,UNREAD" }).labelIds, {
      $all: ["INBOX", "UNREAD"],
    });
    assert.deepEqual(query({ labelIds: ["INBOX", "UNREAD"] }).labelIds, {
      $all: ["INBOX", "UNREAD"],
    });
    assert.deepEqual(query({ labelIds: " INBOX , UNREAD " }).labelIds, {
      $all: ["INBOX", "UNREAD"],
    });
  });

  test("a message must carry every label asked for, not any of them", () => {
    // `$all`, not `$in`: "unread in the inbox" is one filter, not two.
    assert.deepEqual(query({ labelIds: ["INBOX", "UNREAD"] }).labelIds.$all, [
      "INBOX",
      "UNREAD",
    ]);
  });

  test("the trash and spam are out of a list unless asked for", () => {
    // The same default Gmail applies, and the reason "where did my deleted
    // mail go" is not a question this API provokes.
    const plain = query({});
    assert.equal(plain.isTrashed, false);
    assert.equal(plain.isSpam, false);
  });

  test("asking for the trash does not then exclude it", () => {
    const trash = query({ labelIds: "TRASH" });
    assert.equal(trash.isTrashed, undefined);
    // Spam is still excluded: they are separate requests.
    assert.equal(trash.isSpam, false);
  });

  test("includeTrash lifts the exclusion without naming the label", () => {
    assert.equal(query({ includeTrash: true }).isTrashed, undefined);
  });

  test("a search term cannot act as a regular expression", () => {
    // A user typing "a.*b" or "(" must get a search, not a scan or a crash.
    const built = query({ search: "a.*b(" });
    const pattern = built.$or[0].subject;
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.test("a.*b("), "the term is not matched literally");
    assert.ok(!pattern.test("axxb"), "the term was treated as a pattern");
  });

  test("a date range is translated to one bounded condition", () => {
    const built = query({
      after: "2026-01-01T00:00:00Z",
      before: "2026-02-01T00:00:00Z",
    });
    assert.ok(built.internalDate.$gte instanceof Date);
    assert.ok(built.internalDate.$lte instanceof Date);
  });

  test("an unparseable date is ignored rather than matching nothing", () => {
    // `new Date("last tuesday")` is Invalid Date, and a filter built from
    // one silently returns an empty mailbox.
    assert.equal(query({ after: "last tuesday" }).internalDate, undefined);
  });

  test("the owner is always part of the filter", () => {
    // The condition that makes it impossible to read another user's mail
    // even with a correct account id.
    assert.equal(query({ labelIds: "INBOX" }).userId, scope.userId);
  });
});
