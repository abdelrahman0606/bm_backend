const crypto = require("crypto");

/**
 * Signs the policy the agent will enforce, and nothing else.
 *
 * Why asymmetric rather than an HMAC: the agent has to verify, so with a
 * shared secret every enrolled machine would hold the key that mints
 * policies, and one compromised laptop could issue itself an empty policy.
 * With Ed25519 the device holds only the public key, which lets it check a
 * policy and never forge one.
 *
 * The signed payload binds the policy to one device and one version. A policy
 * signed for device A is rejected by device B because the deviceId is inside
 * the signature, and an older policy replayed at the right device is rejected
 * because the agent refuses a version below the highest it has seen.
 */

/**
 * JSON with object keys in a fixed order.
 *
 * Two structurally identical policies must produce byte-identical input, or a
 * signature made on one of them will not verify against the other. Key order
 * in JavaScript objects is insertion order, which depends on how the document
 * came out of Mongo, so it cannot be relied on.
 */
const canonicalize = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
  return `{${parts.join(",")}}`;
};

let cachedKeys = null;

/**
 * The signing keypair.
 *
 * In production both halves come from the environment. When the private key
 * is absent a pair is generated once per process so a development server
 * works out of the box — and it says so loudly, because a policy signed with
 * an ephemeral key verifies against nothing after a restart, which would look
 * like a mysterious agent failure rather than a missing setting.
 */
const keys = () => {
  if (cachedKeys) return cachedKeys;

  const privatePem = process.env.DEVICE_POLICY_PRIVATE_KEY;
  const publicPem = process.env.DEVICE_POLICY_PUBLIC_KEY;

  if (privatePem && publicPem) {
    cachedKeys = {
      privateKey: crypto.createPrivateKey(privatePem),
      publicKey: crypto.createPublicKey(publicPem),
      ephemeral: false,
    };
    return cachedKeys;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DEVICE_POLICY_PRIVATE_KEY and DEVICE_POLICY_PUBLIC_KEY must be set before Device Control can sign policies"
    );
  }

  const generated = crypto.generateKeyPairSync("ed25519");
  // eslint-disable-next-line no-console
  console.warn(
    "[device-control] No policy signing key configured. Generated an ephemeral one: agents will reject policies after this process restarts. Set DEVICE_POLICY_PRIVATE_KEY and DEVICE_POLICY_PUBLIC_KEY."
  );
  cachedKeys = {
    privateKey: generated.privateKey,
    publicKey: generated.publicKey,
    ephemeral: true,
  };
  return cachedKeys;
};

/** The public key an agent pins, in PEM. Served once at enrollment. */
const publicKeyPem = () =>
  keys().publicKey.export({ type: "spki", format: "pem" }).toString();

/**
 * Wraps `payload` with its signature.
 *
 * The returned envelope is exactly what goes over the wire: the agent
 * verifies `signature` over the canonical form of `payload`, and applies
 * nothing if that fails.
 */
const sign = (payload) => {
  const canonical = canonicalize(payload);
  const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), keys().privateKey);
  return {
    payload,
    algorithm: "ed25519",
    signature: signature.toString("base64"),
  };
};

/**
 * Verifies an envelope. Used by the tests, and available to any future
 * server-side check; the agent does the same thing in C#.
 */
const verify = (envelope) => {
  if (!envelope || typeof envelope !== "object") return false;
  const { payload, signature } = envelope;
  if (!payload || typeof signature !== "string") return false;
  try {
    return crypto.verify(
      null,
      Buffer.from(canonicalize(payload), "utf8"),
      keys().publicKey,
      Buffer.from(signature, "base64")
    );
  } catch (error) {
    return false;
  }
};

module.exports = { canonicalize, publicKeyPem, sign, verify };
