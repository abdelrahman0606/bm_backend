const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const http = require("node:http");
const { URL } = require("url");
const express = require("express");
const jwt = require("jsonwebtoken");

// Credentials have to exist before the service reads them.
process.env.GOOGLE_CLIENT_ID_DESKTOP = "desktop-client-id";
process.env.GOOGLE_CLIENT_SECRET_DESKTOP = "desktop-secret";
process.env.GOOGLE_CLIENT_ID_WEB = "web-client-id";
process.env.GOOGLE_CLIENT_SECRET_WEB = "web-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URIS =
  "https://app.example.com/oauth/callback,https://staging.example.com/cb";
// authService reads this at module load, so it has to be set before the
// routes below are required.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const googleOAuth = require("./googleOAuthService");
const googleAccountService = require("./googleAccountService");
const { ACCESS_LEVELS } = require("./googleAccountModel");
const authRoute = require("./authRoute");

test("every access level maps to exactly one Drive scope", () => {
  assert.deepStrictEqual(ACCESS_LEVELS, ["appOnly", "full", "readOnly"]);

  assert.ok(
    googleOAuth
      .scopesForLevel("appOnly")
      .includes("https://www.googleapis.com/auth/drive.file"),
  );
  assert.ok(
    googleOAuth
      .scopesForLevel("full")
      .includes("https://www.googleapis.com/auth/drive"),
  );
  assert.ok(
    googleOAuth
      .scopesForLevel("readOnly")
      .includes("https://www.googleapis.com/auth/drive.readonly"),
  );

  ACCESS_LEVELS.forEach((level) => {
    const scopes = googleOAuth.scopesForLevel(level);
    googleOAuth.IDENTITY_SCOPES.forEach((identity) => {
      assert.ok(scopes.includes(identity), `${level} is missing ${identity}`);
    });
    // One Drive scope, never two.
    const driveScopes = scopes.filter((scope) => scope.includes("/auth/drive"));
    assert.strictEqual(driveScopes.length, 1);
  });
});

test("an unknown access level is refused", () => {
  assert.throws(() => googleOAuth.scopesForLevel("everything"), /Unknown access level/);
});

test("the level is read back from the scopes Google granted", () => {
  assert.strictEqual(
    googleOAuth.levelFromScopes(googleOAuth.scopesForLevel("full")),
    "full",
  );
  assert.strictEqual(
    googleOAuth.levelFromScopes(googleOAuth.scopesForLevel("readOnly")),
    "readOnly",
  );
  assert.strictEqual(
    googleOAuth.levelFromScopes(googleOAuth.scopesForLevel("appOnly")),
    "appOnly",
  );
  // Nothing granted falls back to the least privileged, never to full.
  assert.strictEqual(googleOAuth.levelFromScopes([]), "appOnly");
  assert.strictEqual(googleOAuth.levelFromScopes(), "appOnly");
});

test("a user who unticks the full scope is recorded at what they granted", () => {
  const asked = googleOAuth.scopesForLevel("full");
  const granted = asked.filter(
    (scope) => scope !== "https://www.googleapis.com/auth/drive",
  );
  granted.push("https://www.googleapis.com/auth/drive.readonly");
  assert.strictEqual(googleOAuth.levelFromScopes(granted), "readOnly");
});

test("desktop redirects must be loopback", () => {
  ["http://127.0.0.1:53682", "http://localhost:8080", "http://127.0.0.1:1/"].forEach(
    (uri) => {
      assert.ok(googleOAuth.assertRedirectAllowed(uri, true), uri);
    },
  );

  // The check that stops this endpoint being used to steal an auth code.
  [
    "https://evil.example.com/cb",
    "http://evil.example.com/cb",
    "http://127.0.0.1.evil.com/cb",
    "https://127.0.0.1:443",
  ].forEach((uri) => {
    assert.throws(
      () => googleOAuth.assertRedirectAllowed(uri, true),
      /loopback/,
      uri,
    );
  });
});

test("a desktop redirect may not carry a query or fragment", () => {
  assert.throws(
    () => googleOAuth.assertRedirectAllowed("http://127.0.0.1:5000?next=x", true),
    /query or fragment/,
  );
});

