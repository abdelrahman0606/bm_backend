const asyncHandler = require("express-async-handler");
const accountService = require("./gmailAccountService");
const messageService = require("./gmailMessageService");
const sendService = require("./gmailSendService");
const organizeService = require("./gmailOrganizeService");
const contactsService = require("./gmailContactsService");
const watchService = require("./gmailWatchService");
const syncService = require("./gmailSyncService");
const pushService = require("./gmailPushService");
const audit = require("./gmailAuditService");
const storage = require("./gmailStorage");

/**
 * HTTP for the Gmail feature.
 *
 * Thin by design: every handler reads `req.userId` — the id the verified
 * token carried, never anything from the body — calls one service, and shapes
 * the response. No business rule lives here, so there is no path that reaches
 * Gmail without passing the ownership and permission checks the services do.
 *
 * Responses follow the shape the rest of this backend uses: `{success, data,
 * message}`, with `meta` carrying pagination.
 */

const ok = (res, data, message, meta) =>
  res.status(200).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
    message,
  });

// ──────────────────────────────── Accounts ─────────────────────────────────

/** POST /accounts/oauth/url */
exports.startConsent = asyncHandler(async (req, res) => {
  const result = await accountService.startConsent(req.userId, {
    accessLevel: req.body.accessLevel || "modify",
    platform: req.body.platform || "web",
    redirectUri: req.body.redirectUri,
    accountId: req.body.accountId,
  });
  ok(res, result, "Consent URL created");
});

/**
 * POST /accounts/oauth/exchange
 *
 * Finishes consent, then starts the watch and queues the first sync. Those
 * two are deliberately not awaited for their success: the mailbox is
 * connected either way, and a Pub/Sub topic that is not configured yet must
 * not make connecting fail. `onAccountConnected` reports what it managed.
 */
exports.completeConsent = asyncHandler(async (req, res) => {
  const result = await accountService.completeConsent(req.userId, {
    state: req.body.state,
    code: req.body.code,
  });

  const started = await watchService.onAccountConnected(result.account);

  res.status(201).json({
    success: true,
    data: { ...result, ...started },
    message: "Gmail mailbox connected",
  });
});

/** GET /accounts */
exports.listAccounts = asyncHandler(async (req, res) => {
  const result = await accountService.listAccounts(req.userId, {
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    status: req.query.status,
    sortBy: req.query.sortBy,
    descending: req.query.descending,
    accessLevel: req.query.accessLevel,
  });

  ok(res, result.accounts, "Mailboxes fetched successfully", {
    total: result.total,
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
  });
});

/** GET /accounts/:id */
exports.getAccount = asyncHandler(async (req, res) => {
  const account = await accountService.requireAccount(req.userId, req.params.id);
  ok(res, account, "Mailbox fetched successfully");
});

/** PATCH /accounts/:id */
exports.updateAccount = asyncHandler(async (req, res) => {
  const account = await accountService.updateAccount(req.userId, req.params.id, {
    displayName: req.body.displayName,
    sendAsName: req.body.sendAsName,
    signature: req.body.signature,
    isEnabled: req.body.isEnabled,
    isPrimary: req.body.isPrimary,
  });
  ok(res, account, "Mailbox updated successfully");
});

/** DELETE /accounts/:id — forgets the mailbox; Gmail keeps the mail. */
exports.removeAccount = asyncHandler(async (req, res) => {
  const removed = await accountService.removeAccount(req.userId, req.params.id);
  ok(res, removed, "Mailbox disconnected. Nothing was deleted from Gmail.");
});

/** POST /accounts/:id/signout */
exports.signOutAccount = asyncHandler(async (req, res) => {
  const account = await accountService.signOutAccount(req.userId, req.params.id);
  ok(res, account, "Mailbox signed out");
});

/**
 * POST /accounts/:id/sync
 *
 * Runs a pass now rather than waiting for the scheduler. Awaited, because a
 * caller that asked for a sync wants to know what it found — an incremental
 * pass is normally well under a second.
 */
