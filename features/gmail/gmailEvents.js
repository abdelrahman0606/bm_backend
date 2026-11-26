const { EVENT_TYPES } = require("../../core/events/eventTypes");
const { getEventDispatcher } = require("../../core/events/eventDispatcher");

/**
 * Gmail's live feed.
 *
 * The point of the feature is that mail arrives without the app asking, so
 * these events are not a convenience layered on top — they are how the client
 * learns anything. It still follows the same three rules as Device Control's
 * feed, with one deliberate difference.
 *
 * **1. Delivery is best-effort and never costs the operation.** A message
 * that was stored is stored whether or not the frame went out. Every publish
 * is wrapped; a realtime failure is logged, not raised, and no caller awaits
 * one.
 *
 * **2. Recipients are the mailbox's owner, and only them.** A connected
 * mailbox is personal: it belongs to the BM user who consented, and nobody
 * else may see that it exists, let alone what is in it. So there is no
 * company room and no administrator fan-out here — unlike Device Control,
 * where the audience is the people who administer a fleet. `user:<id>` is
 * the only room, and the id comes from the account row, never from a request.
 *
 * **3. A payload carries no credential and no body.** No tokens, no history
 * cursors, no attachment bytes, no message body.
 *
 * **The difference: `message.received` carries the message.** Sender,
 * subject, Gmail's own snippet and — in direct mode — the plain-text body
 * travel with it. Device Control's rule is "ids only, refetch through the
 * API", and that is right there: a policy change is not something to render
 * from a socket frame.
 *
 * Here it would be the wrong rule. The server has just fetched the message
 * from Gmail in order to notice it at all, and in direct mode it keeps no
 * copy — so "refetch through the API" means fetching the same message from
 * Gmail a second time, spending quota to deliver data this same user is
 * entitled to and the server already has in hand. The frame carries it
 * instead, and the mail is never written down on the way.
 *
 * The body is capped by the caller. Over the cap it is omitted rather than
 * truncated, because half a message presented as whole is worse than one
 * that needs a fetch. Nothing else is relaxed: no token, no history cursor,
 * no attachment bytes.
 */

const EVENT_TYPE = EVENT_TYPES.GMAIL;

/**
 * What changed. The same vocabulary as the operation log's `operation`
 * values wherever they overlap, so the live feed and the audit trail describe
 * one thing one way.
 */
const EVENT_ACTIONS = Object.freeze({
  // ── Accounts ─────────────────────────────────────────────────────────────
  ACCOUNT_CONNECTED: "account.connected",
  ACCOUNT_UPDATED: "account.updated",
  ACCOUNT_SIGNED_OUT: "account.signedOut",
  ACCOUNT_DISCONNECTED: "account.disconnected",
  /** The stored grant stopped working; the user has to reconnect. */
  ACCOUNT_NEEDS_REAUTH: "account.needsReauth",

  // ── Mail ─────────────────────────────────────────────────────────────────
  MESSAGE_RECEIVED: "message.received",
  /** Labels, read state or star changed — by us or in Gmail itself. */
  MESSAGE_UPDATED: "message.updated",
  MESSAGE_SENT: "message.sent",
  MESSAGE_SEND_FAILED: "message.sendFailed",
  MESSAGE_TRASHED: "message.trashed",
  MESSAGE_UNTRASHED: "message.untrashed",
  MESSAGE_DELETED: "message.deleted",
  THREAD_UPDATED: "thread.updated",
  DRAFT_SAVED: "draft.saved",
  DRAFT_DELETED: "draft.deleted",
  LABELS_CHANGED: "labels.changed",

  // ── Synchronization ──────────────────────────────────────────────────────
  SYNC_STARTED: "sync.started",
  SYNC_COMPLETED: "sync.completed",
  SYNC_FAILED: "sync.failed",
  WATCH_STARTED: "watch.started",
  WATCH_STOPPED: "watch.stopped",
});

const _id = (value) => (value ? String(value) : null);

/**
 * Sends one event to the mailbox's owner.
 *
 * Returns true when it was handed to the transport, which is only useful for
 * tests and logging; nothing branches on it.
 */
