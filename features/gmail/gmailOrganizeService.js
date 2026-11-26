const ApiError = require("../../utils/apiError");
const { GmailMessage } = require("./gmailMessageModel");
const { GmailLabel } = require("./gmailLabelModel");
const accountService = require("./gmailAccountService");
const syncService = require("./gmailSyncService");
const audit = require("./gmailAuditService");
const events = require("./gmailEvents");
const storage = require("./gmailStorage");

/**
 * Organizing mail: read state, stars, archive, trash, labels.
 *
 * Gmail has no folders — only labels — so almost everything here is one
 * operation wearing different clothes. Archiving removes `INBOX`, marking
 * read removes `UNREAD`, starring adds `STARRED`. Writing them as one
 * primitive plus named wrappers means there is a single place where a label
 * change reaches Gmail and a single place where the local copy is brought
 * into line with it.
 *
 * **Gmail first, local second, and local only if Gmail agreed.** Every
 * operation calls Gmail and applies the change locally afterwards. Doing it
 * the other way — optimistically, then reconciling — would show the user a
 * state Gmail may refuse, and "it looked like it worked" is the hardest kind
 * of bug to report. The local write is not merely an optimization though: the
 * next history pass would apply the same change anyway, but a client that
 * refetches immediately would otherwise read a stale row.
 *
 * **Deleting is three different things**, and conflating them loses mail:
 *
 *   archive       — out of the inbox, still in All Mail. Reversible.
 *   trash         — in the bin, deleted by Gmail after 30 days. Reversible.
 *   deleteForever — gone now, irreversible, and refused unless the mailbox
 *                   was connected with full access.
 *
 * Nothing here treats one as another, and the API names them apart, so a
 * caller cannot destroy mail while meaning to tidy it.
 */

/** Ids per Gmail batch call. Google's documented ceiling is 1000. */
const MAX_BATCH_IDS = 1000;

const asArray = (value) => {
  if (value === undefined || value === null || value === "") return [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
};

/** Loads the caller's own messages by Gmail id, refusing the unknown ones. */
const loadMessages = async (account, gmailIds) => {
  const ids = asArray(gmailIds).map(String);
  if (ids.length === 0) {
    throw new ApiError("No messages were named", 400);
  }
  if (ids.length > MAX_BATCH_IDS) {
    throw new ApiError(
      `No more than ${MAX_BATCH_IDS} messages can be changed at once`,
      400,
    );
  }

  // In direct mode there are no local rows to look up, and requiring them
  // would make every organize action fail with "not in this mailbox". The
  // ownership check that matters already happened: the caller proved the
  // *mailbox* is theirs, and Gmail refuses an id that is not in it — so the
  // ids are passed through and Gmail is the one that validates them.
  if (!storage.keepsMessages()) {
    return {
      messages: ids.map((gmailId) => ({
        gmailId,
        threadId: null,
        labelIds: [],
      })),
      missing: [],
    };
  }

  const messages = await GmailMessage.find({
    accountId: account._id,
    gmailId: { $in: ids },
  }).select("gmailId threadId labelIds");

  if (messages.length === 0) {
    throw new ApiError("None of those messages are in this mailbox", 404);
  }

  // A partial match is reported rather than silently narrowed: a caller that
  // asked to archive ten messages and had seven archived needs to know.
  const found = new Set(messages.map((message) => message.gmailId));
  const missing = ids.filter((id) => !found.has(id));

  return { messages, missing };
};

/** Applies a label delta to a stored row and recomputes the flags. */
const applyLocally = async (message, addLabelIds, removeLabelIds) => {
  // Nothing to keep in step: the next read comes from Gmail.
  if (!storage.keepsMessages()) return null;

  const next = Array.from(
    new Set(
      (message.labelIds || [])
        .filter((label) => !removeLabelIds.includes(label))
        .concat(addLabelIds),
    ),
  );

  const flags = { labelIds: next };
  GmailMessage.applyLabelFlags(flags);
  await GmailMessage.updateOne({ _id: message._id }, { $set: flags });
  return flags;
};

/**
 * The primitive every organize operation goes through.
 *
 * One Gmail `batchModify` for the whole set, then the local rows, then the
 * affected threads, then one event per message. `batchModify` returns an
 * empty body on success, which is why the local state is computed from the
 * delta rather than read back from the response.
 */
const modifyLabels = async (
  userId,
  accountId,
  { gmailIds, addLabelIds = [], removeLabelIds = [], operation = "message.modifyLabels", actor },
) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "organize",
  );

  const add = asArray(addLabelIds).map(String);
  const remove = asArray(removeLabelIds).map(String);
  if (add.length === 0 && remove.length === 0) {
    throw new ApiError("Nothing to change: no labels were given", 400);
  }

  const overlap = add.filter((label) => remove.includes(label));
  if (overlap.length > 0) {
    throw new ApiError(
      `These labels are both added and removed: ${overlap.join(", ")}`,
      400,
    );
  }

  const { messages, missing } = await loadMessages(account, gmailIds);
  const ids = messages.map((message) => message.gmailId);

  const { entry } = await audit.claim({
    accountId: account._id,
    userId,
    operation,
    actor: actor || audit.userActor(userId),
    request: {
      addLabelIds: add,
      removeLabelIds: remove,
      targetGmailId: ids.length === 1 ? ids[0] : null,
    },
  });

  const client = accountService.clientFor(account);

  try {
    await client.messages.batchModify({
      ids,
      addLabelIds: add,
      removeLabelIds: remove,
    });

    const updated = await Promise.all(
      messages.map(async (message) => {
        const flags = await applyLocally(message, add, remove);
        events.messageUpdated({
          userId,
          accountId: account._id,
          message: {
            gmailId: message.gmailId,
            threadId: message.threadId,
            // In direct mode there is no stored label list to report the new
            // state from, so the frame names the delta that was applied and
            // the client applies the same one to the row it is showing.
            ...(flags || { addedLabelIds: add, removedLabelIds: remove }),
          },
          changed: [...add.map((l) => `+${l}`), ...remove.map((l) => `-${l}`)],
        });
        return message.threadId;
      }),
    );

    await Promise.all(
      Array.from(new Set(updated.filter(Boolean))).map((threadId) =>
        syncService.refreshThread(account, threadId),
      ),
    );

    await audit.succeeded(entry, {
      affected: ids.length,
      labelIds: add,
    });

    return {
      changed: ids.length,
      gmailIds: ids,
      missing,
      addLabelIds: add,
      removeLabelIds: remove,
    };
  } catch (error) {
    await audit.failed(entry, error);
    throw error;
  }
};