exports.syncNow = asyncHandler(async (req, res) => {
  const account = await accountService.requireAccount(req.userId, req.params.id);
  const result = await syncService.syncAccount(account, {
    mode: req.body.mode || "auto",
    force: true,
  });
  ok(res, result, "Synchronization finished");
});

/** POST /accounts/:id/watch */
exports.startWatch = asyncHandler(async (req, res) => {
  const account = await accountService.requireAccount(req.userId, req.params.id);
  const result = await watchService.ensureWatch(account, { force: true });
  ok(res, result, "Push notifications enabled for this mailbox");
});

/** DELETE /accounts/:id/watch */
exports.stopWatch = asyncHandler(async (req, res) => {
  const account = await accountService.requireAccount(req.userId, req.params.id);
  const result = await watchService.stopWatch(account, { reason: "requested" });
  ok(
    res,
    result,
    "Push notifications stopped. The mailbox is still synced on a schedule.",
  );
});

// ───────────────────────────────── Reading ─────────────────────────────────

/** GET /messages */
exports.listMessages = asyncHandler(async (req, res) => {
  const result = await messageService.listMessages(req.userId, req.query);

  ok(res, result.messages, "Messages fetched successfully", {
    total: result.total,
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
    nextPageToken: result.nextPageToken,
    source: result.source,
  });
});

/** GET /threads */
exports.listThreads = asyncHandler(async (req, res) => {
  const result = await messageService.listThreads(req.userId, req.query);

  ok(res, result.threads, "Conversations fetched successfully", {
    total: result.total,
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
  });
});

/** GET /messages/:accountId/:gmailId */
exports.getMessage = asyncHandler(async (req, res) => {
  const result = await messageService.getMessage(
    req.userId,
    req.params.accountId,
    req.params.gmailId,
    { withBody: req.query.withBody !== "false" },
  );
  ok(res, result, "Message fetched successfully");
});

/** GET /threads/:accountId/:threadId */
exports.getThread = asyncHandler(async (req, res) => {
  const result = await messageService.getThread(
    req.userId,
    req.params.accountId,
    req.params.threadId,
    { withBodies: req.query.withBodies === "true" },
  );
  ok(res, result, "Conversation fetched successfully");
});

/**
 * GET /messages/:accountId/:gmailId/attachments/:attachmentId
 *
 * Sends the bytes with `Content-Disposition: attachment`, so a browser saves
 * it rather than trying to render somebody else's HTML or SVG on our origin.
 * The filename is quote-stripped for the same reason.
 */
exports.getAttachment = asyncHandler(async (req, res) => {
  const file = await messageService.getAttachment(
    req.userId,
    req.params.accountId,
    req.params.gmailId,
    req.params.attachmentId,
  );

  const safeName = String(file.filename).replace(/["\\\r\n]/g, "");
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Length", file.content.length);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeName}"; ` +
      `filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  );
  // Mail attachments are not ours and are not to be sniffed or framed.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.status(200).send(file.content);
});

/** GET /labels/:accountId */
exports.listLabels = asyncHandler(async (req, res) => {
  const labels = await messageService.listLabels(
    req.userId,
    req.params.accountId,
  );
  ok(res, labels, "Labels fetched successfully");
});

/** GET /unread-counts */
exports.unreadCounts = asyncHandler(async (req, res) => {
  const counts = await messageService.unreadCounts(req.userId);
  ok(res, counts, "Unread counts fetched successfully");
});

// ───────────────────────────────── Sending ─────────────────────────────────

/**
 * Collects anything multer parsed into the composition.
 *
 * A JSON caller passes `attachments` as base64 in the body; a multipart
 * caller sends files. Both are accepted, so a client does not have to change
 * shape to attach a file.
 */
const compositionFromRequest = (req) => ({
  ...req.body,
  attachments: [
    ...(Array.isArray(req.files) ? req.files : []),
    ...(Array.isArray(req.body.attachments)
      ? req.body.attachments.map((attachment) => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          content: attachment.content
            ? Buffer.from(attachment.content, "base64")
            : null,
          inline: attachment.inline === true,
          contentId: attachment.contentId || null,
        }))
      : []),
  ],
  actor: audit.userActor(req.userId),
});

