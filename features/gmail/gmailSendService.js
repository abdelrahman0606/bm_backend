const ApiError = require("../../utils/apiError");
const { GmailMessage } = require("./gmailMessageModel");
const { GmailDraft } = require("./gmailDraftModel");
const accountService = require("./gmailAccountService");
const syncService = require("./gmailSyncService");
const messageService = require("./gmailMessageService");
const mime = require("./gmailMime");
const audit = require("./gmailAuditService");
const events = require("./gmailEvents");

/**
 * Sending, replying, forwarding and drafts.
 *
 * The honesty rule for this whole file: **we report what Gmail told us and
 * not one step further.** Gmail accepting a message and returning an id means
 * it is queued for delivery. It does not mean delivered, and it certainly
 * does not mean read. So the operation log's best outcome is `accepted`, the
 * event is `message.sent` meaning "Gmail took it", and nothing anywhere
 * claims a recipient received or opened anything. A bounce arrives later as
 * an ordinary inbound message from the mailer-daemon; it is not a status
 * change on the send, because the send genuinely did succeed.
 *
 * Two mechanics worth knowing about:
 *
 * **Threading is two separate things.** `threadId` groups the message in the
 * *sender's* Gmail. `In-Reply-To` and `References` are what make it a reply
 * in every other mail client on earth. A reply sets both; setting only the
 * first is the classic bug that produces a reply which threads for you and
 * nobody else.
 *
 * **Sending twice is the failure that matters.** A lost response on a slow
 * connection makes a client retry, and a duplicate email cannot be recalled.
 * So every send takes an optional `idempotencyKey`, enforced by a unique
 * index: the second attempt returns the first one's result instead of
 * sending again.
 */

/** Gmail's own ceiling on a message, attachments included. */
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

/** Addresses per send. Gmail's own limit is 100 recipients per message. */
const MAX_RECIPIENTS = 100;

const asAddress = (value) => {
  if (!value) return null;
  if (typeof value === "string") return mime.parseAddress(value);
  if (!value.email) return null;
  return {
    name: value.name || null,
    email: String(value.email).trim().toLowerCase(),
  };
};

const asAddressList = (value) =>
  (Array.isArray(value) ? value : [value])
    .map((entry) => asAddress(entry))
    .filter(Boolean);

/**
 * Checks a composed message before anything is sent.
 *
 * Deliberately strict and done up front: every failure here is one the user
 * can fix, and finding them after half the recipients have been accepted is
 * not an option — a send is not a transaction.
 */
const validateComposition = ({ to, cc, bcc, subject, text, html, attachments }) => {
  const recipients = [...to, ...cc, ...bcc];

  if (recipients.length === 0) {
    throw new ApiError("A message needs at least one recipient", 400);
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new ApiError(
      `A message cannot have more than ${MAX_RECIPIENTS} recipients. ` +
        `This one has ${recipients.length}.`,
      400,
    );
  }

  const invalid = recipients.filter(
    (address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email),
  );
  if (invalid.length > 0) {
    throw new ApiError(
      `These addresses are not valid: ${invalid
        .map((address) => address.email)
        .join(", ")}`,
      400,
    );
  }

  const hasBody = Boolean(text) || Boolean(html);
  if (!hasBody && !String(subject || "").trim()) {
    throw new ApiError("A message needs a subject or a body", 400);
  }

  const bytes = (attachments || []).reduce(
    (total, attachment) => total + (attachment.content?.length || 0),
    0,
  );
  // Base64 inflates by a third, and that is what travels, so the check is
  // against the encoded size rather than the raw bytes.
  if (bytes * 1.37 > MAX_MESSAGE_BYTES) {
    throw new ApiError(
      "The attachments are too large to send through Gmail (the limit is " +
        "25MB once encoded). Share a link instead.",
      400,
    );
  }

  return { recipients, attachmentBytes: bytes };
};

/** The `From` for a mailbox: the name the user chose, or the address. */
const senderFor = (account) => ({
  name: account.sendAsName || account.displayName || null,
  email: account.email,
});

/** Appends the mailbox's signature, if it has one and the caller allows it. */
const withSignature = (account, { text, html }, useSignature) => {
  if (!useSignature || !account.signature) return { text, html };

  const { signature } = account;
  return {
    text: text ? `${text}\n\n--\n${signature}` : text,
    html: html
      ? `${html}<br><br>--<br>${signature.replace(/\n/g, "<br>")}`
      : html,
  };
};

