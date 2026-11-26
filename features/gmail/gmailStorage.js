const {
  localMongoConnection,
} = require("../../infrastructure/database/database.manager");

/**
 * Where Gmail data may be kept, and whether it is kept at all.
 *
 * Two deliberate decisions live here, and both are the answer to "why would
 * we hold a copy of somebody's mail".
 *
 * **1. By default, we don't.** A message is fetched from Gmail when it is
 * asked for and is not written down. Gmail is already the durable, indexed,
 * searchable store for that mailbox; a second copy means a second thing to
 * keep in step, a second thing to invalidate, and — the part that actually
 * matters — a second place somebody's private mail exists. So the read path
 * goes straight to Gmail, and a new message is delivered to the client in
 * the event itself rather than stored and then read back.
 *
 * What that costs is worth stating plainly, because it is not free:
 *
 *   - a unified inbox across several mailboxes is a fan-out and merge per
 *     page rather than one indexed query. `gmailDirectReader` does it as a
 *     k-way merge, which costs one extra Gmail call per mailbox per page;
 *   - search across mailboxes is not possible. Gmail's own search is
 *     per-mailbox, and there is nothing local to search instead;
 *   - every page view spends Gmail quota, where a stored copy spent it once.
 *
 * **2. If it is ever kept, it is kept locally.** `GMAIL_STORE_MESSAGES=true`
 * turns the cache on, and the collections it uses bind to the local MongoDB
 * connection — never Atlas. Atlas is a hosted cluster; a mailbox cached
 * there is somebody's mail sitting in a managed cloud database, which is a
 * much bigger thing to be responsible for than the same rows on a machine
 * the operator controls. Time Management already draws this line, and this
 * follows it.
 *
 * What stays on Atlas, and why it is not mail:
 *
 *   - `GmailAccount` — the OAuth grant, the sync cursor and the watch. It
 *     holds no message content, it lives beside the Drive accounts it
 *     mirrors, and sign-in must keep working when local MongoDB is down.
 *   - `GmailOperationLog` — our audit of our own actions, and the unique
 *     index that stops a retried send delivering twice. It records
 *     recipients and subjects but no bodies. It is on Atlas so that sending
 *     does not depend on local MongoDB being up; moving it is a one-line
 *     change here if that trade is not wanted.
 *   - `GmailPushNotification` — the Pub/Sub deduplication record: a message
 *     id, an address and a history id, expiring after a week. On Atlas for
 *     the same reason — push has to work whether or not local MongoDB does.
 */

/** Whether a local copy of messages, threads, labels and drafts is kept. */
const keepsMessages = () =>
  String(process.env.GMAIL_STORE_MESSAGES || "")
    .trim()
    .toLowerCase() === "true";

/**
 * The connection the mail-derived collections bind to.
 *
 * Always the local one. Returned as a function rather than a value so the
 * models can be declared at require time while the connection opens later —
 * Mongoose buffers against an unconnected connection, and the storage mode
 * is off by default anyway.
 */
const mailConnection = () => localMongoConnection;

/**
 * Registers a schema on the local connection, once.
 *
 * The `models` guard keeps a repeated require or a module reload from
 * recompiling the model, which Mongoose refuses.
 */
const mailModel = (name, schema) => {
  const connection = mailConnection();
  return connection.models[name] || connection.model(name, schema);
};

/** Reported by `/gmail/health`, so the mode in force is never a guess. */
const describe = () => ({
  mode: keepsMessages() ? "cached" : "direct",
  keepsMessages: keepsMessages(),
  // Named so an operator reading the health output knows where to look.
  cacheDatabase: keepsMessages() ? "local-mongodb" : null,
  note: keepsMessages()
    ? "Messages are cached in local MongoDB. Atlas holds no mail content."
    : "Messages are read straight from Gmail and not stored. Atlas and "
      + "local MongoDB both hold no mail content.",
});

module.exports = {
  keepsMessages,
  mailConnection,
  mailModel,
  describe,
};