test("web redirects must be on the configured allow list", () => {
  assert.strictEqual(
    googleOAuth.assertRedirectAllowed(
      "https://app.example.com/oauth/callback",
      false,
    ),
    "https://app.example.com/oauth/callback",
  );
  assert.throws(
    () =>
      googleOAuth.assertRedirectAllowed("https://evil.example.com/cb", false),
    /allow list/,
  );
});

test("a malformed redirect is rejected before anything else", () => {
  assert.throws(
    () => googleOAuth.assertRedirectAllowed("not a url", true),
    /valid URL/,
  );
});

test("PKCE challenge is the base64url SHA-256 of the verifier", () => {
  const verifier = googleOAuth.createCodeVerifier();
  const expected = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  assert.strictEqual(googleOAuth.challengeFor(verifier), expected);
  assert.notStrictEqual(googleOAuth.challengeFor(verifier), verifier);
  // No padding or characters that would need escaping in a URL.
  assert.match(googleOAuth.challengeFor(verifier), /^[A-Za-z0-9_-]+$/);
});

test("verifiers and states are unique per flow", () => {
  const verifiers = new Set();
  const states = new Set();
  for (let i = 0; i < 50; i += 1) {
    verifiers.add(googleOAuth.createCodeVerifier());
    states.add(googleOAuth.createState());
  }
  assert.strictEqual(verifiers.size, 50);
  assert.strictEqual(states.size, 50);
});

