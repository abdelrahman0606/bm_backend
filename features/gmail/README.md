# Gmail

Connect several Gmail mailboxes and read, send and organize their mail through
one API, with new mail pushed to clients whether or not any client is running.

## Where the mail lives

**Gmail. Not here.** By default this feature stores no messages at all: a
list, a message and a conversation are read straight from Gmail when they are
asked for, and a newly arrived message is delivered to the client **in the
event that announces it** rather than written to a database and read back.

That is the default because Gmail is already the durable, indexed, searchable
store for that mailbox. A second copy means a second thing to keep in step, a
second thing to invalidate, and — the part that actually matters — a second
place somebody's private mail exists.

What it costs, stated plainly:

- a unified inbox across several mailboxes is a fan-out and merge per page
  rather than one indexed query (`gmailDirectReader` does it as a k-way merge:
  one extra Gmail fetch per mailbox per page, and none at all for a single
  mailbox);
- search **across** mailboxes is not possible — Gmail's own search is
  per-mailbox, and there is nothing local to search instead;
- every page view spends Gmail quota, where a stored copy spent it once.

`GMAIL_STORE_MESSAGES=true` turns on a cache and buys those three back. When
it is on, the cached collections bind to **local MongoDB, never Atlas** — a
mailbox cached in a hosted cluster is a much bigger thing to be responsible
for than the same rows on a machine the operator controls.

Either way, `GET /gmail/health` reports `storage.mode`, so which path is in
force is never a guess.

### What is stored, and where

| Collection | Where | Contents |
| --- | --- | --- |
| `GmailAccount` | Atlas | the OAuth grant, sync cursor, watch. No mail. |
| `GmailOperationLog` | Atlas | our audit of our own actions, and the index that stops a retried send delivering twice. Recipients and subjects; no bodies. |
| `GmailPushNotification` | Atlas | Pub/Sub deduplication: a message id, an address, a history id. Expires after a week. |
| `GmailMessage`, `GmailThread`, `GmailLabel`, `GmailDraft` | **local MongoDB** | mail content — and only when `GMAIL_STORE_MESSAGES=true`. Unused in the default mode. |

The two Atlas collections that touch mail-adjacent data are there on purpose:
sending must not break when local MongoDB is down, and nor must push. Moving
either is a one-line change in `gmailStorage`.

---

## 1. What has to be configured

The feature degrades in defined steps rather than failing all at once, so it
is worth knowing which variable buys what.

| Variable | Required for | Without it |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID_WEB` / `GOOGLE_CLIENT_SECRET_WEB` | connecting a mailbox from the web | consent cannot start |
| `GOOGLE_CLIENT_ID_DESKTOP` / `GOOGLE_CLIENT_SECRET_DESKTOP` | connecting from the desktop app | consent cannot start |
| `GOOGLE_OAUTH_REDIRECT_URIS` | web redirect allow list (comma separated) | web consent refuses |
| **`GOOGLE_TOKEN_ENCRYPTION_KEY`** | **storing refresh tokens** | **connecting refuses, before the user approves anything** |
| `GOOGLE_TOKEN_ENCRYPTION_KEY_OLD` | reading tokens sealed with a retired key | rotation breaks existing mailboxes |
| `GMAIL_STORE_MESSAGES` | caching mail locally | messages are read straight from Gmail and never stored (the default) |
| `GMAIL_PUBSUB_TOPIC` | push notifications | mail arrives on the scheduler's interval instead of instantly |
| `GMAIL_PUSH_TOKEN` *or* `GMAIL_PUSH_AUDIENCE` | authenticating the push endpoint | the push endpoint refuses every request |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | tying an OIDC push token to our subscription | any Google-signed token for the audience is accepted |
| `GMAIL_PUSH_ENDPOINT` | the health check verifying Pub/Sub can reach us | push problems stay invisible until no mail arrives |

The first four are shared with the Drive integration, which already owns them.

Generate the encryption key with:

```
openssl rand -base64 32
```

Tuning, all optional: `GMAIL_STORE_MESSAGES` (default false),
`GMAIL_SCHEDULER_INTERVAL_MS` (default 60000),
`GMAIL_SCHEDULER_DISABLED`, `GMAIL_IDLE_RESYNC_MS` (900000),
`GMAIL_INITIAL_SYNC_DAYS` (0 = the whole mailbox),
`GMAIL_INITIAL_BATCH_LIMIT` (1000), `GMAIL_MAX_SYNC_FAILURES` (8),
`GMAIL_WATCH_LABEL_IDS`, `GMAIL_PUSH_DEBUG`.

### Google Cloud Console

Step by step, with the exact `gcloud` commands and the failure modes:
**[PUSH_SETUP.md](PUSH_SETUP.md)**. The short version:

1. **Enable the Gmail API** in the project that owns the OAuth client.
2. **Declare the scopes on the consent screen** — `gmail.readonly`,
   `gmail.modify` and `https://mail.google.com/` as appropriate. Gmail scopes
   are *restricted*: an undeclared one produces `403 access_denied` on the
   consent screen itself, and production use needs verification plus an
   annual CASA assessment. While the app is in Testing, add the mailboxes you
   are testing with to **Test users**.
