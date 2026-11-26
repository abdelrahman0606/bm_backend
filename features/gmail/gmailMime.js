const crypto = require("crypto");

/**
 * Reading and writing real email messages.
 *
 * Gmail's API does not deal in "to, subject, body". It hands back a tree of
 * MIME parts with base64url bodies, and it accepts a complete RFC 5322
 * message as one base64url string. Everything awkward about email lives in
 * that gap, and it all lives in this file so nothing else has to know about
 * it:
 *
 *   - a body may be `text/plain`, `text/html`, both as `multipart/alternative`,
 *     or either of those wrapped in `multipart/mixed` with attachments, and
 *     the nesting is arbitrarily deep;
 *   - headers are ASCII, so a subject or a display name containing anything
 *     else has to be encoded-word wrapped (RFC 2047), and a non-ASCII
 *     filename needs RFC 2231 — get this wrong and a Russian subject line
 *     arrives as mojibake;
 *   - lines are CRLF-terminated and length-limited, so bodies are sent
 *     base64 rather than hoping they are 7-bit clean;
 *   - `Bcc` is a header we write and never read: it is stripped in transit,
 *     which is the whole point of it.
 *
 * All of it is pure string work — no network, no database — so it is directly
 * testable, which matters because these are the bugs that reach recipients.
 */

const CRLF = "\r\n";

// ── Decoding ───────────────────────────────────────────────────────────────

/** Gmail encodes every body part base64url. Tolerant of missing padding. */
const decodeBase64Url = (data) => {
  if (!data) return Buffer.alloc(0);
  const normalised = String(data).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalised, "base64");
};

const encodeBase64Url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Case-insensitive header lookup over Gmail's `[{name, value}]` shape. */
const headerValue = (headers, name) => {
  const wanted = String(name).toLowerCase();
  const found = (headers || []).find(
    (header) => String(header.name).toLowerCase() === wanted,
  );
  return found ? found.value : null;
};

/**
 * Decodes RFC 2047 encoded-words, which is how a non-ASCII subject or display
 * name travels: `=?UTF-8?B?...?=` (base64) or `=?UTF-8?Q?...?=` (quoted
 * printable). Left as-is when it is not one, so plain ASCII costs nothing.
 */
const decodeEncodedWords = (value) => {
  if (!value || !value.includes("=?")) return value || "";

  return String(value).replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (match, charset, encoding, text) => {
      try {
        const buffer =
          encoding.toUpperCase() === "B"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                // Quoted printable: `_` is a space, `=XX` is a byte.
                text
                  .replace(/_/g, " ")
                  .replace(/=([0-9A-Fa-f]{2})/g, (hexMatch, hex) =>
                    String.fromCharCode(parseInt(hex, 16)),
                  ),
                "binary",
              );
        const label = String(charset).toLowerCase();
        // Node knows utf8 and latin1 natively; anything else is passed
        // through as utf8, which is right far more often than it is wrong.
        return buffer.toString(label === "iso-8859-1" ? "latin1" : "utf8");
      } catch {
        return match;
      }
    },
  );
};

/** One address, as `Name <a@b.com>`, `<a@b.com>` or bare `a@b.com`. */
const parseAddress = (value) => {
  const text = String(value || "").trim();
  if (!text) return null;

  const angled = text.match(/^(.*)<([^>]+)>\s*$/);
  if (angled) {
    const name = decodeEncodedWords(angled[1].trim().replace(/^"|"$/g, ""));
    return {
      name: name || null,
      email: angled[2].trim().toLowerCase(),
    };
  }

  if (!text.includes("@")) return null;
  return { name: null, email: text.toLowerCase() };
};

/**
 * Splits an address header into addresses.
 *
 * Hand-rolled rather than regex-per-address because commas inside a quoted
 * display name ("Doe, Jane" <j@x.com>) are not separators, and a regex that
 * handles that is less readable than a scanner that tracks whether it is
 * inside quotes or angle brackets.
 */