test("the consent URL asks for offline access, so a refresh token comes back", () => {
  const { url } = googleOAuth.buildConsentUrl({
    accessLevel: "full",
    platform: "windows",
    redirectUri: "http://127.0.0.1:53682",
    state: "state-123",
    codeChallenge: "challenge-123",
    loginHint: "someone@example.com",
  });

  const parsed = new URL(url);
  assert.strictEqual(parsed.origin + parsed.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.strictEqual(parsed.searchParams.get("client_id"), "desktop-client-id");
  assert.strictEqual(parsed.searchParams.get("response_type"), "code");
  // Without access_type=offline Google issues no refresh token and the
  // account would die after an hour.
  assert.strictEqual(parsed.searchParams.get("access_type"), "offline");
  assert.match(parsed.searchParams.get("prompt"), /consent/);
  assert.match(parsed.searchParams.get("prompt"), /select_account/);
  assert.strictEqual(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.strictEqual(parsed.searchParams.get("code_challenge"), "challenge-123");
  assert.strictEqual(parsed.searchParams.get("state"), "state-123");
  assert.strictEqual(
    parsed.searchParams.get("login_hint"),
    "someone@example.com",
  );
  assert.match(parsed.searchParams.get("scope"), /auth\/drive$/);
});

test("the web consent URL uses the web client", () => {
  const { url } = googleOAuth.buildConsentUrl({
    accessLevel: "readOnly",
    platform: "web",
    redirectUri: "https://app.example.com/oauth/callback",
    state: "s",
    codeChallenge: "c",
  });
  assert.strictEqual(
    new URL(url).searchParams.get("client_id"),
    "web-client-id",
  );
});

test("a missing client secret fails loudly instead of at Google", () => {
  const saved = process.env.GOOGLE_CLIENT_SECRET_DESKTOP;
  delete process.env.GOOGLE_CLIENT_SECRET_DESKTOP;
  try {
    assert.throws(
      () => googleOAuth.credentialsFor("windows"),
      /GOOGLE_CLIENT_SECRET_DESKTOP/,
    );
  } finally {
    process.env.GOOGLE_CLIENT_SECRET_DESKTOP = saved;
  }
});

test("starting a flow keeps the verifier server-side", async () => {
  const saved = [];
  const store = {
    create: async (doc) => {
      saved.push(doc);
      return doc;
    },
  };

  const result = await googleOAuth.startConsent({
    accessLevel: "appOnly",
    platform: "windows",
    redirectUri: "http://127.0.0.1:49200",
    userId: "user-1",
    store,
  });

  assert.strictEqual(saved.length, 1);
  const record = saved[0];

  // The verifier is stored but never handed out, and never put in the URL.
  assert.ok(record.codeVerifier);
  assert.strictEqual(result.codeVerifier, undefined);
  assert.ok(!result.url.includes(record.codeVerifier));
  assert.strictEqual(
    new URL(result.url).searchParams.get("code_challenge"),
    googleOAuth.challengeFor(record.codeVerifier),
  );

  // The redirect URI is recorded, because the exchange has to repeat it
  // exactly and must not take the client's word for it a second time.
  assert.strictEqual(record.redirectUri, "http://127.0.0.1:49200/");
  assert.strictEqual(record.state, result.state);
  assert.strictEqual(record.userId, "user-1");
  assert.ok(record.expiresAt instanceof Date);
  assert.ok(record.expiresAt.getTime() > Date.now());
});

test("starting a flow refuses a redirect it would not allow", async () => {
  const store = { create: async () => assert.fail("should not be stored") };
  await assert.rejects(
    googleOAuth.startConsent({
      accessLevel: "full",
      platform: "windows",
      redirectUri: "https://evil.example.com/cb",
      userId: "user-1",
      store,
    }),
    /loopback/,
  );
});

test("the accounts query scopes every read to one user", () => {
  const query = googleAccountService.buildQuery("user-1", {});
  assert.deepStrictEqual(query, { userId: "user-1" });
});

test("search matches the email or the name, case insensitively", () => {
  const query = googleAccountService.buildQuery("user-1", { search: "Ahmed" });
  assert.strictEqual(query.$or.length, 2);
  assert.ok(query.$or[0].email instanceof RegExp);
  assert.strictEqual(query.$or[0].email.flags, "i");
  assert.ok(query.$or[0].email.test("ahmed@example.com"));
  assert.ok(query.$or[1].displayName.test("AHMED ALI"));
});

test("a search term cannot smuggle in a regular expression", () => {
  const query = googleAccountService.buildQuery("user-1", {
    search: ".*",
  });
  // Escaped, so it matches the literal characters and not everything.
  assert.ok(!query.$or[0].email.test("anyone@example.com"));
  assert.ok(query.$or[0].email.test("a.*b@example.com"));
});

test("an empty search adds no condition", () => {
  assert.strictEqual(
    googleAccountService.buildQuery("user-1", { search: "   " }).$or,
    undefined,
  );
});

test("status maps onto the stored flags", () => {
  assert.strictEqual(
    googleAccountService.buildQuery("u", { status: "connected" }).needsReauth,
    false,
  );
  assert.strictEqual(
    googleAccountService.buildQuery("u", { status: "needsLogin" }).needsReauth,
    true,
  );
  assert.strictEqual(
    googleAccountService.buildQuery("u", { status: "hidden" }).isEnabled,
    false,
  );
  const any = googleAccountService.buildQuery("u", { status: "any" });
  assert.strictEqual(any.needsReauth, undefined);
  assert.strictEqual(any.isEnabled, undefined);
});

test("level and provider filters accept one value or many", () => {
  assert.deepStrictEqual(
    googleAccountService.buildQuery("u", { accessLevel: "full" }).accessLevel,
    { $in: ["full"] },
  );
  assert.deepStrictEqual(
    googleAccountService.buildQuery("u", {
      accessLevel: ["full", "readOnly"],
    }).accessLevel,
    { $in: ["full", "readOnly"] },
  );
  assert.deepStrictEqual(
    googleAccountService.buildQuery("u", { provider: "google" }).provider,
    { $in: ["google"] },
  );
});

test("sort orders put the upload account first by default", () => {
  const sort = googleAccountService.SORT_FIELDS.primaryFirst;
  assert.strictEqual(sort.isPrimary, -1);
  assert.strictEqual(sort.sortIndex, 1);
  // Every order ends on a stable tiebreaker, or a paginated list would
  // repeat or skip rows between pages.
  Object.keys(googleAccountService.SORT_FIELDS).forEach((name) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        googleAccountService.SORT_FIELDS[name],
        "email",
      ),
      `${name} has no stable tiebreaker`,
    );
  });
});

test("page size is clamped to something a client cannot abuse", () => {
  assert.strictEqual(googleAccountService.DEFAULT_PAGE_SIZE, 15);
  assert.strictEqual(googleAccountService.MAX_PAGE_SIZE, 100);
});

// ── login consent ──────────────────────────────────────────────────────────
// Signing in needs an identity, not a Drive grant, so this flow differs on
// purpose: identity scopes only, and no offline access to leave behind.