3. **Create a Pub/Sub topic**, e.g. `projects/<project>/topics/gmail-push`.
4. **Grant `gmail-api-push@system.gserviceaccount.com` the Pub/Sub Publisher
   role on that topic.** Gmail publishes as that account; without this,
   `users.watch` succeeds and no notification is ever delivered — the most
   confusing failure in the whole setup, because nothing reports an error.
5. **Create a push subscription** pointing at
   `https://<host>/api/v1/gmail-push?token=<GMAIL_PUSH_TOKEN>`, or use an
   OIDC service account and set `GMAIL_PUSH_AUDIENCE` and
   `GMAIL_PUSH_SERVICE_ACCOUNT` instead.

Note the constraint that catches most setups: Pub/Sub delivers only to a
public **HTTPS** address with a CA-signed certificate, so an `http://` URL, a
bare IP (no public CA issues certificates for one) and a private address all
fail — silently, with `users.watch` reporting success.
`GET /api/v1/gmail/health` checks each rule and names the one that is broken.

---

## 2. Access levels

Three levels, each one a bundle of scopes. The level stored on an account is
always derived from what Google **granted**, never from what was requested —
a user can untick a permission on the consent screen, and a level taken from
the request would claim access the grant does not have.

| Level | Scope | Read | Send | Organize | Trash | Delete forever |
| --- | --- | --- | --- | --- | --- | --- |
| `readOnly` | `gmail.readonly` | yes | – | – | – | – |
| `modify` *(default)* | `gmail.modify` | yes | yes | yes | yes | – |
| `full` | `mail.google.com` | yes | yes | yes | yes | yes |

`gmail.modify` deliberately cannot delete permanently; Google splits that off
so an app that organizes mail cannot destroy it. That split is kept rather
than worked around, which is why permanent deletion needs `full` **and** an
explicit `confirmPermanent: true`.

`gmail.send` and `gmail.labels` are not requested alongside `gmail.modify`,
which already covers both: a redundant scope on a restricted consent screen
is a question to answer in review for no gain.

---

## 3. How synchronization works

```
Gmail  ──(mailbox changed)──►  Pub/Sub topic
                                   │  push
                                   ▼
                      POST /api/v1/gmail-push
                                   │  sets nextSyncAt
                                   ▼
                      gmailScheduler  (every 60s)
                                   │  claims a lease
                                   ▼
                      gmailSyncService.syncAccount
                         │                    │
                   history.list          messages.list
                   (incremental)         (full, resumable)
```

**The cursor.** A mailbox has a monotonic `historyId`; every change bumps it,
and `users.history.list?startHistoryId=X` replays everything since. That
cursor lives in `account.syncState.lastHistoryId` and is the reason sync is
incremental rather than a repeated download. It is compared as a *string*
(`historyIdIsNewer`) because it is an unsigned 64-bit value that does not
survive `Number`.

**The first pass depends on the mode.** In the default direct mode there is
no backfill, because there is nothing to fill: one `getProfile` call
establishes the history cursor and the pass is done. With the cache on, it
walks the mailbox newest-first, reading the current `historyId` **before**
listing anything — so mail arriving during the walk falls after the cursor and
is caught by the next incremental pass — and is resumable, saving its page
token at `GMAIL_INITIAL_BATCH_LIMIT` messages and adopting the cursor only
once the walk completes.