/**
 * Normalizes the attachments a controller hands over.
 *
 * Multer gives `{originalname, mimetype, buffer}`; a service call may give
 * `{filename, mimeType, content}`. Both are accepted so a caller does not
 * have to know which layer it is below.
 */
const normalizeAttachments = (attachments = []) =>
  (Array.isArray(attachments) ? attachments : [attachments])
    .filter(Boolean)
    .map((attachment) => ({
      filename:
        attachment.filename || attachment.originalname || "attachment",
      mimeType:
        attachment.mimeType ||
        attachment.mimetype ||
        "application/octet-stream",
      content: attachment.content || attachment.buffer || null,
      inline: attachment.inline === true,
      contentId: attachment.contentId || null,
    }))
    .filter((attachment) => attachment.content);

/** Fetches a just-sent message and stores it, linked to its log entry. */
const storeSentMessage = async (account, gmailId, operationLogId) => {
  if (!gmailId) return null;

  const client = accountService.clientFor(account);
  const raw = await client.messages.get(gmailId, { format: "full" });
  const { message } = await syncService.storeMessage(account, raw, {
    origin: "sent",
    storeBody: true,
  });

  await GmailMessage.updateOne(
    { _id: message._id },
    { $set: { operationLogId } },
  );
  await syncService.refreshThread(account, message.threadId);
  return message;
};

/**
 * The one path every send goes through.
 *
 * Claim the log entry, build the message, hand it to Gmail, record what
 * happened, store the result locally so the Sent list is right before the
 * next sync, and publish. The order matters: the log entry exists before the
 * send, so a crash mid-flight leaves a `queued` row rather than no evidence
 * that anything was attempted.
 */
const performSend = async ({
  account,
  userId,
  operation,
  composition,
  threadId = null,
  inReplyTo = null,
  references = [],
  idempotencyKey = null,
  actor,
}) => {
  const { recipients, attachmentBytes } = validateComposition(composition);

  const { entry, duplicate } = await audit.claim({
    accountId: account._id,
    userId,
    operation,
    actor: actor || audit.userActor(userId),
    idempotencyKey,
    request: {
      to: composition.to,
      cc: composition.cc,
      bcc: composition.bcc,
      subject: composition.subject || null,
      attachmentCount: (composition.attachments || []).length,
      attachmentBytes,
      targetThreadId: threadId,
    },
  });

  if (duplicate) {
    // The same key was used before. Returning that attempt's outcome is the
    // whole point: the alternative is a second copy in the recipient's inbox.
    return {
      alreadySent: true,
      operationId: duplicate._id,
      status: duplicate.status,
      gmailMessageId: duplicate.result?.gmailMessageId || null,
      threadId: duplicate.result?.threadId || null,
    };
  }

  const raw = mime.buildMessage({
    from: senderFor(account),
    to: composition.to,
    cc: composition.cc,
    bcc: composition.bcc,
    subject: composition.subject,
    text: composition.text,
    html: composition.html,
    attachments: composition.attachments,
    inReplyTo,
    references,
  });

  const client = accountService.clientFor(account);

  try {
    const sent = await client.messages.send({
      raw,
      ...(threadId ? { threadId } : {}),
    });

    await audit.succeeded(entry, {
      gmailMessageId: sent.id || null,
      threadId: sent.threadId || null,
      labelIds: sent.labelIds || [],
      affected: recipients.length,
    });

    // Store it now rather than waiting for the next sync, so the Sent list
    // and the thread are correct the instant the request returns. The fetch
    // is best-effort: the message is sent either way, and the sync will pick
    // it up regardless.
    const stored = await storeSentMessage(account, sent.id, entry._id).catch(
      (error) => {
        console.warn(
          `[gmail] sent ${sent.id} but could not store it locally: ${error.message}`,
        );
        return null;
      },
    );

    events.messageSent({
      userId,
      accountId: account._id,
      operationId: entry._id,
      message: {
        gmailId: sent.id,
        threadId: sent.threadId,
        subject: composition.subject,
        to: composition.to,
      },
    });

    return {
      operationId: entry._id,
      // Named for what Gmail actually promised: it accepted the message.
      status: "accepted",
      gmailMessageId: sent.id || null,
      threadId: sent.threadId || null,
      message: stored,
      recipients: recipients.length,
    };
  } catch (error) {
    await audit.failed(entry, error);
    events.messageSendFailed({
      userId,
      accountId: account._id,
      operationId: entry._id,
      subject: composition.subject,
      to: composition.to,
      error,
    });
    throw error;
  }
};