test("a login flow asks for identity scopes and nothing else", async () => {
  const saved = [];
  const store = {
    create: async (doc) => {
      saved.push(doc);
      return doc;
    },
  };

  const result = await googleOAuth.startLoginConsent({
    platform: "windows",
    redirectUri: "http://127.0.0.1:49999",
    store,
  });

  const params = new URL(result.url).searchParams;
  const scopes = params.get("scope").split(" ");
  assert.deepStrictEqual(scopes.sort(), [...googleOAuth.IDENTITY_SCOPES].sort());
  // No Drive scope sneaks into a login.
  assert.ok(!scopes.some((scope) => scope.includes("/auth/drive")));
});

test("a login flow asks for no refresh token", async () => {
  const store = { create: async (doc) => doc };
  const result = await googleOAuth.startLoginConsent({
    platform: "windows",
    redirectUri: "http://127.0.0.1:49999",
    store,
  });
  const params = new URL(result.url).searchParams;
  // Offline access would leave a long-lived grant behind for a flow that
  // reads the id token once.
  assert.strictEqual(params.get("access_type"), null);
  assert.strictEqual(params.get("prompt"), "select_account");
});

test("a login flow is recorded as a login, with no owner", async () => {
  const saved = [];
  const store = {
    create: async (doc) => {
      saved.push(doc);
      return doc;
    },
  };

  await googleOAuth.startLoginConsent({
    platform: "windows",
    redirectUri: "http://127.0.0.1:49999",
    store,
  });

  const record = saved[0];
  // The purpose is what stops this state being spent on a Drive connection,
  // and there is no user yet to own it.
  assert.strictEqual(record.purpose, "login");
  assert.strictEqual(record.userId, null);
  assert.strictEqual(record.accessLevel, null);
  assert.ok(record.codeVerifier);
  assert.ok(record.expiresAt.getTime() > Date.now());
});

test("a drive flow is still recorded as a drive flow", async () => {
  const saved = [];
  const store = {
    create: async (doc) => {
      saved.push(doc);
      return doc;
    },
  };

  await googleOAuth.startConsent({
    accessLevel: "full",
    platform: "windows",
    redirectUri: "http://127.0.0.1:49998",
    userId: "user-1",
    store,
  });

  assert.strictEqual(saved[0].purpose, "drive");
  assert.strictEqual(saved[0].userId, "user-1");
  assert.strictEqual(saved[0].accessLevel, "full");
  // The state is an opaque URL-safe token, not something parseable.
  assert.match(saved[0].state, /^[A-Za-z0-9_-]+$/);
});

test("a login redirect is checked exactly like a drive one", async () => {
  const store = { create: async () => assert.fail("should not be stored") };
  await assert.rejects(
    googleOAuth.startLoginConsent({
      platform: "windows",
      redirectUri: "https://evil.example.com/cb",
      store,
    }),
    /loopback/,
  );
});


// ── routing ────────────────────────────────────────────────────────────────
// Mounted inside the existing auth router, so these check two things the
// unit tests cannot: that the paths compose to what the client will call,
// and that the login route above the mount still keeps its own handler.

const request = (server, method, path, token) =>
  new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end("{}");
  });