**The incremental pass is where the modes differ most.** Both read the same
history records. With the cache on, the changes are written and clients
refetch. In direct mode, `deliverWithoutStoring` fetches each added message
once and publishes it — envelope and capped body — in the `message.received`
frame, then advances the cursor. The message is never written down. Label
changes need no fetch either way: Gmail's history records carry the message's
whole label list, so the frame is built straight from the record.

**Three failure modes are designed for:**

- *The cursor goes stale.* Google keeps history for about a week, then
  answers 404. That is tagged `HISTORY_GONE` and upgrades the pass to a full
  one, which converges on the same state. This is the designed path for a
  server that was offline for a fortnight.
- *The notification never arrives.* Pub/Sub is at-least-once, and a watch
  expires after seven days whatever happens. Push is therefore an
  optimization for latency and never the only path: every account also
  carries `nextSyncAt`, swept by the scheduler, so a lapsed watch costs
  latency and nothing else.
- *The same change arrives twice.* Every message write is an upsert keyed by
  `(accountId, gmailId)`, and a label change is a `$set` of the whole list
  rather than an increment. Replaying a history range is without consequence,
  which is what makes retrying safe.

**Leases.** `syncState.lockedBy` / `lockedUntil` is claimed with one atomic
`findOneAndUpdate`, so two workers — or two instances — never sync one
mailbox at once. Not for correctness, which the upserts already give, but for
quota. The lease expires, so a worker that dies mid-pass does not hold the
mailbox forever.

---

## 4. Events

One event type, `gmail`, with the change in the event's `action` — the same
contract Device Control uses, so a client registers one handler and routes on
the action.

```
account.connected   account.updated   account.signedOut
account.disconnected                  account.needsReauth
message.received    message.updated   message.sent
message.sendFailed  message.trashed   message.untrashed
message.deleted     thread.updated    draft.saved
draft.deleted       labels.changed
sync.started        sync.completed    sync.failed
watch.started       watch.stopped
```

Every event goes to `user:<id>`, taken from the account row — a connected
mailbox is personal, so there is no company room and no administrator
fan-out. Payloads carry no token, no history cursor and no message body.

`message.received` is the one deliberate exception to "ids only, refetch
through the API". It carries the envelope — sender, subject, snippet, label
ids, attachment count — and in direct mode the plain-text body too.

The reason is specific: the server has just fetched that message from Gmail in
order to notice it at all, and in direct mode it keeps no copy. "Refetch
through the API" would therefore mean fetching the same message from Gmail a
second time, spending quota to deliver data this same user is entitled to and
the server already has in hand. So the frame carries it, and the mail is never
written down on the way.

The body is capped. Over the cap it is **omitted rather than truncated** —
half a message presented as whole is worse than one that needs a fetch.
Nothing else is relaxed: no token, no history cursor, no attachment bytes.

`message.updated` has two shapes, both honest: the whole resulting label list
when the server held a copy to report it from, and the delta it applied when
it did not. A client applies whichever it is given, and both land the row in
the same place.

---

## 5. Sending, and what we are willing to claim

Gmail accepting a message means it is queued for delivery. It does not mean
delivered, and it certainly does not mean read. So:

- the operation log's best status is **`accepted`** — Gmail took it and
  returned an id;
- the event is `message.sent`, meaning exactly that;
- the HTTP response is **202**, not 200;
- there is no `delivered` and no `read` anywhere, and a bounce arrives later
  as an ordinary inbound message from the mailer-daemon rather than as a
  status change, because the send genuinely did succeed.

**Threading is two separate things.** `threadId` groups a reply in the
sender's own Gmail; `In-Reply-To` and `References` are what make it a reply in
every other client. A reply sets both.

**Sending twice is the failure that matters**, because a duplicate email
cannot be recalled. Every send accepts an `idempotencyKey`, enforced by a
unique index on the operation log: a retry after a lost response returns the
first attempt's result instead of sending again.

---

## 6. Pagination

