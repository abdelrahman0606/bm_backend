const { test, describe } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../../config.env") });

const {
  readPositiveInt,
  isRetryableAtlasError,
  connectAtlasWithRetry,
  ATLAS_STARTUP_ATTEMPTS,
  ATLAS_RETRY_BASE_DELAY_MS,
  ATLAS_RETRY_MAX_DELAY_MS,
  ATLAS_URI_ENV,
} = require("./database.manager");

/**
 * Guards the bounded Atlas startup retry.
 *
 * The whole point of the retry is that a momentary DNS failure — an SRV lookup
 * that resolves while the follow-up lookup for one shard host does not — must
 * cost a few seconds of startup instead of aborting the process, while a
 * rejected credential still fails immediately. Both halves are checked here.
 *
 * Nothing in this file touches Atlas data: the loop cases point the URI at a
 * host that cannot resolve, so every attempt fails before any connection is
 * established.
 */

/** A host that no resolver can answer for, so every attempt fails on DNS. */
const UNRESOLVABLE_URI =
  "mongodb://nonexistent-host-xyz123.invalid:27017/bm?serverSelectionTimeoutMS=500";

const named = (name, message) => Object.assign(new Error(message), { name });

/** Runs `fn` with the Atlas URI and retry knobs overridden, then restores them. */
const withEnv = async (overrides, fn) => {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

describe("Atlas startup retry", () => {
  // 1. The failures that pass on their own are the ones that get another try
  test("transient DNS, network and selection failures are retryable", () => {
    const retryable = [
      named(
        "MongooseServerSelectionError",
        "getaddrinfo ENOTFOUND ac-g9zvqie-shard-00-01.znydqpd.mongodb.net",
      ),
      named(
        "MongoServerSelectionError",
        "getaddrinfo EAI_AGAIN cluster0.mongodb.net",
      ),
      named("MongoNetworkError", "connection 1 to shard-00-00 closed"),
      named("MongoNetworkTimeoutError", "connection timed out"),
      named(
        "Error",
        "querySrv ETIMEDOUT _mongodb._tcp.cluster0.znydqpd.mongodb.net",
      ),
      named("Error", "connect ECONNREFUSED 159.41.89.122:27017"),
      named("Error", "read ECONNRESET"),
    ];

    for (const err of retryable) {
      assert.strictEqual(
        isRetryableAtlasError(err),
        true,
        `${err.name} / ${err.message} must be retried`,
      );
    }
  });

  // 2. A failure that will repeat identically must not delay the operator
  test("rejected credentials and unparseable URIs are not retryable", () => {
    const fatal = [
      named("MongoServerError", "bad auth : authentication failed"),
      named(
        "MongooseServerSelectionError",
        "bad auth : Authentication failed.",
      ),
      named("MongoServerError", "Authentication failed."),
      named("MongoError", "not authorized on bm to execute command"),
      named("MongoParseError", "Invalid scheme, expected connection string"),
    ];

    for (const err of fatal) {
      assert.strictEqual(
        isRetryableAtlasError(err),
        false,
        `${err.name} / ${err.message} must fail fast`,
      );
    }
  });

  // 3. An error with nothing transient about it is not retried either
  test("an unrecognised error is not retried", () => {
    assert.strictEqual(
      isRetryableAtlasError(named("TypeError", "x is not a function")),
      false,
    );
    assert.strictEqual(isRetryableAtlasError(undefined), false);
  });

  // 4. The loop stops after the configured number of attempts
  test("a retryable failure is retried the configured number of times, then throws", async () => {
    await withEnv(
      {
        [ATLAS_URI_ENV]: UNRESOLVABLE_URI,
        MONGODB_ATLAS_STARTUP_ATTEMPTS: "3",
        MONGODB_ATLAS_STARTUP_RETRY_DELAY_MS: "10",
      },
      async () => {
        const seen = [];
        const realError = console.error;
        const realLog = console.log;
        console.error = (line) => seen.push(String(line));
        console.log = (line) => seen.push(String(line));

        try {
          await assert.rejects(() => connectAtlasWithRetry(), /ENOTFOUND/);
        } finally {
          console.error = realError;
          console.log = realLog;
        }

        const attempts = seen.filter((line) =>
          /Atlas attempt \d+\/3 failed/.test(line),
        );
        assert.strictEqual(
          attempts.length,
          2,
          "attempts 1 and 2 are announced as retries; the third throws instead",
        );
        assert.match(attempts[0], /attempt 1\/3/);
        assert.match(attempts[1], /attempt 2\/3/);

        const waits = seen
          .filter((line) => /retrying Atlas in/.test(line))
          .map((line) => Number(line.match(/in (\d+)ms/)[1]));
        assert.deepStrictEqual(
          waits,
          [10, 20],
          "the delay doubles between attempts",
        );
      },
    );
  });

  // 5. One attempt is the old fail-on-first-error behaviour, still available
  test("MONGODB_ATLAS_STARTUP_ATTEMPTS=1 never retries", async () => {
    await withEnv(
      {
        [ATLAS_URI_ENV]: UNRESOLVABLE_URI,
        MONGODB_ATLAS_STARTUP_ATTEMPTS: "1",
        MONGODB_ATLAS_STARTUP_RETRY_DELAY_MS: undefined,
      },
      async () => {
        const seen = [];
        const realError = console.error;
        const realLog = console.log;
        console.error = (line) => seen.push(String(line));
        console.log = (line) => seen.push(String(line));

        try {
          await assert.rejects(() => connectAtlasWithRetry(), /ENOTFOUND/);
        } finally {
          console.error = realError;
          console.log = realLog;
        }

        assert.strictEqual(
          seen.filter((line) => /retrying Atlas/.test(line)).length,
          0,
          "a single attempt must announce no retry",
        );
      },
    );
  });

  // 6. A misconfigured knob must not silently become 0 attempts or a tight loop
  test("an unusable retry setting is reported and falls back to the default", async () => {
    const seen = [];
    const realError = console.error;
    console.error = (line) => seen.push(String(line));

    try {
      await withEnv(
        {
          BAD_KNOB: "abc",
          ZERO_KNOB: "0",
          NEGATIVE_KNOB: "-5",
          FRACTIONAL_KNOB: "1.5",
          EMPTY_KNOB: "",
          GOOD_KNOB: "7",
        },
        () => {
          // Unusable values fall back, and say so by name.
          assert.strictEqual(readPositiveInt("BAD_KNOB", 5), 5);
          assert.strictEqual(readPositiveInt("ZERO_KNOB", 1000), 1000);
          assert.strictEqual(readPositiveInt("NEGATIVE_KNOB", 1000), 1000);
          assert.strictEqual(readPositiveInt("FRACTIONAL_KNOB", 5), 5);
          // An unset or empty value is not a misconfiguration, so it is silent.
          assert.strictEqual(readPositiveInt("EMPTY_KNOB", 5), 5);
          assert.strictEqual(readPositiveInt("UNSET_KNOB_XYZ", 5), 5);
          // A usable value wins over the default.
          assert.strictEqual(readPositiveInt("GOOD_KNOB", 5), 7);
        },
      );
    } finally {
      console.error = realError;
    }

    for (const knob of [
      "BAD_KNOB",
      "ZERO_KNOB",
      "NEGATIVE_KNOB",
      "FRACTIONAL_KNOB",
    ]) {
      assert.ok(
        seen.some(
          (line) =>
            line.includes(`ignoring ${knob}=`) && /positive integer/.test(line),
        ),
        `${knob} must be reported by name when it is unusable`,
      );
    }
    assert.strictEqual(
      seen.filter((line) => /ignoring (EMPTY|UNSET|GOOD)_KNOB/.test(line))
        .length,
      0,
      "an unset, empty or usable value must not be reported as a problem",
    );
    assert.strictEqual(
      seen.filter((line) => /ignoring ZERO_KNOB="0".*using 1000/.test(line))
        .length,
      1,
      "a zero delay falls back to 1000ms, so the loop never spins",
    );
  });

  // 7. The defaults are the ones the setup guide documents
  test("the documented defaults are the ones in force", () => {
    assert.strictEqual(ATLAS_STARTUP_ATTEMPTS, 5);
    assert.strictEqual(ATLAS_RETRY_BASE_DELAY_MS, 1000);
    assert.strictEqual(ATLAS_RETRY_MAX_DELAY_MS, 8000);

    // 1s, 2s, 4s, 8s — the cap is reached, never exceeded, within the defaults.
    const waits = [];
    for (let attempt = 1; attempt < ATLAS_STARTUP_ATTEMPTS; attempt += 1) {
      waits.push(
        Math.min(
          ATLAS_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
          ATLAS_RETRY_MAX_DELAY_MS,
        ),
      );
    }
    assert.deepStrictEqual(waits, [1000, 2000, 4000, 8000]);
    assert.ok(
      waits.reduce((a, b) => a + b, 0) <= 15000,
      "a spent retry budget must still abort startup promptly",
    );
  });
});