/** Resolves the mailbox to send from: the one named, or the default. */
const resolveSender = async (userId, accountId) => {
  if (accountId) {
    return accountService.requireUsableAccount(userId, accountId, "send");
  }

  const primary = await accountService.primaryAccount(userId);
  if (!primary) {
    throw new ApiError(
      "No Gmail mailbox is connected. Connect one before sending.",
      400,
    );
  }
  if (primary.needsReauth) {
    throw new ApiError(
      `${primary.email} needs to be reconnected before it can send.`,
      401,
    );
  }
  // The level is checked even for the default mailbox: "it was the default"
  // is not permission to send.
  return accountService.requireUsableAccount(userId, primary._id, "send");
};

const compositionFrom = (account, input) => {
  const bodies = withSignature(
    account,
    { text: input.text || null, html: input.html || null },
    input.useSignature !== false,
  );

  return {
    to: asAddressList(input.to || []),
    cc: asAddressList(input.cc || []),
    bcc: asAddressList(input.bcc || []),
    subject: input.subject || "",
    text: bodies.text,
    html: bodies.html,
    attachments: normalizeAttachments(input.attachments),
  };
};

/** Sends a new message. */
const sendMessage = async (userId, input = {}) => {
  const account = await resolveSender(userId, input.accountId);

  return performSend({
    account,
    userId,
    operation: "message.send",
    composition: compositionFrom(account, input),
    idempotencyKey: input.idempotencyKey || null,
    actor: input.actor,
  });
};

/**
 * Loads the message being answered, and works out the threading headers.
 *
 * `References` is the original's chain plus its own `Message-ID`, which is
 * what a conforming client expects and what makes long threads stay whole.
 */