const withServer = async (run) => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRoute);
  // Mirrors server.js: anything unmatched answers, rather than hanging.
  app.use((req, res) => {
    res.status(404).json({ success: false });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    await run(server);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
};

test("the google oauth routes are reachable and require a token", async () => {
  await withServer(async (server) => {
    const calls = [
      ["POST", "/api/v1/auth/google/oauth/url"],
      ["POST", "/api/v1/auth/google/oauth/exchange"],
      ["GET", "/api/v1/auth/google/accounts"],
    ];
    const results = await Promise.all(
      calls.map(([method, path]) => request(server, method, path)),
    );
    results.forEach((res, index) => {
      // 401 rather than 404 proves the route exists behind the auth guard.
      assert.strictEqual(
        res.status,
        401,
        `${calls[index][0]} ${calls[index][1]} -> ${res.status}`,
      );
    });
  });
});

test("mounting the sub-router leaves the google login route alone", async () => {
  await withServer(async (server) => {
    const res = await request(server, "POST", "/api/v1/auth/google");
    // The login validator rejects a body with no token: 400, and crucially
    // not 401 (which would mean the authenticated sub-router swallowed it)
    // and not 404.
    assert.strictEqual(res.status, 400);
    assert.match(res.body, /Google token/);
  });
});

test("a signed-in caller reaches the validator, not a 404", async () => {
  await withServer(async (server) => {
    const token = jwt.sign(
      { id: "507f1f77bcf86cd799439011" },
      process.env.JWT_SECRET,
    );
    const res = await request(
      server,
      "POST",
      "/api/v1/auth/google/oauth/url",
      token,
    );
    // Empty body: the validator complains about the required fields.
    assert.strictEqual(res.status, 400);
    assert.match(res.body, /accessLevel|redirectUri/);
  });
});

test("the login routes are public, unlike the drive ones", async () => {
  await withServer(async (server) => {
    // No token: the login endpoints must still be reached, or a user could
    // never sign in. This is what the mount order above them guarantees.
    const results = await Promise.all([
      request(server, "POST", "/api/v1/auth/google/login/url"),
      request(server, "POST", "/api/v1/auth/google/login/exchange"),
    ]);
    results.forEach((res) => {
      // 400 from the validator, not 401 from the guard and not 404.
      assert.strictEqual(res.status, 400, res.body);
    });
    assert.match(results[0].body, /redirectUri/);
    assert.match(results[1].body, /state|code/);
  });
});

test("the drive routes stay guarded after mounting the login ones", async () => {
  await withServer(async (server) => {
    const res = await request(
      server,
      "POST",
      "/api/v1/auth/google/oauth/url",
    );
    assert.strictEqual(res.status, 401);
  });
});

test("a login url request is refused for a non-loopback redirect", async () => {
  await withServer(async (server) => {
    const res = await new Promise((resolve, reject) => {
      const { port } = server.address();
      const payload = JSON.stringify({
        platform: "windows",
        redirectUri: "https://evil.example.com/cb",
      });
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/api/v1/auth/google/login/url",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () =>
            resolve({ status: response.statusCode, body }),
          );
        },
      );
      req.on("error", reject);
      req.end(payload);
    });

    // The redirect check runs before anything touches the database, so this
    // is refused without a connection and without storing a state.
    assert.strictEqual(res.status, 400, res.body);
    assert.match(res.body, /loopback/);
  });
});

// ── failure reporting ──────────────────────────────────────────────────────
// A token that cannot be verified used to surface as a bare 502. These cover
// the claims peek that explains why, which is decode-only and never trusted
// to establish identity.

const makeIdToken = (claims) => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
};

test("the claims peek reads audience, expiry and email presence", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const claims = googleOAuth.peekIdTokenClaims(
    makeIdToken({
      aud: "desktop-client-id",
      iss: "https://accounts.google.com",
      exp: future,
      email: "someone@example.com",
    }),
  );

  assert.strictEqual(claims.aud, "desktop-client-id");
  assert.strictEqual(claims.iss, "https://accounts.google.com");
  assert.strictEqual(claims.expired, false);
  assert.strictEqual(claims.hasEmail, true);
});

test("a token that is not a token peeks to null, not a throw", () => {
  assert.strictEqual(googleOAuth.peekIdTokenClaims("garbage"), null);
  assert.strictEqual(googleOAuth.peekIdTokenClaims(""), null);
  assert.strictEqual(googleOAuth.peekIdTokenClaims("a.b.c"), null);
});

test("an audience from another client id is named in the description", () => {
  const described = googleOAuth.describeIdToken(
    makeIdToken({
      aud: "someone-elses-client-id",
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: "a@b.c",
    }),
  );
  assert.match(described, /audience/);
  assert.match(described, /someone-elses-client-id/);
});

test("the configured client ids are recognised as ours", () => {
  const described = googleOAuth.describeIdToken(
    makeIdToken({
      aud: "desktop-client-id",
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: "a@b.c",
    }),
  );
  // Nothing to report: the audience is one of ours and it has not expired.
  assert.match(described, /no obvious problem/);
  assert.ok(googleOAuth.allConfiguredClientIds().includes("desktop-client-id"));
});

test("an expired token and a missing email are both called out", () => {
  const described = googleOAuth.describeIdToken(
    makeIdToken({
      aud: "desktop-client-id",
      exp: Math.floor(Date.now() / 1000) - 60,
    }),
  );
  assert.match(described, /expired/);
  assert.match(described, /no email claim/);
});

test("a garbage token says so rather than inventing a reason", () => {
  assert.match(
    googleOAuth.describeIdToken("not-a-token"),
    /could not be decoded/,
  );
});