/**
 * POST /messages/send
 *
 * 202, not 200: Gmail has accepted the message for delivery, which is all
 * anybody can honestly claim. The body says `accepted` for the same reason —
 * nothing here reports delivery or reading.
 */
exports.sendMessage = asyncHandler(async (req, res) => {
  const result = await sendService.sendMessage(
    req.userId,
    compositionFromRequest(req),
  );
  res.status(result.alreadySent ? 200 : 202).json({
    success: true,
    data: result,
    message: result.alreadySent
      ? "This message was already sent; returning the first result."
      : "Gmail accepted the message for delivery",
  });
});

/** POST /messages/reply */
exports.replyToMessage = asyncHandler(async (req, res) => {
  const result = await sendService.replyToMessage(
    req.userId,
    compositionFromRequest(req),
  );
  res.status(result.alreadySent ? 200 : 202).json({
    success: true,
    data: result,
    message: "Gmail accepted the reply for delivery",
  });
});

/** POST /messages/reply-all */
exports.replyAllToMessage = asyncHandler(async (req, res) => {
  const result = await sendService.replyAllToMessage(
    req.userId,
    compositionFromRequest(req),
  );
  res.status(result.alreadySent ? 200 : 202).json({
    success: true,
    data: result,
    message: "Gmail accepted the reply for delivery",
  });
});

/** POST /messages/forward */
exports.forwardMessage = asyncHandler(async (req, res) => {
  const result = await sendService.forwardMessage(
    req.userId,
    compositionFromRequest(req),
  );
  res.status(result.alreadySent ? 200 : 202).json({
    success: true,
    data: result,
    message: "Gmail accepted the forwarded message for delivery",
  });
});

/** GET /drafts */
exports.listDrafts = asyncHandler(async (req, res) => {
  const result = await sendService.listDrafts(req.userId, req.query);
  ok(res, result.drafts, "Drafts fetched successfully", {
    total: result.total,
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
  });
});

/** POST /drafts */
exports.createDraft = asyncHandler(async (req, res) => {
  const draft = await sendService.createDraft(
    req.userId,
    compositionFromRequest(req),
  );
  res.status(201).json({
    success: true,
    data: draft,
    message: "Draft saved",
  });
});

/** PATCH /drafts/:draftId */
exports.updateDraft = asyncHandler(async (req, res) => {
  const draft = await sendService.updateDraft(
    req.userId,
    req.params.draftId,
    compositionFromRequest(req),
  );
  ok(res, draft, "Draft updated");
});

/** POST /drafts/:draftId/send */
exports.sendDraft = asyncHandler(async (req, res) => {
  const result = await sendService.sendDraft(req.userId, req.params.draftId, {
    accountId: req.body.accountId,
    idempotencyKey: req.body.idempotencyKey,
    actor: audit.userActor(req.userId),
  });
  res.status(result.alreadySent ? 200 : 202).json({
    success: true,
    data: result,
    message: "Gmail accepted the message for delivery",
  });
});

/** DELETE /drafts/:draftId */
exports.deleteDraft = asyncHandler(async (req, res) => {
  const result = await sendService.deleteDraft(req.userId, req.params.draftId, {
    accountId: req.query.accountId || req.body.accountId,
    actor: audit.userActor(req.userId),
  });
  ok(res, result, "Draft discarded");
});

// ──────────────────────────────── Organizing ───────────────────────────────

/** The `{accountId, gmailIds}` every organize endpoint takes. */
const selection = (req) => ({
  accountId: req.body.accountId,
  gmailIds: req.body.gmailIds,
  actor: audit.userActor(req.userId),
});

/** POST /messages/modify-labels */
exports.modifyLabels = asyncHandler(async (req, res) => {
  const result = await organizeService.modifyLabels(
    req.userId,
    req.body.accountId,
    {
      gmailIds: req.body.gmailIds,
      addLabelIds: req.body.addLabelIds,
      removeLabelIds: req.body.removeLabelIds,
      actor: audit.userActor(req.userId),
    },
  );
  ok(res, result, "Labels updated");
});