const parseAddressList = (value) => {
  if (!value) return [];

  const chunks = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;

  String(value)
    .split("")
    .forEach((character) => {
      if (character === '"') inQuotes = !inQuotes;
      if (character === "<") inAngle = true;
      if (character === ">") inAngle = false;

      if (character === "," && !inQuotes && !inAngle) {
        chunks.push(current);
        current = "";
        return;
      }
      current += character;
    });
  chunks.push(current);

  return chunks
    .map((chunk) => parseAddress(chunk))
    .filter((address) => address && address.email);
};

/**
 * Flattens Gmail's part tree into the three things a reader wants: a plain
 * body, an HTML body, and a list of attachments.
 *
 * An `attachmentId` is what makes a part downloadable; a part without one has
 * its bytes inline in `body.data`, which is how small inline images arrive.
 */
/**
 * Classifies one part and reports its children, so the walk itself stays a
 * plain queue drain. Writes into `result`.
 */
const visitPart = (part, depth, maxDepth, result) => {
  if (!part || depth > maxDepth) return [];

  const children = Array.isArray(part.parts) ? part.parts : [];
  const mimeType = String(part.mimeType || "").toLowerCase();
  const filename = part.filename || "";
  const body = part.body || {};
  const disposition = String(
    headerValue(part.headers, "content-disposition") || "",
  ).toLowerCase();
  const contentId = headerValue(part.headers, "content-id");

  // An attachment is a part with a filename, or any part Gmail gave an
  // attachment handle to. Both tests are needed: inline images often have no
  // filename, and some senders attach a file with no disposition.
  const isAttachment =
    Boolean(filename) ||
    Boolean(body.attachmentId) ||
    disposition.startsWith("attachment");

  if (isAttachment && !mimeType.startsWith("multipart/")) {
    result.attachments.push({
      attachmentId: body.attachmentId || null,
      partId: part.partId || null,
      filename: decodeEncodedWords(filename) || "",
      mimeType: part.mimeType || "application/octet-stream",
      size: Number(body.size) || 0,
      inline:
        disposition.startsWith("inline") ||
        (Boolean(contentId) && !disposition.startsWith("attachment")),
      contentId: contentId ? String(contentId).replace(/^<|>$/g, "") : null,
    });
  } else if (mimeType === "text/plain" && !result.text && body.data) {
    result.text = decodeBase64Url(body.data).toString("utf8");
  } else if (mimeType === "text/html" && !result.html && body.data) {
    result.html = decodeBase64Url(body.data).toString("utf8");
  }

  return children;
};

const walkParts = (payload) => {
  const result = { text: null, html: null, attachments: [] };
  if (!payload) return result;

  // Iterative, not recursive: a strange or hostile message can nest parts
  // deeply, and a stack overflow while reading mail is not a failure mode
  // worth having. It also makes the depth cap explicit.
  const MAX_DEPTH = 24;
  const queue = [{ part: payload, depth: 0 }];

  while (queue.length > 0) {
    const { part, depth } = queue.shift();
    visitPart(part, depth, MAX_DEPTH, result).forEach((child) =>
      queue.push({ part: child, depth: depth + 1 }),
    );
  }

  return result;
};

// ── Encoding ───────────────────────────────────────────────────────────────

const isAscii = (value) => !/[^\x20-\x7E]/.test(String(value || ""));

/**
 * Wraps a header value as an RFC 2047 encoded-word when it needs it.
 *
 * Headers are ASCII. A subject containing Arabic, an em dash or an emoji has
 * to be encoded or the recipient sees bytes. ASCII values are returned
 * untouched, because an encoded-word where none is needed is harder to read
 * in a raw message and some old clients handle it badly.
 */