const markRead = (userId, accountId, gmailIds, actor) =>
  modifyLabels(userId, accountId, {
    gmailIds,
    removeLabelIds: ["UNREAD"],
    operation: "message.markRead",
    actor,
  });

const markUnread = (userId, accountId, gmailIds, actor) =>
  modifyLabels(userId, accountId, {
    gmailIds,
    addLabelIds: ["UNREAD"],
    operation: "message.markUnread",
    actor,
  });

const star = (userId, accountId, gmailIds, actor) =>
  modifyLabels(userId, accountId, {
    gmailIds,
    addLabelIds: ["STARRED"],
    operation: "message.star",
    actor,
  });

const unstar = (userId, accountId, gmailIds, actor) =>
  modifyLabels(userId, accountId, {
    gmailIds,
    removeLabelIds: ["STARRED"],
    operation: "message.unstar",
    actor,
  });

/** Out of the inbox, still in All Mail. Nothing is deleted. */
const archive = (userId, accountId, gmailIds, actor) =>
  modifyLabels(userId, accountId, {
    gmailIds,
    removeLabelIds: ["INBOX"],
    operation: "message.archive",
    actor,
  });

const moveToInbox = (userId, accountId, gmailIds, actor) =>
  modifyLabels(userId, accountId, {
    gmailIds,
    addLabelIds: ["INBOX"],
    // Un-archiving is the same operation as archiving, in reverse; there is
    // no separate audit verb for it because nothing different happened.
    operation: "message.modifyLabels",
    actor,
  });

/** Reported to Google as spam, and out of the inbox. */
const markSpam = (userId, accountId, gmailIds, actor) =>
  modifyLabels(userId, accountId, {
    gmailIds,
    addLabelIds: ["SPAM"],
    removeLabelIds: ["INBOX"],
    operation: "message.modifyLabels",
    actor,
  });

const markNotSpam = (userId, accountId, gmailIds, actor) =>
  modifyLabels(userId, accountId, {
    gmailIds,
    addLabelIds: ["INBOX"],
    removeLabelIds: ["SPAM"],
    operation: "message.modifyLabels",
    actor,
  });