/**
 * The simple organize verbs, each one a label change with a name.
 *
 * Generated rather than written out eleven times: they differ only in which
 * service function they call and what the response says, and eleven
 * near-identical handlers is eleven places for a copy-paste mistake.
 */
const simpleOperations = {
  markRead: [organizeService.markRead, "Marked as read"],
  markUnread: [organizeService.markUnread, "Marked as unread"],
  star: [organizeService.star, "Starred"],
  unstar: [organizeService.unstar, "Unstarred"],
  archive: [organizeService.archive, "Archived"],
  moveToInbox: [organizeService.moveToInbox, "Moved to the inbox"],
  markSpam: [organizeService.markSpam, "Reported as spam"],
  markNotSpam: [organizeService.markNotSpam, "No longer marked as spam"],
  trash: [organizeService.trash, "Moved to the trash"],
  untrash: [organizeService.untrash, "Restored from the trash"],
};

Object.entries(simpleOperations).forEach(([name, [operation, message]]) => {
  exports[name] = asyncHandler(async (req, res) => {
    const { accountId, gmailIds, actor } = selection(req);
    const result = await operation(req.userId, accountId, gmailIds, actor);
    ok(res, result, message);
  });
});

/** POST /messages/delete-forever */
exports.deleteForever = asyncHandler(async (req, res) => {
  const result = await organizeService.deleteForever(
    req.userId,
    req.body.accountId,
    req.body.gmailIds,
    {
      confirmPermanent: req.body.confirmPermanent === true,
      actor: audit.userActor(req.userId),
    },
  );
  ok(res, result, "Deleted permanently from Gmail");
});

/** POST /threads/:accountId/:threadId/modify-labels */
exports.modifyThreadLabels = asyncHandler(async (req, res) => {
  const result = await organizeService.modifyThreadLabels(
    req.userId,
    req.params.accountId,
    req.params.threadId,
    {
      addLabelIds: req.body.addLabelIds,
      removeLabelIds: req.body.removeLabelIds,
      actor: audit.userActor(req.userId),
    },
  );
  ok(res, result, "Conversation labels updated");
});

/** POST /threads/:accountId/:threadId/trash */
exports.trashThread = asyncHandler(async (req, res) => {
  const result = await organizeService.trashThread(
    req.userId,
    req.params.accountId,
    req.params.threadId,
    audit.userActor(req.userId),
  );
  ok(res, result, "Conversation moved to the trash");
});

/** DELETE /threads/:accountId/:threadId */
exports.deleteThreadForever = asyncHandler(async (req, res) => {
  const result = await organizeService.deleteThreadForever(
    req.userId,
    req.params.accountId,
    req.params.threadId,
    {
      confirmPermanent:
        req.body?.confirmPermanent === true ||
        req.query.confirmPermanent === "true",
      actor: audit.userActor(req.userId),
    },
  );
  ok(res, result, "Conversation deleted permanently from Gmail");
});

/** POST /labels/:accountId */
exports.createLabel = asyncHandler(async (req, res) => {
  const label = await organizeService.createLabel(
    req.userId,
    req.params.accountId,
    { ...req.body, actor: audit.userActor(req.userId) },
  );
  res.status(201).json({ success: true, data: label, message: "Label created" });
});

/** PATCH /labels/:accountId/:labelId */
exports.updateLabel = asyncHandler(async (req, res) => {
  const label = await organizeService.updateLabel(
    req.userId,
    req.params.accountId,
    req.params.labelId,
    { ...req.body, actor: audit.userActor(req.userId) },
  );
  ok(res, label, "Label updated");
});

/** DELETE /labels/:accountId/:labelId */
exports.deleteLabel = asyncHandler(async (req, res) => {
  const result = await organizeService.deleteLabel(
    req.userId,
    req.params.accountId,
    req.params.labelId,
    { actor: audit.userActor(req.userId) },
  );
  ok(res, result, "Label deleted");
});

// ──────────────────────── Contacts, history, diagnostics ───────────────────