const replyContext = async (account, gmailId) => {
  const original = await GmailMessage.findOne({
    accountId: account._id,
    gmailId,
  });
  if (!original) {
    throw new ApiError("The message being replied to was not found", 404);
  }

  const references = [
    ...(original.references || []),
    original.rfcMessageId,
  ].filter(Boolean);

  return {
    original,
    threadId: original.threadId,
    inReplyTo: original.rfcMessageId || null,
    references,
  };
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Builds a reply body with the original quoted beneath it.
 *
 * The quote is built from the original's *plain text*, even for the HTML
 * alternative, where it becomes a `<blockquote>`. Re-emitting a stranger's
 * HTML inside our own message means trusting their markup; quoting the text
 * is safe, and it is what the reader expects to see.
 */
const quotedBody = async (account, original, input) => {
  if (input.quoteOriginal === false) {
    return { text: input.text || null, html: input.html || null };
  }

  // The body may not have been kept at sync time; fetch it so the quote is
  // not empty. A failure here must not stop the reply going out.
  let source = original;
  if (!original.bodyText && !original.bodyHtml) {
    try {
      source = await messageService.ensureBody(account, original);
    } catch (error) {
      console.warn(
        `[gmail] replying without a quote: ${error.message}`,
      );
    }
  }

  const plain =
    source.bodyText ||
    // No plain alternative: strip the markup rather than quote tags at the
    // reader. Crude on purpose — it is a quote, not a rendering.
    (source.bodyHtml
      ? String(source.bodyHtml)
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/p>/gi, "\n\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .trim()
      : source.snippet || "");

  const quote = mime.quoteForReply({
    from: source.from,
    date: source.internalDate,
    text: plain,
  });

  const text = input.text ? `${input.text}\n\n${quote}` : quote;
  const html = input.html
    ? `${input.html}<br><br><blockquote style="margin:0 0 0 .8ex;` +
      `border-left:2px solid #ccc;padding-left:1ex">` +
      `${escapeHtml(plain).replace(/\n/g, "<br>")}</blockquote>`
    : null;

  return { text, html };
};

/**
 * Replies to the sender.
 *
 * `Reply-To` wins over `From` when the original set it — that header exists
 * precisely to say "answer here", and ignoring it sends replies to a
 * no-reply address.
 */
const replyToMessage = async (userId, input = {}) => {
  const account = await resolveSender(userId, input.accountId);
  const context = await replyContext(account, input.gmailId);
  const { original } = context;

  const target =
    original.replyTo && original.replyTo.length > 0
      ? original.replyTo
      : [original.from];

  const quoted = await quotedBody(account, original, input);

  return performSend({
    account,
    userId,
    operation: "message.reply",
    composition: compositionFrom(account, {
      ...input,
      to: input.to || target,
      cc: input.cc || [],
      subject: input.subject || mime.prefixSubject(original.subject, "Re"),
      text: quoted.text,
      html: quoted.html,
    }),
    threadId: context.threadId,
    inReplyTo: context.inReplyTo,
    references: context.references,
    idempotencyKey: input.idempotencyKey || null,
    actor: input.actor,
  });
};

/**
 * Replies to everyone.
 *
 * The sender's own address is removed from the recipients — replying to all
 * should not send you your own mail — and so are duplicates between To and
 * Cc, since Gmail would deliver twice.
 */
const replyAllToMessage = async (userId, input = {}) => {
  const account = await resolveSender(userId, input.accountId);
  const context = await replyContext(account, input.gmailId);
  const { original } = context;

  const primary =
    original.replyTo && original.replyTo.length > 0
      ? original.replyTo
      : [original.from];

  const self = String(account.email).toLowerCase();
  const seen = new Set([self]);

  const dedupe = (addresses) =>
    addresses.filter((address) => {
      const email = String(address?.email || "").toLowerCase();
      if (!email || seen.has(email)) return false;
      seen.add(email);
      return true;
    });

  const to = dedupe([...primary, ...(original.to || [])]);
  const cc = dedupe(original.cc || []);

  if (to.length === 0 && cc.length === 0) {
    throw new ApiError(
      "There is nobody to reply to: every recipient of that message was " +
        "this mailbox.",
      400,
    );
  }

  const quoted = await quotedBody(account, original, input);

  return performSend({
    account,
    userId,
    operation: "message.replyAll",
    composition: compositionFrom(account, {
      ...input,
      to: input.to || to,
      cc: input.cc || cc,
      subject: input.subject || mime.prefixSubject(original.subject, "Re"),
      text: quoted.text,
      html: quoted.html,
    }),
    threadId: context.threadId,
    inReplyTo: context.inReplyTo,
    references: context.references,
    idempotencyKey: input.idempotencyKey || null,
    actor: input.actor,
  });
};

/** Pulls attachment bytes back out of Gmail so they can be re-sent. */
const fetchAttachments = async (account, gmailId, descriptors) => {
  if (descriptors.length === 0) return [];

  const client = accountService.clientFor(account);
  const total = descriptors.reduce(
    (sum, descriptor) => sum + (descriptor.size || 0),
    0,
  );
  if (total * 1.37 > MAX_MESSAGE_BYTES) {
    throw new ApiError(
      "This message's attachments are too large to forward through Gmail. " +
        "Forward it without them, or share a link.",
      400,
    );
  }

  return descriptors.reduce(
    (previous, descriptor) =>
      previous.then(async (all) => {
        const response = await client.messages.attachment(
          gmailId,
          descriptor.attachmentId,
        );
        if (!response.data) return all;
        return [
          ...all,
          {
            filename: descriptor.filename || "attachment",
            mimeType: descriptor.mimeType || "application/octet-stream",
            content: mime.decodeBase64Url(response.data),
          },
        ];
      }),
    Promise.resolve([]),
  );
};

/**
 * Forwards a message.
 *
 * Starts a new conversation rather than continuing the original: a forward
 * carries no `In-Reply-To` and no `threadId`, because the new recipient was
 * never part of that thread. Attachments are re-fetched from Gmail and
 * re-attached, which is what makes it a forward rather than a description of
 * one.
 */
const forwardMessage = async (userId, input = {}) => {
  const account = await resolveSender(userId, input.accountId);

  const original = await GmailMessage.findOne({
    accountId: account._id,
    gmailId: input.gmailId,
  });
  if (!original) {
    throw new ApiError("The message being forwarded was not found", 404);
  }

  let source = original;
  if (!original.bodyText && !original.bodyHtml) {
    source = await messageService
      .ensureBody(account, original)
      .catch(() => original);
  }

  const header =
    `---------- Forwarded message ----------\n` +
    `From: ${mime.formatAddress(source.from) || "unknown"}\n` +
    `Date: ${
      source.internalDate ? new Date(source.internalDate).toUTCString() : ""
    }\n` +
    `Subject: ${source.subject || ""}\n` +
    `To: ${mime.formatAddressList(source.to || []) || ""}\n`;

  const body = source.bodyText || source.snippet || "";
  const text = input.text
    ? `${input.text}\n\n${header}\n${body}`
    : `${header}\n${body}`;

  // Only real attachments travel. Inline images belong to a body we are not
  // re-emitting, so forwarding them would attach decorations as files.
  const carry = (source.attachments || []).filter(
    (attachment) => attachment.attachmentId && !attachment.inline,
  );
  const attachments =
    input.includeAttachments === false
      ? []
      : await fetchAttachments(account, source.gmailId, carry);

  return performSend({
    account,
    userId,
    operation: "message.forward",
    composition: compositionFrom(account, {
      ...input,
      subject: input.subject || mime.prefixSubject(source.subject, "Fwd"),
      text,
      html: input.html || null,
      attachments: [...normalizeAttachments(input.attachments), ...attachments],
    }),
    idempotencyKey: input.idempotencyKey || null,
    actor: input.actor,
  });
};

// ─────────────────────────────────  Drafts  ─────────────────────────────────

/** Mirrors a Gmail draft locally after it is created or changed. */
const storeDraft = async (account, draft, composition, context = {}) => {
  const saved = await GmailDraft.findOneAndUpdate(
    { accountId: account._id, draftId: draft.id },
    {
      $set: {
        userId: account.userId,
        messageGmailId: draft.message?.id || null,
        threadId: draft.message?.threadId || context.threadId || null,
        to: composition.to,
        cc: composition.cc,
        bcc: composition.bcc,
        subject: composition.subject || "",
        bodyText: composition.text || null,
        bodyHtml: composition.html || null,
        attachments: (composition.attachments || []).map((attachment) => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.content ? attachment.content.length : 0,
        })),
        inReplyTo: context.inReplyTo || null,
        references: context.references || [],
        status: "draft",
        lastError: null,
        syncedAt: new Date(),
      },
      $setOnInsert: { accountId: account._id, draftId: draft.id },
    },
    { new: true, upsert: true },
  );

  events.draftSaved({
    userId: account.userId,
    accountId: account._id,
    draft: saved,
  });
  return saved;
};