/**
 * Moves messages to the trash.
 *
 * Gmail has a dedicated endpoint for this rather than a `TRASH` label write,
 * and it is used: trashing through the label would skip Gmail's own 30-day
 * expiry bookkeeping. There is no batch form, so this is one call per
 * message, run sequentially — a burst of parallel calls on a large selection
 * is how a rate limit is earned.
 */
const trash = async (userId, accountId, gmailIds, actor) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "trash",
  );
  const { messages, missing } = await loadMessages(account, gmailIds);

  const { entry } = await audit.claim({
    accountId: account._id,
    userId,
    operation: "message.trash",
    actor: actor || audit.userActor(userId),
    request: { targetGmailId: messages.length === 1 ? messages[0].gmailId : null },
  });

  const client = accountService.clientFor(account);
  const threadIds = new Set();
  const trashed = [];

  try {
    await messages.reduce(
      (previous, message) =>
        previous.then(async () => {
          const result = await client.messages.trash(message.gmailId);
          const labelIds = result.labelIds || [
            ...(message.labelIds || []).filter((label) => label !== "INBOX"),
            "TRASH",
          ];
          const flags = { labelIds };
          GmailMessage.applyLabelFlags(flags);
          await GmailMessage.updateOne({ _id: message._id }, { $set: flags });
          threadIds.add(message.threadId);
          trashed.push(message.gmailId);
        }),
      Promise.resolve(),
    );

    await Promise.all(
      Array.from(threadIds).map((threadId) =>
        syncService.refreshThread(account, threadId),
      ),
    );

    await audit.succeeded(entry, { affected: trashed.length });
    events.messageTrashed({
      userId,
      accountId: account._id,
      gmailIds: trashed,
    });

    return { trashed: trashed.length, gmailIds: trashed, missing };
  } catch (error) {
    await audit.failed(entry, error);
    // Whatever was trashed before the failure stays trashed, and the local
    // copy already reflects it. Reporting the count is the honest answer.
    if (trashed.length > 0) {
      events.messageTrashed({
        userId,
        accountId: account._id,
        gmailIds: trashed,
      });
    }
    throw error;
  }
};

/** Back out of the trash, to wherever its labels say it belongs. */
const untrash = async (userId, accountId, gmailIds, actor) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "trash",
  );
  const { messages, missing } = await loadMessages(account, gmailIds);

  const client = accountService.clientFor(account);
  const restored = [];
  const threadIds = new Set();

  await messages.reduce(
    (previous, message) =>
      previous.then(async () => {
        const result = await client.messages.untrash(message.gmailId);
        const labelIds =
          result.labelIds ||
          (message.labelIds || []).filter((label) => label !== "TRASH");
        const flags = { labelIds };
        GmailMessage.applyLabelFlags(flags);
        await GmailMessage.updateOne({ _id: message._id }, { $set: flags });
        threadIds.add(message.threadId);
        restored.push(message.gmailId);
      }),
    Promise.resolve(),
  );

  await Promise.all(
    Array.from(threadIds).map((threadId) =>
      syncService.refreshThread(account, threadId),
    ),
  );

  await audit.record({
    accountId: account._id,
    userId,
    operation: "message.untrash",
    actor: actor || audit.userActor(userId),
    result: { affected: restored.length },
  });
  events.messageUntrashed({
    userId,
    accountId: account._id,
    gmailIds: restored,
  });

  return { restored: restored.length, gmailIds: restored, missing };
};

/**
 * Deletes messages from Gmail, permanently.
 *
 * Irreversible, and refused unless the mailbox was connected with full
 * access — `gmail.modify` deliberately cannot do this, and that split is
 * kept rather than worked around. The caller must also pass
 * `confirmPermanent: true`: a destructive operation reached by a typo'd
 * route is a mailbox nobody can restore.
 */
const deleteForever = async (
  userId,
  accountId,
  gmailIds,
  { confirmPermanent = false, actor } = {},
) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "deleteForever",
  );

  if (confirmPermanent !== true) {
    throw new ApiError(
      "Permanent deletion needs confirmPermanent: true. This cannot be " +
        "undone — use the trash if you want it to be reversible.",
      400,
    );
  }

  const { messages, missing } = await loadMessages(account, gmailIds);

  const { entry } = await audit.claim({
    accountId: account._id,
    userId,
    operation: "message.deleteForever",
    actor: actor || audit.userActor(userId),
    request: {
      targetGmailId: messages.length === 1 ? messages[0].gmailId : null,
    },
  });

  const client = accountService.clientFor(account);
  const deleted = [];
  const threadIds = new Set();

  try {
    await messages.reduce(
      (previous, message) =>
        previous.then(async () => {
          await client.messages.delete(message.gmailId);
          await GmailMessage.deleteOne({ _id: message._id });
          threadIds.add(message.threadId);
          deleted.push(message.gmailId);
        }),
      Promise.resolve(),
    );

    await Promise.all(
      Array.from(threadIds).map((threadId) =>
        syncService.refreshThread(account, threadId),
      ),
    );

    await audit.succeeded(entry, { affected: deleted.length });
    events.messageDeleted({
      userId,
      accountId: account._id,
      gmailIds: deleted,
      permanent: true,
    });

    return { deleted: deleted.length, gmailIds: deleted, missing };
  } catch (error) {
    await audit.failed(entry, error);
    throw error;
  }
};