const _publish = ({ userId, accountId, action, payload = {} }) => {
  try {
    const user = _id(userId);
    if (!user || !action) return false;

    getEventDispatcher().sendToUser(
      user,
      EVENT_TYPE,
      { accountId: _id(accountId), ...payload },
      { action },
    );
    return true;
  } catch (error) {
    // Realtime is a convenience. Losing a frame must never turn a successful
    // write into a failed request.
    console.error(
      `[gmail] event "${action}" was not delivered:`,
      error && error.message,
    );
    return false;
  }
};

/** The fields of a message that are safe and useful to put on the wire. */
const envelopeOf = (message) => ({
  messageId: _id(message._id),
  gmailId: message.gmailId,
  threadId: message.threadId,
  subject: message.subject || "",
  from: message.from
    ? { name: message.from.name || null, email: message.from.email || null }
    : null,
  to: (message.to || []).map((address) => address.email).filter(Boolean),
  snippet: message.snippet || "",
  internalDate: message.internalDate
    ? new Date(message.internalDate).toISOString()
    : null,
  labelIds: message.labelIds || [],
  isUnread: message.isUnread === true,
  hasAttachments: message.hasAttachments === true,
  attachmentCount: (message.attachments || []).length,
});

// ──────────────────────────────── Accounts ─────────────────────────────────

const accountConnected = (account) =>
  _publish({
    userId: account.userId,
    accountId: account._id,
    action: EVENT_ACTIONS.ACCOUNT_CONNECTED,
    payload: {
      email: account.email,
      displayName: account.displayName,
      accessLevel: account.accessLevel,
      isPrimary: account.isPrimary === true,
    },
  });

const accountUpdated = (account) =>
  _publish({
    userId: account.userId,
    accountId: account._id,
    action: EVENT_ACTIONS.ACCOUNT_UPDATED,
    payload: {
      email: account.email,
      displayName: account.displayName,
      isPrimary: account.isPrimary === true,
      isEnabled: account.isEnabled === true,
    },
  });

const accountSignedOut = (account) =>
  _publish({
    userId: account.userId,
    accountId: account._id,
    action: EVENT_ACTIONS.ACCOUNT_SIGNED_OUT,
    payload: { email: account.email },
  });

const accountDisconnected = ({ userId, accountId, email }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.ACCOUNT_DISCONNECTED,
    payload: { email },
  });

/**
 * The grant stopped working. Carries the reason, because "reconnect your
 * mailbox" with no explanation is the kind of prompt users ignore.
 */
const accountNeedsReauth = ({ userId, accountId, email, reason }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.ACCOUNT_NEEDS_REAUTH,
    payload: { email, reason: reason || null },
  });

// ────────────────────────────────── Mail ───────────────────────────────────

/**
 * New mail arrived.
 *
 * Published once per message per account, after it is stored — so a client
 * that reacts by fetching finds it there. Batched by the caller: a sync that
 * stored forty messages publishes forty events, which is correct for a
 * notification and is why the payload is small.
 */
const messageReceived = ({
  userId,
  accountId,
  accountEmail,
  message,
  body = null,
}) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.MESSAGE_RECEIVED,
    payload: {
      accountEmail,
      ...envelopeOf(message),
      // Present in direct mode, where the server holds no copy for the
      // client to fetch instead. Null when it was over the cap or when the
      // cache is on and the message can simply be read back.
      bodyText: body,
    },
  });

/**
 * Read state, star or labels changed, whoever changed them.
 *
 * Reports the new label list when there is one to report, and otherwise the
 * delta that was applied. Both shapes exist because both are the truth in
 * their mode: with a cached copy the server knows the resulting list, and in
 * direct mode it knows only what it asked Gmail to change — so it says that
 * instead of inventing a list. A client applies whichever it is given.
 */
const messageUpdated = ({ userId, accountId, message, changed = [] }) => {
  const hasLabels = Array.isArray(message.labelIds) && message.labelIds.length > 0;

  return _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.MESSAGE_UPDATED,
    payload: {
      gmailId: message.gmailId,
      threadId: message.threadId,
      ...(hasLabels
        ? {
            labelIds: message.labelIds,
            isUnread: message.isUnread === true,
            isStarred: message.isStarred === true,
            isInInbox: message.isInInbox === true,
            isTrashed: message.isTrashed === true,
          }
        : {
            addedLabelIds: message.addedLabelIds || [],
            removedLabelIds: message.removedLabelIds || [],
          }),
      changed,
    },
  });
};