const encodeHeaderValue = (value) => {
  const text = String(value === null || value === undefined ? "" : value);
  if (isAscii(text)) return text;
  // One encoded-word per 45 source characters, which stays inside the 75-byte
  // limit per word even when every character is 4 UTF-8 bytes.
  const chunks = text.match(/.{1,45}/gu) || [];
  return chunks
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    .join(`${CRLF} `);
};

/** `Name <a@b.com>`, with the name encoded and quoted if it has to be. */
const formatAddress = (address) => {
  if (!address) return null;
  if (typeof address === "string") return parseAddress(address) ? address.trim() : null;

  const email = String(address.email || "").trim();
  if (!email) return null;

  const name = String(address.name || "").trim();
  if (!name) return email;
  if (isAscii(name)) {
    // Quote a display name containing anything a parser would treat as
    // structure, which is what a bare comma in "Doe, Jane" would be.
    const quoted = /[(),:;<>@[\]\\".]/.test(name)
      ? `"${name.replace(/(["\\])/g, "\\$1")}"`
      : name;
    return `${quoted} <${email}>`;
  }
  return `${encodeHeaderValue(name)} <${email}>`;
};

const formatAddressList = (addresses = []) =>
  (Array.isArray(addresses) ? addresses : [addresses])
    .map((address) => formatAddress(address))
    .filter(Boolean)
    .join(", ");

const boundary = (label) =>
  `----=_bm_${label}_${crypto.randomBytes(12).toString("hex")}`;

/** base64 in 76-character lines, as the transfer encoding requires. */
const base64Lines = (input) =>
  (Buffer.from(input).toString("base64").match(/.{1,76}/g) || []).join(CRLF);

/**
 * An attachment filename, twice.
 *
 * `filename=` in an encoded-word for old clients, and RFC 2231
 * `filename*=UTF-8''...` for correct ones. Sending both is what every real
 * mail client does, because neither alone is understood everywhere.
 */
const contentDispositionFor = (attachment, inline) => {
  const kind = inline ? "inline" : "attachment";
  const name = String(attachment.filename || "attachment");
  if (isAscii(name)) {
    return `Content-Disposition: ${kind}; filename="${name.replace(/"/g, "")}"`;
  }
  return (
    `Content-Disposition: ${kind}; filename="${encodeHeaderValue(name)}";` +
    `${CRLF} filename*=UTF-8''${encodeURIComponent(name)}`
  );
};

/**
 * Builds a complete RFC 5322 message and returns it base64url encoded, which
 * is exactly what Gmail's `raw` field takes.
 *
 * Structure is chosen by what is present, because a needlessly multipart
 * message is a message some clients render as an empty body:
 *
 *   text only                  → text/plain
 *   html only                  → text/html
 *   both                       → multipart/alternative
 *   either + attachments       → multipart/mixed wrapping the above
 *
 * `inReplyTo`/`references` are what make a reply thread in the recipient's
 * client. Gmail's own `threadId` only groups it in *this* mailbox; the
 * headers are what everyone else reads.
 */
const buildMessage = ({
  from,
  to = [],
  cc = [],
  bcc = [],
  replyTo = null,
  subject = "",
  text = null,
  html = null,
  attachments = [],
  inReplyTo = null,
  references = [],
  headers = {},
}) => {
  const lines = [];

  const fromHeader = formatAddress(from);
  if (fromHeader) lines.push(`From: ${fromHeader}`);

  const toHeader = formatAddressList(to);
  if (toHeader) lines.push(`To: ${toHeader}`);

  const ccHeader = formatAddressList(cc);
  if (ccHeader) lines.push(`Cc: ${ccHeader}`);

  // Written, then removed by the sending server before anyone receives it.
  // Gmail does this itself, which is why a blind copy stays blind.
  const bccHeader = formatAddressList(bcc);
  if (bccHeader) lines.push(`Bcc: ${bccHeader}`);

  const replyToHeader = formatAddressList(replyTo || []);
  if (replyToHeader) lines.push(`Reply-To: ${replyToHeader}`);

  lines.push(`Subject: ${encodeHeaderValue(subject)}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push("MIME-Version: 1.0");

  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  const chain = (Array.isArray(references) ? references : [references]).filter(
    Boolean,
  );
  if (chain.length > 0) lines.push(`References: ${chain.join(" ")}`);

  Object.entries(headers || {}).forEach(([name, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      lines.push(`${name}: ${encodeHeaderValue(value)}`);
    }
  });

  const files = (attachments || []).filter(
    (attachment) => attachment && attachment.content,
  );
  const hasText = typeof text === "string" && text.length > 0;
  const hasHtml = typeof html === "string" && html.length > 0;

  /** The body alternatives, as their own MIME section. */
  const bodySection = () => {
    if (hasText && hasHtml) {
      const alt = boundary("alt");
      return {
        headers: [`Content-Type: multipart/alternative; boundary="${alt}"`],
        body: [
          `--${alt}`,
          'Content-Type: text/plain; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          base64Lines(text),
          "",
          `--${alt}`,
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          base64Lines(html),
          "",
          `--${alt}--`,
        ].join(CRLF),
      };
    }
    if (hasHtml) {
      return {
        headers: [
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
        ],
        body: base64Lines(html),
      };
    }
    return {
      headers: [
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
      ],
      // An empty body is still a valid message; senders do it for calendar
      // invitations and read receipts.
      body: base64Lines(hasText ? text : ""),
    };
  };

  const section = bodySection();

  if (files.length === 0) {
    return encodeBase64Url(
      [...lines, ...section.headers, "", section.body].join(CRLF),
    );
  }

  const mixed = boundary("mix");
  const parts = [
    ...lines,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    ...section.headers,
    "",
    section.body,
    "",
  ];

  files.forEach((attachment) => {
    const mimeType = attachment.mimeType || "application/octet-stream";
    const inline = attachment.inline === true;
    parts.push(`--${mixed}`);
    parts.push(
      `Content-Type: ${mimeType}; name="${encodeHeaderValue(
        attachment.filename || "attachment",
      )}"`,
    );
    parts.push("Content-Transfer-Encoding: base64");
    parts.push(contentDispositionFor(attachment, inline));
    if (inline && attachment.contentId) {
      // What an `<img src="cid:...">` in the HTML body resolves against.
      parts.push(`Content-ID: <${attachment.contentId}>`);
    }
    parts.push("");
    parts.push(base64Lines(attachment.content));
    parts.push("");
  });

  parts.push(`--${mixed}--`);
  return encodeBase64Url(parts.join(CRLF));
};