/** Creates a draft. Needs send permission: a draft is a message in waiting. */
const createDraft = async (userId, input = {}) => {
  const account = await resolveSender(userId, input.accountId);
  const composition = compositionFrom(account, input);

  // Validated like a send, so a draft cannot be saved in a state that can
  // never be sent — except that a draft may legitimately have no recipient
  // yet, which is the one rule relaxed here.
  if ([...composition.to, ...composition.cc, ...composition.bcc].length > 0) {
    validateComposition(composition);
  }

  let context = {};
  if (input.replyToGmailId) {
    const reply = await replyContext(account, input.replyToGmailId);
    context = {
      threadId: reply.threadId,
      inReplyTo: reply.inReplyTo,
      references: reply.references,
    };
  }

  const raw = mime.buildMessage({
    from: senderFor(account),
    to: composition.to,
    cc: composition.cc,
    bcc: composition.bcc,
    subject: composition.subject,
    text: composition.text,
    html: composition.html,
    attachments: composition.attachments,
    inReplyTo: context.inReplyTo,
    references: context.references,
  });

  const client = accountService.clientFor(account);
  const draft = await client.drafts.create({
    raw,
    threadId: context.threadId,
  });

  await audit.record({
    accountId: account._id,
    userId,
    operation: "draft.create",
    actor: input.actor || audit.userActor(userId),
    request: {
      to: composition.to,
      cc: composition.cc,
      bcc: composition.bcc,
      subject: composition.subject,
      attachmentCount: composition.attachments.length,
    },
    result: { draftId: draft.id, threadId: draft.message?.threadId || null },
  });

  return storeDraft(account, draft, composition, context);
};

/** Replaces a draft's contents. Gmail has no partial update for these. */
const updateDraft = async (userId, draftId, input = {}) => {
  const account = await resolveSender(userId, input.accountId);

  const existing = await GmailDraft.findOne({
    accountId: account._id,
    draftId,
  });
  if (!existing) throw new ApiError("Draft not found", 404);

  const composition = compositionFrom(account, input);
  const context = {
    threadId: existing.threadId,
    inReplyTo: existing.inReplyTo,
    references: existing.references,
  };

  const raw = mime.buildMessage({
    from: senderFor(account),
    to: composition.to,
    cc: composition.cc,
    bcc: composition.bcc,
    subject: composition.subject,
    text: composition.text,
    html: composition.html,
    attachments: composition.attachments,
    inReplyTo: context.inReplyTo,
    references: context.references,
  });

  const client = accountService.clientFor(account);
  const draft = await client.drafts.update(draftId, {
    raw,
    threadId: context.threadId || undefined,
  });

  await audit.record({
    accountId: account._id,
    userId,
    operation: "draft.update",
    actor: input.actor || audit.userActor(userId),
    request: { subject: composition.subject, targetGmailId: draftId },
    result: { draftId },
  });

  return storeDraft(account, draft, composition, context);
};