// ───────────────────────────────── Threads ─────────────────────────────────

/** The same label change, applied to every message in a conversation. */
const modifyThreadLabels = async (
  userId,
  accountId,
  threadId,
  { addLabelIds = [], removeLabelIds = [], actor } = {},
) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "organize",
  );

  const add = asArray(addLabelIds).map(String);
  const remove = asArray(removeLabelIds).map(String);
  if (add.length === 0 && remove.length === 0) {
    throw new ApiError("Nothing to change: no labels were given", 400);
  }

  const client = accountService.clientFor(account);
  await client.threads.modify(threadId, {
    addLabelIds: add,
    removeLabelIds: remove,
  });

  const messages = await GmailMessage.find({
    accountId: account._id,
    threadId,
  }).select("gmailId threadId labelIds");

  await Promise.all(
    messages.map((message) => applyLocally(message, add, remove)),
  );
  const thread = await syncService.refreshThread(account, threadId);

  await audit.record({
    accountId: account._id,
    userId,
    operation: "thread.modifyLabels",
    actor: actor || audit.userActor(userId),
    request: {
      targetThreadId: threadId,
      addLabelIds: add,
      removeLabelIds: remove,
    },
    result: { affected: messages.length },
  });

  if (thread) {
    events.threadUpdated({ userId, accountId: account._id, thread });
  }

  return { threadId, changed: messages.length };
};

const trashThread = async (userId, accountId, threadId, actor) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "trash",
  );

  const client = accountService.clientFor(account);
  await client.threads.trash(threadId);

  const messages = await GmailMessage.find({
    accountId: account._id,
    threadId,
  }).select("gmailId labelIds");

  await Promise.all(
    messages.map((message) => applyLocally(message, ["TRASH"], ["INBOX"])),
  );
  await syncService.refreshThread(account, threadId);

  await audit.record({
    accountId: account._id,
    userId,
    operation: "thread.trash",
    actor: actor || audit.userActor(userId),
    request: { targetThreadId: threadId },
    result: { affected: messages.length },
  });
  events.messageTrashed({
    userId,
    accountId: account._id,
    gmailIds: messages.map((message) => message.gmailId),
    threadId,
  });

  return { threadId, trashed: messages.length };
};

/** Permanently deletes a whole conversation. Same guards as one message. */
const deleteThreadForever = async (
  userId,
  accountId,
  threadId,
  { confirmPermanent = false, actor } = {},
) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "deleteForever",
  );

  if (confirmPermanent !== true) {
    throw new ApiError(
      "Permanent deletion needs confirmPermanent: true. This cannot be undone.",
      400,
    );
  }

  const client = accountService.clientFor(account);
  await client.threads.delete(threadId);

  const removed = await GmailMessage.deleteMany({
    accountId: account._id,
    threadId,
  });
  await syncService.refreshThread(account, threadId);

  await audit.record({
    accountId: account._id,
    userId,
    operation: "thread.deleteForever",
    actor: actor || audit.userActor(userId),
    request: { targetThreadId: threadId },
    result: { affected: removed.deletedCount || 0 },
  });
  events.messageDeleted({
    userId,
    accountId: account._id,
    gmailIds: [],
    permanent: true,
  });

  return { threadId, deleted: removed.deletedCount || 0 };
};

// ────────────────────────────────── Labels ─────────────────────────────────

/**
 * Creates a label.
 *
 * Mirrored locally straight away rather than waiting for a sync, because the
 * client is about to apply it to something.
 */
