const mongoose = require("mongoose");
const axios = require("axios");
const { GmailMessage } = require("./gmailMessageModel");
const accountService = require("./gmailAccountService");
const tokenService = require("./gmailTokenService");
const gmailScopes = require("./gmailScopes");

/**
 * Who the user corresponds with.
 *
 * Built from the mailbox itself rather than from Google Contacts, and that is
 * the main decision here. The People API would need `contacts.readonly` — a
 * *second* restricted scope on a consent screen that already asks for mail
 * access, reviewed separately, for data that is mostly worse: a contact list
 * is often stale and half-empty, while the mailbox knows exactly who this
 * person actually writes to and how recently.
 *
 * So the default source is an aggregation over synced messages, and the
 * People API is used only when the grant happens to include the scope —
 * `listGoogleContacts` reports plainly that it is unavailable rather than
 * failing, and nothing in this feature asks for that scope on its own.
 *
 * **Ranking.** A suggestion list is judged by whether the right address is
 * first. Frequency alone puts a mailing list above a colleague; recency alone
 * puts whoever mailed you this morning above everyone. The score combines
 * them, and an address the user has *written to* counts for more than one
 * that merely wrote to them — having sent to someone is far better evidence
 * that you mean to send to them again than having received spam from them.
 */

/** How many messages back the aggregation looks. */
const SCAN_LIMIT = 5000;

/** Weight of a sent-to address relative to a received-from one. */
const SENT_WEIGHT = 3;

/** Most the recency bonus can add, and how long it takes to decay to zero. */
const RECENCY_BONUS_MAX = 10;
const RECENCY_WINDOW_DAYS = 60;

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const asObjectId = (value) => new mongoose.Types.ObjectId(String(value));

/**
 * Aggregates correspondents out of the stored mail.
 *
 * One pipeline rather than a maintained contacts collection: the data is
 * already there, derived values cannot drift from their source, and there is
 * nothing to backfill when a mailbox is re-synced. It scans the most recent
 * `SCAN_LIMIT` messages, which bounds the cost on a large mailbox — a
 * correspondent not seen in the last five thousand messages is not a
 * suggestion anybody wants.
 */