/**
 * Gmail accepted a message for delivery.
 *
 * Named `sent`, meaning exactly that and no more: Gmail took it and gave us
 * an id. It is not a delivery receipt and not a read receipt, and no payload
 * here ever implies one.
 */
const messageSent = ({ userId, accountId, message, operationId }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.MESSAGE_SENT,
    payload: {
      operationId: _id(operationId),
      gmailId: message.gmailId || message.id || null,
      threadId: message.threadId || null,
      subject: message.subject || null,
      to: (message.to || []).map((address) => address.email || address),
      acceptedAt: new Date().toISOString(),
    },
  });

const messageSendFailed = ({
  userId,
  accountId,
  operationId,
  subject,
  to = [],
  error,
}) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.MESSAGE_SEND_FAILED,
    payload: {
      operationId: _id(operationId),
      subject: subject || null,
      to: to.map((address) => address.email || address),
      reason: error?.reason || null,
      message: error?.message || "The message was not sent",
      retryable: error?.retryable === true,
    },
  });

const messageTrashed = ({ userId, accountId, gmailIds = [], threadId }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.MESSAGE_TRASHED,
    payload: { gmailIds, threadId: threadId || null },
  });

const messageUntrashed = ({ userId, accountId, gmailIds = [] }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.MESSAGE_UNTRASHED,
    payload: { gmailIds },
  });

/** Gone from Gmail for good, or gone from the mailbox we can see. */
const messageDeleted = ({ userId, accountId, gmailIds = [], permanent }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.MESSAGE_DELETED,
    payload: { gmailIds, permanent: permanent === true },
  });

const threadUpdated = ({ userId, accountId, thread }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.THREAD_UPDATED,
    payload: {
      threadId: thread.gmailId,
      messageCount: thread.messageCount || 0,
      unreadCount: thread.unreadCount || 0,
      lastMessageAt: thread.lastMessageAt
        ? new Date(thread.lastMessageAt).toISOString()
        : null,
      labelIds: thread.labelIds || [],
    },
  });

const draftSaved = ({ userId, accountId, draft }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.DRAFT_SAVED,
    payload: {
      draftId: draft.draftId,
      threadId: draft.threadId || null,
      subject: draft.subject || "",
      to: (draft.to || []).map((address) => address.email).filter(Boolean),
    },
  });

const draftDeleted = ({ userId, accountId, draftId }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.DRAFT_DELETED,
    payload: { draftId },
  });

const labelsChanged = ({ userId, accountId, count }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.LABELS_CHANGED,
    payload: { count: count || 0 },
  });

// ────────────────────────────── Synchronization ────────────────────────────

const syncStarted = ({ userId, accountId, mode }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.SYNC_STARTED,
    payload: { mode },
  });

/**
 * A pass finished.
 *
 * `added`/`updated`/`removed` are what a client needs to decide whether to
 * refresh a list it is showing. A pass that changed nothing still publishes,
 * because "sync is working and there was no new mail" is information.
 */
const syncCompleted = ({
  userId,
  accountId,
  mode,
  added = 0,
  updated = 0,
  removed = 0,
  durationMs = null,
}) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.SYNC_COMPLETED,
    payload: { mode, added, updated, removed, durationMs },
  });

const syncFailed = ({ userId, accountId, mode, error, willRetry }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.SYNC_FAILED,
    payload: {
      mode,
      reason: error?.reason || null,
      message: error?.message || "Synchronization failed",
      willRetry: willRetry === true,
    },
  });

const watchStarted = ({ userId, accountId, expiration }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.WATCH_STARTED,
    payload: {
      expiration: expiration ? new Date(expiration).toISOString() : null,
    },
  });

const watchStopped = ({ userId, accountId, reason }) =>
  _publish({
    userId,
    accountId,
    action: EVENT_ACTIONS.WATCH_STOPPED,
    payload: { reason: reason || null },
  });

module.exports = {
  EVENT_TYPE,
  EVENT_ACTIONS,
  envelopeOf,
  accountConnected,
  accountUpdated,
  accountSignedOut,
  accountDisconnected,
  accountNeedsReauth,
  messageReceived,
  messageUpdated,
  messageSent,
  messageSendFailed,
  messageTrashed,
  messageUntrashed,
  messageDeleted,
  threadUpdated,
  draftSaved,
  draftDeleted,
  labelsChanged,
  syncStarted,
  syncCompleted,
  syncFailed,
  watchStarted,
  watchStopped,
};