/** GET /contacts */
exports.listContacts = asyncHandler(async (req, res) => {
  const result = await contactsService.listContacts(req.userId, req.query);
  ok(res, result.contacts, "Contacts fetched successfully", {
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
    source: result.source,
  });
});

/** GET /contacts/suggest */
exports.suggestRecipients = asyncHandler(async (req, res) => {
  const suggestions = await contactsService.suggestRecipients(
    req.userId,
    req.query,
  );
  ok(res, suggestions, "Suggestions fetched successfully");
});

/** GET /contacts/google/:accountId */
exports.listGoogleContacts = asyncHandler(async (req, res) => {
  const result = await contactsService.listGoogleContacts(
    req.userId,
    req.params.accountId,
  );
  ok(res, result, result.available ? "Contacts fetched" : result.reason);
});

/**
 * GET /operations
 *
 * The send history and audit trail: what was attempted, what Gmail accepted,
 * what failed and why, and whether a person or the system did it.
 */
exports.listOperations = asyncHandler(async (req, res) => {
  const result = await audit.history(req.userId, req.query);
  ok(res, result.entries, "Operation history fetched successfully", {
    total: result.total,
    page: result.page,
    limit: result.limit,
    hasMore: result.hasMore,
  });
});

/**
 * GET /health
 *
 * Whether the pieces this feature needs are configured, and how each mailbox
 * is doing. Per-user, so it answers "why is my mail not arriving" without
 * exposing anything about the deployment beyond which features are on.
 */
exports.health = asyncHandler(async (req, res) => {
  const { accounts } = await accountService.listAccounts(req.userId, {
    limit: 100,
  });

  ok(
    res,
    {
      // Which read path is in force, and therefore where mail is held.
      storage: storage.describe(),
      push: {
        // Whether Gmail can be asked to publish at all.
        watchConfigured: watchService.isConfigured(),
        topic: watchService.isConfigured() ? watchService.topicName() : null,
        // Whether our endpoint would accept a notification, and whether
        // Pub/Sub could deliver one to it. The second is the question that
        // is otherwise invisible from in here: a watch succeeds, Pub/Sub
        // accepts the subscription, and nothing ever arrives.
        endpointConfigured: pushService.isConfigured(),
        ...pushService.describeConfiguration(),
      },
      mailboxes: accounts.map((account) => ({
        id: String(account._id),
        email: account.email,
        needsReauth: account.needsReauth,
        accessLevel: account.accessLevel,
        sync: {
          status: account.syncState?.status || "idle",
          lastSyncAt: account.syncState?.lastSyncAt || null,
          nextSyncAt: account.syncState?.nextSyncAt || null,
          failureCount: account.syncState?.failureCount || 0,
          lastError: account.syncState?.lastError || null,
          hasCursor: Boolean(account.syncState?.lastHistoryId),
          initialSyncComplete: !account.syncState?.initialPageToken,
        },
        watch: {
          active: account.watch?.active === true,
          expiration: account.watch?.expiration || null,
          notifications: account.watch?.notificationCount || 0,
          lastNotificationAt: account.watch?.lastNotificationAt || null,
          lastError: account.watch?.lastError || null,
        },
      })),
    },
    "Gmail status fetched successfully",
  );
});

// ─────────────────────────────── Pub/Sub push ──────────────────────────────

/**
 * POST (mounted separately, no user token)
 *
 * The Pub/Sub endpoint. Answers 204 for anything it has dealt with —
 * including a duplicate and an unknown mailbox — because any other status
 * makes Pub/Sub retry. A 4xx goes back only for a request that is not
 * authentic or not a Pub/Sub envelope, and a 5xx only for a real transient
 * failure, which is the one case where a retry helps.
 */
exports.receivePush = asyncHandler(async (req, res) => {
  const result = await pushService.handleNotification({
    body: req.body,
    token: req.query.token,
    authorization: req.headers.authorization,
  });

  if (process.env.GMAIL_PUSH_DEBUG === "true") {
    console.log("[gmail-push]", result);
  }

  res.status(204).send();
});