const aggregateContacts = async (
  userId,
  { accountIds = null, search = null, limit = 50, skip = 0, now = new Date() } = {},
) => {
  const match = { userId: asObjectId(userId), isSpam: false };
  if (accountIds && accountIds.length > 0) {
    match.accountId = { $in: accountIds.map(asObjectId) };
  }

  const pipeline = [
    { $match: match },
    { $sort: { internalDate: -1 } },
    { $limit: SCAN_LIMIT },
    {
      $project: {
        accountId: 1,
        internalDate: 1,
        isSent: 1,
        // Each address is tagged with the direction it was seen in, which is
        // what the weighting needs.
        people: {
          $concatArrays: [
            {
              $map: {
                input: { $ifNull: [["$from"], []] },
                as: "person",
                in: { person: "$$person", sent: false },
              },
            },
            {
              $map: {
                input: { $ifNull: ["$to", []] },
                as: "person",
                in: { person: "$$person", sent: true },
              },
            },
            {
              $map: {
                input: { $ifNull: ["$cc", []] },
                as: "person",
                in: { person: "$$person", sent: true },
              },
            },
          ],
        },
      },
    },
    { $unwind: "$people" },
    { $match: { "people.person.email": { $nin: [null, ""] } } },
    {
      $group: {
        _id: "$people.person.email",
        // The most recent non-empty display name wins: names change, and the
        // newest spelling is the one the user will recognize.
        name: {
          $first: {
            $cond: [
              { $ifNull: ["$people.person.name", false] },
              "$people.person.name",
              null,
            ],
          },
        },
        messages: { $sum: 1 },
        sentTo: { $sum: { $cond: ["$people.sent", 1, 0] } },
        receivedFrom: { $sum: { $cond: ["$people.sent", 0, 1] } },
        lastSeenAt: { $max: "$internalDate" },
        accountIds: { $addToSet: "$accountId" },
      },
    },
  ];

  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    pipeline.push({
      $match: { $or: [{ _id: pattern }, { name: pattern }] },
    });
  }

  pipeline.push(
    {
      $addFields: {
        // Frequency, with sent-to counting for more, plus a bounded recency
        // bonus. Both halves have to stay comparable in size: raw days since
        // the epoch would swamp the counts entirely, and a fraction of them
        // would vanish against them. So recency is capped at
        // `RECENCY_BONUS_MAX` points, decaying to nothing over
        // `RECENCY_WINDOW_DAYS`, which keeps the order explainable — the
        // thing a suggestion list is actually judged on.
        score: {
          $add: [
            { $multiply: ["$sentTo", SENT_WEIGHT] },
            "$receivedFrom",
            {
              $max: [
                0,
                {
                  $multiply: [
                    {
                      $subtract: [
                        1,
                        {
                          $divide: [
                            {
                              $subtract: [
                                now,
                                { $ifNull: ["$lastSeenAt", new Date(0)] },
                              ],
                            },
                            RECENCY_WINDOW_DAYS * 86400000,
                          ],
                        },
                      ],
                    },
                    RECENCY_BONUS_MAX,
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    { $sort: { score: -1, lastSeenAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        email: "$_id",
        name: 1,
        messages: 1,
        sentTo: 1,
        receivedFrom: 1,
        lastSeenAt: 1,
        accountIds: 1,
      },
    },
  );

  const rows = await GmailMessage.aggregate(pipeline).allowDiskUse(true);

  return rows.map((row) => ({
    ...row,
    accountIds: (row.accountIds || []).map(String),
  }));
};

/** Resolves and verifies the accounts a request names. */
const resolveAccountIds = async (userId, accountId) => {
  if (!accountId) return null;
  // `?accountId=a,b` as well as `?accountId=a&accountId=b`; see the note on
  // `toArray` in gmailMessageService.
  const ids = (Array.isArray(accountId) ? accountId : [accountId])
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : [entry]))
    .map((entry) => (typeof entry === "string" ? entry.trim() : entry))
    .filter(Boolean);
  if (ids.length === 0) return null;
  const accounts = await Promise.all(
    ids.map((id) => accountService.requireAccount(userId, id)),
  );
  return accounts.map((account) => account._id);
};

/**
 * Recipient suggestions for a compose box.
 *
 * Small and fast by design: this runs on every keystroke, so the result is
 * capped tightly and the shape is the minimum an autocomplete needs.
 */
const suggestRecipients = async (userId, { accountId, query, limit = 10 } = {}) => {
  const accountIds = await resolveAccountIds(userId, accountId);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 25);

  const contacts = await aggregateContacts(userId, {
    accountIds,
    search: query ? String(query).trim() : null,
    limit: safeLimit,
  });

  return contacts.map((contact) => ({
    email: contact.email,
    name: contact.name || null,
    messages: contact.messages,
    lastSeenAt: contact.lastSeenAt,
  }));
};

/** The full correspondent list, paginated. */
const listContacts = async (
  userId,
  { accountId, search, page = 0, limit = 50 } = {},
) => {
  const accountIds = await resolveAccountIds(userId, accountId);
  const safePage = Math.max(0, Number(page) || 0);
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);

  const contacts = await aggregateContacts(userId, {
    accountIds,
    search: search ? String(search).trim() : null,
    limit: safeLimit,
    skip: safePage * safeLimit,
  });

  return {
    contacts,
    page: safePage,
    limit: safeLimit,
    // No total: counting distinct correspondents means running the whole
    // pipeline twice, and `hasMore` is what a paginated list actually needs.
    hasMore: contacts.length === safeLimit,
    source: "mailbox",
  };
};

/**
 * Google Contacts, when the grant allows it.
 *
 * Reports `available: false` instead of throwing when the scope is absent,
 * because that is the ordinary case rather than an error: the connect flow
 * never asks for `contacts.readonly`, so this only ever works for a mailbox
 * whose grant happens to carry it already.
 */
const listGoogleContacts = async (userId, accountId, { pageSize = 100 } = {}) => {
  const account = await accountService.requireAccount(userId, accountId);

  if (!gmailScopes.hasContactsScope(account.scopes || [])) {
    return {
      available: false,
      reason:
        "This mailbox was not connected with permission to read Google " +
        "Contacts. Recipient suggestions come from the mailbox instead.",
      contacts: [],
    };
  }

  const accessToken = await tokenService.accessTokenFor(account._id);

  const response = await axios.get(
    "https://people.googleapis.com/v1/people/me/connections",
    {
      params: {
        pageSize: Math.min(Math.max(1, pageSize), 1000),
        personFields: "names,emailAddresses,photos",
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  const connections = response.data?.connections || [];

  return {
    available: true,
    source: "people",
    contacts: connections
      .map((person) => {
        const email = person.emailAddresses?.[0]?.value;
        if (!email) return null;
        return {
          email: String(email).toLowerCase(),
          name: person.names?.[0]?.displayName || null,
          photoUrl: person.photos?.[0]?.url || null,
        };
      })
      .filter(Boolean),
    nextPageToken: response.data?.nextPageToken || null,
  };
};

module.exports = {
  SCAN_LIMIT,
  SENT_WEIGHT,
  RECENCY_BONUS_MAX,
  RECENCY_WINDOW_DAYS,
  aggregateContacts,
  suggestRecipients,
  listContacts,
  listGoogleContacts,
};