const createLabel = async (userId, accountId, input = {}) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "manageLabels",
  );

  const name = String(input.name || "").trim();
  if (!name) throw new ApiError("A label needs a name", 400);

  const client = accountService.clientFor(account);
  const label = await client.labels.create({
    name,
    labelListVisibility: input.labelListVisibility || "labelShow",
    messageListVisibility: input.messageListVisibility || "show",
    ...(input.color ? { color: input.color } : {}),
  });

  const saved = await GmailLabel.findOneAndUpdate(
    { accountId: account._id, labelId: label.id },
    {
      $set: {
        userId,
        name: label.name,
        type: "user",
        labelListVisibility: label.labelListVisibility || null,
        messageListVisibility: label.messageListVisibility || null,
        color: {
          textColor: label.color?.textColor || null,
          backgroundColor: label.color?.backgroundColor || null,
        },
        syncedAt: new Date(),
      },
      $setOnInsert: { accountId: account._id, labelId: label.id },
    },
    { new: true, upsert: true },
  );

  await audit.record({
    accountId: account._id,
    userId,
    operation: "label.create",
    actor: input.actor || audit.userActor(userId),
    request: { subject: name },
    result: { labelIds: [label.id] },
  });
  events.labelsChanged({ userId, accountId: account._id, count: 1 });

  return saved;
};

const updateLabel = async (userId, accountId, labelId, input = {}) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "manageLabels",
  );

  const existing = await GmailLabel.findOne({
    accountId: account._id,
    labelId,
  });
  if (!existing) throw new ApiError("Label not found in this mailbox", 404);
  if (existing.type === "system") {
    // Gmail would refuse this anyway; refusing here says why.
    throw new ApiError("Gmail's own labels cannot be renamed or deleted", 400);
  }

  const client = accountService.clientFor(account);
  const label = await client.labels.update(labelId, {
    ...(input.name ? { name: String(input.name).trim() } : {}),
    ...(input.labelListVisibility
      ? { labelListVisibility: input.labelListVisibility }
      : {}),
    ...(input.messageListVisibility
      ? { messageListVisibility: input.messageListVisibility }
      : {}),
    ...(input.color ? { color: input.color } : {}),
  });

  existing.name = label.name || existing.name;
  existing.labelListVisibility =
    label.labelListVisibility || existing.labelListVisibility;
  existing.messageListVisibility =
    label.messageListVisibility || existing.messageListVisibility;
  if (label.color) {
    existing.color = {
      textColor: label.color.textColor || null,
      backgroundColor: label.color.backgroundColor || null,
    };
  }
  existing.syncedAt = new Date();
  await existing.save();

  await audit.record({
    accountId: account._id,
    userId,
    operation: "label.update",
    actor: input.actor || audit.userActor(userId),
    request: { subject: existing.name },
    result: { labelIds: [labelId] },
  });
  events.labelsChanged({ userId, accountId: account._id, count: 1 });

  return existing;
};

/**
 * Deletes a label.
 *
 * The messages that carried it are untouched in Gmail, but their stored
 * `labelIds` now name something that no longer exists — so the id is pulled
 * from every local row and the flags recomputed. Leaving it would show a
 * phantom label on every message that had it until the next full sync.
 */
const deleteLabel = async (userId, accountId, labelId, input = {}) => {
  const account = await accountService.requireUsableAccount(
    userId,
    accountId,
    "manageLabels",
  );

  const existing = await GmailLabel.findOne({
    accountId: account._id,
    labelId,
  });
  if (!existing) throw new ApiError("Label not found in this mailbox", 404);
  if (existing.type === "system") {
    throw new ApiError("Gmail's own labels cannot be deleted", 400);
  }

  const client = accountService.clientFor(account);
  await client.labels.delete(labelId);

  await GmailLabel.deleteOne({ _id: existing._id });
  await GmailMessage.updateMany(
    { accountId: account._id, labelIds: labelId },
    { $pull: { labelIds: labelId } },
  );

  await audit.record({
    accountId: account._id,
    userId,
    operation: "label.delete",
    actor: input.actor || audit.userActor(userId),
    request: { subject: existing.name },
    result: { labelIds: [labelId] },
  });
  events.labelsChanged({ userId, accountId: account._id, count: 0 });

  return { labelId, deleted: true, name: existing.name };
};

module.exports = {
  MAX_BATCH_IDS,
  loadMessages,
  applyLocally,
  modifyLabels,
  markRead,
  markUnread,
  star,
  unstar,
  archive,
  moveToInbox,
  markSpam,
  markNotSpam,
  trash,
  untrash,
  deleteForever,
  modifyThreadLabels,
  trashThread,
  deleteThreadForever,
  createLabel,
  updateLabel,
  deleteLabel,
};