/**
 * Sends a draft.
 *
 * Gmail sends what the draft holds, so the composition is not rebuilt here —
 * which also means the draft is the single source of truth for what went
 * out, with no chance of this layer and Gmail disagreeing about it.
 */
const sendDraft = async (userId, draftId, input = {}) => {
  const account = await resolveSender(userId, input.accountId);

  const draft = await GmailDraft.findOne({ accountId: account._id, draftId });
  if (!draft) throw new ApiError("Draft not found", 404);
  if (draft.status === "sent") {
    throw new ApiError("That draft has already been sent", 409);
  }

  const { entry, duplicate } = await audit.claim({
    accountId: account._id,
    userId,
    operation: "draft.send",
    actor: input.actor || audit.userActor(userId),
    idempotencyKey: input.idempotencyKey || null,
    request: {
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      attachmentCount: (draft.attachments || []).length,
      targetGmailId: draftId,
    },
  });

  if (duplicate) {
    return {
      alreadySent: true,
      operationId: duplicate._id,
      status: duplicate.status,
      gmailMessageId: duplicate.result?.gmailMessageId || null,
    };
  }

  const client = accountService.clientFor(account);

  try {
    const sent = await client.drafts.send(draftId);

    await audit.succeeded(entry, {
      gmailMessageId: sent.id || null,
      threadId: sent.threadId || null,
      draftId,
      affected: (draft.to || []).length,
    });

    draft.status = "sent";
    draft.messageGmailId = sent.id || draft.messageGmailId;
    await draft.save();

    const stored = await storeSentMessage(account, sent.id, entry._id).catch(
      () => null,
    );

    events.messageSent({
      userId,
      accountId: account._id,
      operationId: entry._id,
      message: {
        gmailId: sent.id,
        threadId: sent.threadId,
        subject: draft.subject,
        to: draft.to,
      },
    });

    return {
      operationId: entry._id,
      status: "accepted",
      gmailMessageId: sent.id || null,
      threadId: sent.threadId || null,
      message: stored,
    };
  } catch (error) {
    await audit.failed(entry, error);
    draft.lastError = error.message;
    await draft.save();
    events.messageSendFailed({
      userId,
      accountId: account._id,
      operationId: entry._id,
      subject: draft.subject,
      to: draft.to,
      error,
    });
    throw error;
  }
};

const deleteDraft = async (userId, draftId, input = {}) => {
  const account = await resolveSender(userId, input.accountId);

  const draft = await GmailDraft.findOne({ accountId: account._id, draftId });
  if (!draft) throw new ApiError("Draft not found", 404);

  const client = accountService.clientFor(account);
  await client.drafts.delete(draftId);

  draft.status = "discarded";
  await draft.save();
  await GmailDraft.deleteOne({ _id: draft._id });

  await audit.record({
    accountId: account._id,
    userId,
    operation: "draft.delete",
    actor: input.actor || audit.userActor(userId),
    request: { targetGmailId: draftId },
  });

  events.draftDeleted({ userId, accountId: account._id, draftId });
  return { draftId, deleted: true };
};

/** This user's drafts, newest first. */
const listDrafts = async (userId, options = {}) => {
  const page = Math.max(0, Number(options.page) || 0);
  const limit = Math.min(Math.max(1, Number(options.limit) || 25), 100);

  const query = { userId, status: "draft" };
  if (options.accountId) {
    const account = await accountService.requireAccount(
      userId,
      options.accountId,
    );
    query.accountId = account._id;
  }

  const [drafts, total] = await Promise.all([
    GmailDraft.find(query)
      .sort({ updatedAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .lean(),
    GmailDraft.countDocuments(query),
  ]);

  return {
    drafts,
    total,
    page,
    limit,
    hasMore: (page + 1) * limit < total,
  };
};

module.exports = {
  MAX_MESSAGE_BYTES,
  MAX_RECIPIENTS,
  asAddress,
  asAddressList,
  validateComposition,
  senderFor,
  normalizeAttachments,
  compositionFrom,
  resolveSender,
  performSend,
  sendMessage,
  replyToMessage,
  replyAllToMessage,
  forwardMessage,
  storeSentMessage,
  createDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
  listDrafts,
};