The direct path paginates by **cursor**, not by page number: Gmail offers no
offset, so a page number has nothing to mean, and faking one would re-walk
every earlier page on every request. A list returns `nextPageToken`, which the
client passes back; `hasMore` is simply whether that token exists.

For a unified inbox the cursor is composite — each mailbox's own Gmail page
token plus how far into that page the reader has consumed — encoded as one
base64url string so the client never sees the shape. A cursor that cannot be
read is treated as no cursor rather than as an error: refusing to show a
mailbox because a stale token came back would be worse.

There is no `total`. Gmail gives a `resultSizeEstimate`, which is reported as
`estimate` and named for what it is; presenting an estimate as a total would
have clients drawing page numbers that do not exist.

## 7. Authorization

A connected mailbox is personal: it belongs to the BM user who consented,
there is no company-wide view of one and no administrator override. So
ownership *is* the permission model, and it is enforced in one function —
`gmailAccountService.requireAccount(userId, id)` loads the row by id **and**
user, and every operation in the feature begins there. The id in a URL is
never trusted on its own; a guessed one gets a 404.

On top of that, `gmailScopes.assertCan(account, capability)` refuses an
operation the grant does not cover, with a message naming the level the user
would need — rather than letting it fail as an opaque 403 from Google
halfway through.

The refresh token is sealed with AES-256-GCM (`core/security/secretBox`)
before it is written, is `select: false`, and is stripped by both JSON
transforms. It is decrypted only for the length of one token request, inside
`gmailTokenService`, and **no access token is ever returned to a client** —
every Gmail call goes through this backend, so a client never needs one.

---

## 8. Relationship to the Drive integration

The OAuth protocol work is shared, not duplicated.
`features/auth/googleOAuthService` builds consent URLs, holds the PKCE
verifier server-side, exchanges codes and refreshes tokens for both features;
it was already scope-agnostic, so Gmail passes its own scopes through it.

Exactly two changes were made outside this folder's own files, both additive:

- `googleOAuthRequestModel.js` — `"gmail"` added to the `purpose` enum;
- `core/events/eventTypes.js` — `GMAIL` added.

Nothing in the Drive implementation was refactored or moved. `purpose` is
what keeps the grants separated: a state issued for Gmail cannot be redeemed
by the Drive exchange, and a Drive state cannot be redeemed here. That is not
ceremony — a Gmail grant carries mail scopes, and either endpoint spending the
other's state would mean a flow the user approved for one thing being used
for another.

Accounts are kept in a **separate collection** from `GoogleAccount`. They
look similar and are not: a Drive row carries a storage quota and a root
folder, a Gmail row carries a history cursor and a push subscription, and the
same person may connect the same Google account to both at different
permission levels. Folding them together would mean one row with two
half-empty halves, one unique key serving two lifecycles, and schema changes
to a working feature.

One improvement worth noting but **not** applied: the Drive feature stores its
refresh token in plaintext (`select: false` only). `core/security/secretBox`
is written generically and could seal those too, but retrofitting it means a
migration over live rows, so it is left as a deliberate follow-up rather than
done silently.

---

## 9. API

All routes are under `/api/v1/gmail` and require a BM bearer token. The push
endpoint is `/api/v1/gmail-push` and authenticates a Google service account
instead — it is mounted separately for exactly that reason.

### Accounts
```
POST   /accounts/oauth/url          { accessLevel?, platform?, redirectUri, accountId? }
POST   /accounts/oauth/exchange     { state, code }
GET    /accounts                    ?page&limit&search&status&sortBy&descending&accessLevel
GET    /accounts/:id
PATCH  /accounts/:id                { displayName?, sendAsName?, signature?, isEnabled?, isPrimary? }
DELETE /accounts/:id                forgets it; Gmail keeps the mail
POST   /accounts/:id/signout        revokes the grant, keeps the row and the mail
POST   /accounts/:id/sync           { mode?: auto | full | incremental }
POST   /accounts/:id/watch
DELETE /accounts/:id/watch
```