/**
 * Quotes a message the way a reply does: an attribution line, then the
 * original indented with `>`.
 *
 * Plain text only, on purpose. Quoting HTML means rewriting someone else's
 * markup, and getting that wrong turns a reply into a rendering bug or worse
 * — so the HTML alternative of a reply carries a `<blockquote>` of the
 * *plain* text instead, which is safe and reads correctly everywhere.
 */
const quoteForReply = ({ from, date, text }) => {
  const who = (from && (from.name || from.email)) || "someone";
  const when = date ? new Date(date).toUTCString() : "an earlier message";
  const quoted = String(text || "")
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `On ${when}, ${who} wrote:\n${quoted}`;
};

/** `Re:` / `Fwd:` without stacking them on an already-prefixed subject. */
const prefixSubject = (subject, prefix) => {
  const text = String(subject || "").trim();
  const pattern = prefix === "Re" ? /^re\s*:/i : /^(fwd?|forward)\s*:/i;
  if (pattern.test(text)) return text;
  return `${prefix}: ${text}`;
};

module.exports = {
  CRLF,
  decodeBase64Url,
  encodeBase64Url,
  headerValue,
  decodeEncodedWords,
  parseAddress,
  parseAddressList,
  walkParts,
  encodeHeaderValue,
  formatAddress,
  formatAddressList,
  buildMessage,
  quoteForReply,
  prefixSubject,
};
