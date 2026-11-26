const { test, describe } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const mime = require("./gmailMime");
const scopes = require("./gmailScopes");
// Reads its key from the environment on every call, so the per-test
// `withKeys` below is enough and the module can be required once here.
const box = require("../../core/security/secretBox");

/**
 * The parts of the Gmail feature that are pure string and crypto work:
 * building and reading real messages, the scope/capability table, and the
 * seal on stored refresh tokens.
 *
 * These are tested hardest because they are where a mistake is both likely
 * and invisible. A mis-encoded subject is not a crash — it is a message the
 * recipient receives as mojibake. A `Bcc` that survives is a privacy breach
 * that looks like a working send. A reply without `In-Reply-To` threads
 * correctly in Gmail and nowhere else, so it passes a casual test and fails
 * in the field.
 */

// ── Reading what Gmail returns ─────────────────────────────────────────────

describe("parsing addresses", () => {
  test("a comma inside a quoted display name is not a separator", () => {
    // The classic bug: splitting on "," turns one recipient into two, and
    // the mail goes to an address that does not exist.
    const parsed = mime.parseAddressList(
      '"Doe, Jane" <jane@x.com>, bob@y.com',
    );
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[0], { name: "Doe, Jane", email: "jane@x.com" });
    assert.deepEqual(parsed[1], { name: null, email: "bob@y.com" });
  });

  test("a non-ASCII display name is decoded", () => {
    const parsed = mime.parseAddressList(
      "=?UTF-8?B?2LnYqtin2Kg=?= <a@z.com>",
    );
    assert.equal(parsed[0].name, "عتاب");
  });

  test("quoted-printable encoded words are decoded too", () => {
    assert.equal(
      mime.decodeEncodedWords("=?UTF-8?Q?caf=C3=A9_bar?="),
      "café bar",
    );
  });

  test("addresses are lowercased, so a contact is one contact", () => {
    assert.equal(mime.parseAddress("Jane <JANE@X.COM>").email, "jane@x.com");
  });

  test("something that is not an address is dropped, not guessed at", () => {
    assert.equal(mime.parseAddress("no-at-sign-here"), null);
    assert.deepEqual(mime.parseAddressList("garbage, also garbage"), []);
  });

  test("header lookup ignores case, as RFC 5322 requires", () => {
    const headers = [{ name: "SuBjEcT", value: "hello" }];
    assert.equal(mime.headerValue(headers, "subject"), "hello");
    assert.equal(mime.headerValue(null, "subject"), null);
  });
});

describe("walking a MIME tree", () => {
  const encode = (text) => Buffer.from(text, "utf8").toString("base64url");

  test("finds both bodies and the attachments through the nesting", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: encode("plain") } },
            { mimeType: "text/html", body: { data: encode("<p>rich</p>") } },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "invoice.pdf",
          body: { attachmentId: "ATT1", size: 2048 },
          headers: [
            { name: "Content-Disposition", value: "attachment" },
          ],
        },
      ],
    };

    const result = mime.walkParts(payload);
    assert.equal(result.text, "plain");
    assert.equal(result.html, "<p>rich</p>");
    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0].attachmentId, "ATT1");
    assert.equal(result.attachments[0].inline, false);
  });

  test("an inline image is recognised as inline, not as a file", () => {
    // It has no filename and belongs to the body. Treating it as an
    // attachment is what puts a paperclip on every HTML newsletter.
    const result = mime.walkParts({
      mimeType: "multipart/related",
      parts: [
        {
          mimeType: "image/png",
          filename: "",
          body: { attachmentId: "IMG", size: 120 },
          headers: [
            { name: "Content-ID", value: "<logo@bm>" },
            { name: "Content-Disposition", value: "inline" },
          ],
        },
      ],
    });

    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0].inline, true);
    assert.equal(result.attachments[0].contentId, "logo@bm");
  });

  test("deep nesting terminates instead of overflowing the stack", () => {
    // A message can nest parts arbitrarily; reading mail must not be a way
    // to crash the process.
    let payload = { mimeType: "text/plain", body: { data: encode("bottom") } };
    for (let depth = 0; depth < 200; depth += 1) {
      payload = { mimeType: "multipart/mixed", parts: [payload] };
    }

    const result = mime.walkParts(payload);
    // Past the cap, so the body is not reached — but it returns.
    assert.equal(result.text, null);
    assert.deepEqual(result.attachments, []);
  });

  test("an empty payload is not an error", () => {
    assert.deepEqual(mime.walkParts(null), {
      text: null,
      html: null,
      attachments: [],
    });
  });
});