### Reading
```
GET /messages                       ?accountId&labelIds&from&to&subject&search&isUnread
                                    &isStarred&hasAttachments&after&before&includeTrash
                                    &page&limit
GET /messages                       ?q=<Gmail search>&accountId&pageToken   (Gmail's own search)
GET /messages/:accountId/:gmailId   ?withBody=false
GET /messages/:accountId/:gmailId/attachments/:attachmentId
GET /threads                        same filters as /messages
GET /threads/:accountId/:threadId   ?withBodies=true
GET /labels/:accountId
GET /unread-counts
GET /health
```

`?q=` is passed straight to Gmail, which is the only thing that implements
`from:`, `has:attachment` and `older_than:` correctly. It needs exactly one
`accountId` (the language is per-mailbox) and paginates by `pageToken`, not by
page number.

### Sending
```
POST   /messages/send       { accountId?, to, cc?, bcc?, subject, text?, html?,
                              useSignature?, idempotencyKey? }  + multipart `attachments`
POST   /messages/reply      { gmailId, text?, html?, quoteOriginal?, ... }
POST   /messages/reply-all  { gmailId, ... }
POST   /messages/forward    { gmailId, to, includeAttachments?, ... }
GET    /drafts              ?accountId&page&limit
POST   /drafts              composition + replyToGmailId?
PATCH  /drafts/:draftId
POST   /drafts/:draftId/send
DELETE /drafts/:draftId
```

Attachments may be multipart files or base64 in the JSON body; both shapes
are accepted.

### Organizing
```
POST   /messages/modify-labels   { accountId, gmailIds, addLabelIds?, removeLabelIds? }
POST   /messages/read | unread | star | unstar | archive | inbox
                       | spam | not-spam | trash | untrash        { accountId, gmailIds }
POST   /messages/delete-forever  { accountId, gmailIds, confirmPermanent: true }
POST   /threads/:accountId/:threadId/modify-labels
POST   /threads/:accountId/:threadId/trash
DELETE /threads/:accountId/:threadId     { confirmPermanent: true }
POST   /labels/:accountId        { name, labelListVisibility?, messageListVisibility? }
PATCH  /labels/:accountId/:labelId
DELETE /labels/:accountId/:labelId
```

### Contacts and history
```
GET /contacts/suggest           ?query&accountId&limit
GET /contacts                   ?search&accountId&page&limit
GET /contacts/google/:accountId reports available:false unless the grant has the scope
GET /operations                 ?accountId&operation&status&page&limit
```

Contacts are derived from the mailbox, not from Google Contacts: the People
API would need a second restricted scope for data that is usually worse — a
mailbox knows exactly who someone writes to and how recently.

---

## 10. Ready for an AI agent, with no AI in it

No AI functionality is implemented. What is in place so one can be added
without rewriting anything:

- **Retrieval and sending are separate services** with plain method
  signatures — `gmailMessageService.getThread`, `gmailSendService.replyToMessage`
  — that take a `userId` and return structured data. An agent calls the same
  functions the HTTP layer does.
- **Structured message data**, already parsed: addresses split into name and
  email, bodies separated into text and HTML, threading headers preserved,
  attachments described. There is a `GmailMessage.analysis` field reserved for
  a classifier; nothing writes it today.
- **Provenance in the audit log.** `actor.kind` is `user`, `system` or
  `agent`, and every service call takes an `actor`. Nothing writes `agent`
  yet. It exists now because retrofitting provenance onto an audit log gives
  you one you cannot trust: the rows written before the column existed are
  indistinguishable from the rows written by a person.
- **The permission checks are in the services, not the routes**, so an agent
  calling them directly is held to the same scope and ownership rules as an
  HTTP caller. An agent cannot send from a `readOnly` mailbox.
- **Idempotency keys** on every send, which matter more for an automated
  sender than for a person: a retried agent action must not mail a customer
  twice.
- **Credentials stay here.** An agent would call these services; it never
  touches a refresh token or an access token.

---

## 11. Tests

```
npm run test:gmail
```

154 tests, no database and no network — the HTTP transport, the event
dispatcher and the clock are injected. They concentrate on the failures that
are silent in production: a mis-encoded subject, a `Bcc` that survives, a
reply that threads only in Gmail, a cursor that moves backwards, a history
range applied twice, a payload carrying a token, a push endpoint that
defaults open.
