const crypto = require("crypto");
const ApiError = require("../../utils/apiError");

/**
 * Authenticated encryption for secrets that have to be stored and read back.
 *
 * OAuth refresh tokens are the reason this exists. A refresh token is a
 * standing permission to read somebody's mail: a database backup, a replica
 * or a stray `mongodump` that contains them in the clear is a mailbox breach,
 * not a configuration mistake. So they are sealed with AES-256-GCM before
 * they are written and opened only in the moment a token is needed.
 *
 * Three decisions worth stating.
 *
 * **GCM, not CBC.** The ciphertext carries an authentication tag, so a
 * tampered row fails to open rather than decrypting into something else.
 * There is no padding oracle to get wrong.
 *
 * **A dedicated key, never `JWT_SECRET`.** One key, one job. Reusing the
 * signing secret would mean that rotating it to invalidate sessions also
 * destroys every stored refresh token, and that anything able to read the
 * signing key can read mailboxes.
 *
 * **A version prefix.** Every sealed value says which key version produced
 * it, so a second key can be introduced and old values stay readable while
 * they are re-sealed. Rotation is then a background pass, not an outage.
 *
 * What this does *not* do: protect against a compromise of the running
 * process. Whoever can read `process.env` can open these. It raises the cost
 * of a database-only compromise, which is the realistic one.
 */

/** Environment variable holding the active key. */
const KEY_ENV = "GOOGLE_TOKEN_ENCRYPTION_KEY";

/**
 * Older keys, newest first, as a comma-separated list. Values sealed under
 * one of these still open; nothing new is sealed with them.
 */
const OLD_KEYS_ENV = "GOOGLE_TOKEN_ENCRYPTION_KEY_OLD";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits: what GCM is specified for.
const KEY_BYTES = 32; // AES-256.
const PREFIX = "v1";

/**
 * Reads a key from its environment value.
 *
 * Accepts base64, base64url or hex, because operators generate these with
 * whatever tool is to hand (`openssl rand -base64 32`, `crypto.randomBytes`)
 * and a key that is silently truncated would be worse than one refused.
 */
const parseKey = (raw) => {
  const value = String(raw || "").trim();
  if (!value) return null;

  let buffer = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    buffer = Buffer.from(value, "hex");
  } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) {
    buffer = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }

  if (!buffer || buffer.length !== KEY_BYTES) return null;
  return buffer;
};

/** The key new values are sealed with, or null when none is configured. */
const activeKey = () => parseKey(process.env[KEY_ENV]);

/** Every key a sealed value might have been produced with, active first. */
const allKeys = () => {
  const keys = [];
  const active = activeKey();
  if (active) keys.push(active);

  String(process.env[OLD_KEYS_ENV] || "")
    .split(",")
    .map((value) => parseKey(value))
    .filter(Boolean)
    .forEach((key) => keys.push(key));

  return keys;
};

/** True when sealing is possible. Callers check this before offering it. */
const isConfigured = () => activeKey() !== null;

/**
 * The error a caller gets when the key is missing or unusable.
 *
 * Deliberately a 500 with instructions rather than a fallback to plaintext:
 * storing a refresh token unencrypted because a variable was unset is the
 * failure this module exists to prevent, and it would be invisible.
 */
const assertConfigured = () => {
  if (isConfigured()) return;
  if (process.env[KEY_ENV]) {
    throw new ApiError(
      `${KEY_ENV} is set but unusable: it must be 32 bytes, ` +
        "base64 or hex encoded (openssl rand -base64 32).",
      500,
    );
  }
  throw new ApiError(
    `${KEY_ENV} is not configured, so OAuth tokens cannot be stored ` +
      "safely. Generate one with: openssl rand -base64 32",
    500,
  );
};

/**
 * Seals a string. The result is safe to store and useless without the key.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64. Self-describing, so
 * nothing outside this module has to know the algorithm or the layout.
 */
const seal = (plaintext) => {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return null;
  }
  assertConfigured();

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, activeKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".");
};

/**
 * One decryption attempt. Null when this key is not the one, so the caller
 * can try the next without a try/catch of its own.
 */
const tryOpen = (key, iv, tag, ciphertext) => {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
};

/**
 * Opens a sealed string, or throws.
 *
 * Every configured key is tried, so a value sealed before a rotation still
 * opens. A value that opens under none of them is reported as a key problem,
 * because that is overwhelmingly what it is — the alternative, treating it as
 * "no token", would quietly log the user out and lose the only copy.
 */
const open = (sealed) => {
  if (sealed === null || sealed === undefined || sealed === "") return null;

  const parts = String(sealed).split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new ApiError(
      "A stored Google token is not in the expected sealed format.",
      500,
    );
  }

  const [, ivPart, tagPart, cipherPart] = parts;
  const iv = Buffer.from(ivPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const ciphertext = Buffer.from(cipherPart, "base64");

  const keys = allKeys();
  if (keys.length === 0) assertConfigured();

  // Tried against every key, newest first. A value sealed before a rotation
  // opens under an old key; one that opens under none of them was either
  // sealed with a key nobody kept or tampered with, and GCM cannot tell
  // those apart — both are a refusal, never a silent "no token".
  const opened = keys
    .map((key) => tryOpen(key, iv, tag, ciphertext))
    .find((value) => value !== null);

  if (opened !== undefined) return opened;

  throw new ApiError(
    "A stored Google token could not be decrypted with any configured key. " +
      `Check ${KEY_ENV} (and ${OLD_KEYS_ENV} if it was rotated).`,
    500,
  );
};

/**
 * True when this value was produced by a key that is no longer the active
 * one, so a rotation pass knows what to re-seal. Cheap: it opens the value
 * and compares, which is the only way to tell without storing a key id.
 */
const needsResealing = (sealed) => {
  if (!sealed) return false;
  const active = activeKey();
  if (!active) return false;
  const iv = Buffer.from(String(sealed).split(".")[1] || "", "base64");
  const tag = Buffer.from(String(sealed).split(".")[2] || "", "base64");
  const ciphertext = Buffer.from(String(sealed).split(".")[3] || "", "base64");
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, active, iv);
    decipher.setAuthTag(tag);
    Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return false;
  } catch {
    return true;
  }
};

module.exports = {
  KEY_ENV,
  OLD_KEYS_ENV,
  isConfigured,
  assertConfigured,
  seal,
  open,
  needsResealing,
};