// ── Writing what Gmail sends ───────────────────────────────────────────────

/** Decodes what `buildMessage` produced, so assertions read the real thing. */
const built = (options) =>
  Buffer.from(mime.buildMessage(options), "base64url").toString("utf8");

describe("building a message", () => {
  const base = {
    from: { name: "Ops", email: "ops@bm.com" },
    to: [{ email: "a@x.com" }],
    subject: "Hello",
    text: "Body",
  };

  test("lines end CRLF, which the format requires", () => {
    const raw = built(base);
    // A bare LF makes some servers reject the message outright.
    assert.ok(!/[^\r]\n/.test(raw), "a bare LF reached the message");
  });

  test("a non-ASCII subject is encoded-word wrapped", () => {
    const raw = built({ ...base, subject: "تقرير — week 48" });
    assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
    // And it round trips.
    const header = raw.match(/^Subject: (.*)$/m)[1];
    assert.equal(mime.decodeEncodedWords(header), "تقرير — week 48");
  });

  test("an ASCII subject is left alone", () => {
    assert.match(built(base), /^Subject: Hello$/m);
  });

  test("a display name containing a comma is quoted", () => {
    const raw = built({ ...base, to: [{ name: "Doe, Jane", email: "j@x.com" }] });
    assert.match(raw, /^To: "Doe, Jane" <j@x\.com>$/m);
  });

  test("Bcc is written as a header for Gmail to strip", () => {
    // Gmail removes it in transit. Omitting it would simply not deliver to
    // the blind copy at all.
    const raw = built({ ...base, bcc: [{ email: "secret@x.com" }] });
    assert.match(raw, /^Bcc: secret@x\.com$/m);
  });

  test("text and html together become multipart/alternative", () => {
    const raw = built({ ...base, html: "<p>Body</p>" });
    assert.match(raw, /Content-Type: multipart\/alternative; boundary="/);
    assert.ok(raw.includes("text/plain"));
    assert.ok(raw.includes("text/html"));
  });

  test("html alone is not wrapped in a pointless multipart", () => {
    const raw = built({ ...base, text: null, html: "<p>Body</p>" });
    assert.ok(!raw.includes("multipart"));
    assert.match(raw, /Content-Type: text\/html; charset="UTF-8"/);
  });

  test("attachments wrap the body in multipart/mixed", () => {
    const content = Buffer.from("%PDF-1.4 pretend");
    const raw = built({
      ...base,
      attachments: [
        { filename: "a.pdf", mimeType: "application/pdf", content },
      ],
    });

    assert.match(raw, /Content-Type: multipart\/mixed; boundary="/);
    assert.ok(raw.includes('Content-Disposition: attachment; filename="a.pdf"'));
    assert.ok(
      raw.includes(content.toString("base64")),
      "the attachment bytes are not in the message",
    );
  });

  test("a non-ASCII filename is sent both ways round", () => {
    // Old clients read `filename=`; correct ones read `filename*=`. Real
    // mail clients send both, because neither alone is understood everywhere.
    const raw = built({
      ...base,
      attachments: [
        {
          filename: "ملف.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("x"),
        },
      ],
    });

    assert.ok(raw.includes("filename=\"=?UTF-8?B?"));
    assert.ok(raw.includes("filename*=UTF-8''"));
  });

  test("an inline attachment carries the Content-ID the HTML refers to", () => {
    const raw = built({
      ...base,
      html: '<img src="cid:logo">',
      attachments: [
        {
          filename: "logo.png",
          mimeType: "image/png",
          content: Buffer.from("png"),
          inline: true,
          contentId: "logo",
        },
      ],
    });

    assert.match(raw, /^Content-ID: <logo>$/m);
    assert.match(raw, /Content-Disposition: inline/);
  });

  test("a reply carries the headers every other client threads on", () => {
    // `threadId` only groups it in the sender's own Gmail. These headers are
    // what make it a reply anywhere else.
    const raw = built({
      ...base,
      inReplyTo: "<abc@x.com>",
      references: ["<root@x.com>", "<abc@x.com>"],
    });

    assert.match(raw, /^In-Reply-To: <abc@x\.com>$/m);
    assert.match(raw, /^References: <root@x\.com> <abc@x\.com>$/m);
  });

  test("an empty body still produces a valid message", () => {
    const raw = built({ ...base, text: null, html: null });
    assert.match(raw, /Content-Type: text\/plain/);
  });

  test("base64 body lines stay inside the length limit", () => {
    const raw = built({ ...base, text: "x".repeat(5000) });
    const longest = raw
      .split("\r\n")
      .reduce((max, line) => Math.max(max, line.length), 0);
    assert.ok(longest <= 998, `a line was ${longest} characters`);
  });
});

describe("reply and forward conventions", () => {
  test("Re: is not stacked on a subject that already has it", () => {
    assert.equal(mime.prefixSubject("Re: hello", "Re"), "Re: hello");
    assert.equal(mime.prefixSubject("RE: hello", "Re"), "RE: hello");
    assert.equal(mime.prefixSubject("hello", "Re"), "Re: hello");
  });

  test("Fwd: recognises the spellings people actually send", () => {
    assert.equal(mime.prefixSubject("Fwd: x", "Fwd"), "Fwd: x");
    assert.equal(mime.prefixSubject("FW: x", "Fwd"), "FW: x");
    assert.equal(mime.prefixSubject("x", "Fwd"), "Fwd: x");
  });

  test("a quote names whoever wrote it, by name or address", () => {
    assert.match(
      mime.quoteForReply({ from: { name: "Jane" }, text: "hi" }),
      /Jane wrote:/,
    );
    assert.match(
      mime.quoteForReply({ from: { email: "j@x.com" }, text: "hi" }),
      /j@x\.com wrote:/,
    );
    assert.match(mime.quoteForReply({ text: "hi" }), /someone wrote:/);
  });

  test("every line of the quoted body is marked as quoted", () => {
    const quote = mime.quoteForReply({
      from: { name: "Jane" },
      text: "one\ntwo\nthree",
    });
    assert.ok(quote.includes("> one"));
    assert.ok(quote.includes("> two"));
    assert.ok(quote.includes("> three"));
  });
});

// ── Scopes and capabilities ────────────────────────────────────────────────

describe("access levels", () => {
  test("each level asks for the narrowest scope that does its job", () => {
    assert.deepEqual(scopes.scopesForLevel("readOnly"), [
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    // `gmail.modify` already covers sending and labels, so neither is
    // requested alongside it: a redundant scope on a restricted consent
    // screen is a question to answer in review for no gain.
    assert.deepEqual(scopes.scopesForLevel("modify"), [
      "https://www.googleapis.com/auth/gmail.modify",
    ]);
    assert.deepEqual(scopes.scopesForLevel("full"), ["https://mail.google.com/"]);
  });

  test("an unknown level is refused rather than defaulted", () => {
    assert.throws(() => scopes.scopesForLevel("everything"), /Unknown Gmail/);
  });

  test("the level comes from what Google granted, widest first", () => {
    assert.equal(
      scopes.levelFromScopes(["https://mail.google.com/"]),
      "full",
    );
    assert.equal(
      scopes.levelFromScopes([
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.readonly",
      ]),
      "modify",
    );
    assert.equal(
      scopes.levelFromScopes(["https://www.googleapis.com/auth/gmail.readonly"]),
      "readOnly",
    );
  });

  test("a grant that can only send maps to no level at all", () => {
    // There is no level for it, and calling it readOnly would promise reads
    // it cannot do. The connect flow refuses the grant instead.
    assert.equal(
      scopes.levelFromScopes(["https://www.googleapis.com/auth/gmail.send"]),
      null,
    );
    assert.equal(scopes.levelFromScopes([]), null);
  });

  test("permanent deletion needs full access, which modify is not", () => {
    // Google splits deletion off from `gmail.modify` deliberately. Keeping
    // that split is why "delete forever" is refused at the middle level.
    assert.equal(scopes.capabilitiesOf("modify").deleteForever, false);
    assert.equal(scopes.capabilitiesOf("full").deleteForever, true);
  });

  test("a refusal names the level the user would need", () => {
    assert.throws(
      () => scopes.assertCan({ email: "a@b.com", accessLevel: "readOnly" }, "send"),
      (error) => {
        assert.equal(error.statusCode, 403);
        assert.match(error.message, /cannot send mail/);
        assert.match(error.message, /Reconnect it with "Read, organize and send"/);
        return true;
      },
    );
  });

  test("read-only cannot write anything", () => {
    const capabilities = scopes.capabilitiesOf("readOnly");
    assert.equal(capabilities.read, true);
    assert.equal(capabilities.send, false);
    assert.equal(capabilities.organize, false);
    assert.equal(capabilities.trash, false);
    assert.equal(capabilities.deleteForever, false);
  });

  test("an account with no level is treated as the least privileged", () => {
    // Fail closed: an unset level must not inherit write access.
    assert.equal(scopes.capabilitiesOf(undefined).send, false);
    assert.throws(() => scopes.assertCan({}, "organize"), /cannot organize/);
  });
});

// ── The seal on stored refresh tokens ──────────────────────────────────────

describe("sealing refresh tokens", () => {
  const withKeys = (active, old, body) => {
    const previous = {
      active: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
      old: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_OLD,
    };
    if (active === null) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = active;
    if (old === null) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_OLD;
    else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_OLD = old;

    try {
      return body();
    } finally {
      if (previous.active === undefined) {
        delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
      } else {
        process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = previous.active;
      }
      if (previous.old === undefined) {
        delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_OLD;
      } else {
        process.env.GOOGLE_TOKEN_ENCRYPTION_KEY_OLD = previous.old;
      }
    }
  };

  const key = () => crypto.randomBytes(32).toString("base64");

  test("a sealed token opens again and nothing else does", () => {
    withKeys(key(), null, () => {
      const sealed = box.seal("1//real-refresh-token");
      assert.notEqual(sealed, "1//real-refresh-token");
      assert.ok(sealed.startsWith("v1."));
      assert.equal(box.open(sealed), "1//real-refresh-token");
    });
  });

  test("a value sealed before a key rotation still opens", () => {
    const first = key();
    const sealed = withKeys(first, null, () => box.seal("token"));
    withKeys(key(), first, () => {
      assert.equal(box.open(sealed), "token");
      // And it is reported as wanting re-sealing under the new key.
      assert.equal(box.needsResealing(sealed), true);
    });
  });

  test("a tampered value is refused, not quietly misread", () => {
    withKeys(key(), null, () => {
      const sealed = box.seal("token");
      const parts = sealed.split(".");
      // Corrupt the ciphertext. GCM's authentication tag is what catches
      // this; without it the value would decrypt into something else.
      const bytes = Buffer.from(parts[3], "base64");
      bytes[0] = (bytes[0] + 1) % 256;
      parts[3] = bytes.toString("base64");

      assert.throws(() => box.open(parts.join(".")), /could not be decrypted/);
    });
  });

  test("without a key, sealing refuses rather than storing plaintext", () => {
    // The whole point: a missing variable must not silently downgrade to
    // writing a mailbox credential in the clear.
    withKeys(null, null, () => {
      assert.equal(box.isConfigured(), false);
      assert.throws(() => box.seal("token"), /is not configured/);
    });
  });

  test("a key of the wrong length is refused with a usable message", () => {
    withKeys("too-short", null, () => {
      assert.equal(box.isConfigured(), false);
      assert.throws(() => box.seal("token"), /32 bytes/);
    });
  });

  test("hex and base64 keys are both accepted", () => {
    const hex = crypto.randomBytes(32).toString("hex");
    withKeys(hex, null, () => {
      assert.equal(box.open(box.seal("token")), "token");
    });
  });

  test("nothing in, nothing out", () => {
    withKeys(key(), null, () => {
      assert.equal(box.seal(null), null);
      assert.equal(box.seal(""), null);
      assert.equal(box.open(null), null);
    });
  });

  test("two seals of the same token differ", () => {
    // A fresh IV each time, so identical tokens are not identifiable as
    // identical in the database.
    withKeys(key(), null, () => {
      assert.notEqual(box.seal("same"), box.seal("same"));
    });
  });
});
