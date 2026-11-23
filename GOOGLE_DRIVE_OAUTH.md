# Google Drive OAuth, server side

The desktop and web apps used to run the whole Google OAuth flow themselves,
which meant shipping the OAuth **client secret** inside the app. Anyone with a
copy of the installer could read it. This moves the flow here: the backend owns
the secrets, exchanges the authorization code, refreshes access tokens, and
stores the connected accounts per user. Clients only ever hold an access token
that expires in an hour.

Everything lives in `features/auth/`, behind `verifyAuthToken`, so an account
always belongs to the signed-in user and is never taken from the request body.

Signing **in** with Google moved here too, for the same reason. That flow ends
differently: it returns the verified Google **id token**, which the client
posts to the existing `POST /api/v1/auth/google` — the route that already owns
the register and login rules, and which is unchanged. One implementation of
those rules, two ways of obtaining the id token.

| | Drive connection | Login |
| --- | --- | --- |
| Paths | `/google/oauth/*`, `/google/accounts/*` | `/google/login/*` |
| Auth | signed in | **public** (nobody is signed in yet) |
| Scopes | identity + one Drive scope | identity only |
| Refresh token | kept, per account | not requested |
| Ends in | a `GoogleAccount` row | an id token for `POST /auth/google` |

## 1. Configuration

Add to `config.env` (gitignored — never commit these):

```
# Already present
GOOGLE_CLIENT_ID_WEB=<web client id>.apps.googleusercontent.com
GOOGLE_CLIENT_ID_DESKTOP=<desktop client id>.apps.googleusercontent.com

# New — move these out of the Flutter app
GOOGLE_CLIENT_SECRET_WEB=GOCSPX-...
GOOGLE_CLIENT_SECRET_DESKTOP=GOCSPX-...

# Only needed if a browser-based client connects Drive. Comma separated,
# matched exactly. Desktop does not use this (see the loopback rule below).
GOOGLE_OAUTH_REDIRECT_URIS=https://app.example.com/oauth/callback
```

**Rotate the two secrets in the Google Cloud console when you move them.** The
old values were in `lib/core/config/di/di.dart` in the Flutter repo and are in
its git history, so they should be treated as leaked.

In the Google console, the desktop client needs no redirect URI registered
beyond the loopback range Google allows for "Desktop app" clients; the web
client needs each URI from `GOOGLE_OAUTH_REDIRECT_URIS` registered.

## 2. The flow

A desktop app cannot keep a secret, and Google's answer for installed apps is a
loopback redirect. So the app listens on `127.0.0.1`, and the backend does the
part that needs the secret:

```
app                          backend                         google
 |                              |                              |
 |-- POST /oauth/url ---------->|                              |
 |   accessLevel, redirectUri   |  stores state + PKCE         |
 |<-- { url, state } -----------|  verifier server-side        |
 |                              |                              |
 |-- open url in browser -------+----------------------------->|
 |                              |        user consents         |
 |<-- redirect to 127.0.0.1?code=..&state=.. ------------------|
 |                              |                              |
 |-- POST /oauth/exchange ----->|                              |
 |   state, code                |-- code + secret + verifier -->|
 |                              |<-- access + refresh token ----|
 |<-- { account, accessToken } -|  refresh token stored         |
 |                              |                              |
 |  ... an hour later ...       |                              |
 |-- POST /oauth/refresh/:id -->|-- refresh + secret ---------->|
 |<-- { accessToken } ----------|<-- access token --------------|
```

Three things make this safe to expose:

- **`redirectUri` is checked, not trusted.** A desktop one must be
  `http://127.0.0.1|localhost|[::1]:<port>` with no query or fragment; a web
  one must be in `GOOGLE_OAUTH_REDIRECT_URIS`. Without this check a caller
  could point Google's `code` at a host they control and then have us exchange
  it with our secret.
- **The PKCE verifier and the redirect URI never leave the server.** They are
  stored against the `state` in `googleOAuthRequests`, so the exchange cannot
  be talked into using different ones.
- **`state` is single use and expires in 10 minutes**, enforced by `usedAt`
  plus a TTL index, so a captured state cannot be replayed.

## 3. Endpoints

All under `/api/v1/auth/google`, all requiring `Authorization: Bearer <app jwt>`.

### `POST /oauth/url`

Starts a consent flow.

```json
{ "accessLevel": "full", "platform": "windows",
  "redirectUri": "http://127.0.0.1:53682", "accountId": null }
```

`accessLevel` is `appOnly` | `full` | `readOnly`. `accountId` re-authorises an
existing account (its email becomes the login hint). Returns
`{ url, state, scopes, expiresAt }`.

### `POST /oauth/exchange`

```json
{ "state": "<from /oauth/url>", "code": "<from the redirect>" }
```

Returns the saved account plus `accessToken`, `tokenType`, `expiresAt`,
`expiresIn`, `accessLevel`, `scopes`. The refresh token is **not** returned.

The stored `accessLevel` comes from the scopes Google actually granted, not
from what was asked for — a user can untick a permission on the consent screen,
and the record must not claim access the app does not have.

### `POST /oauth/refresh/:id`

Body: `{ "platform": "windows" }` (optional). Returns a fresh `accessToken`.
If Google has stopped accepting the grant, the account is flagged
`needsReauth` and this answers `401` — the client should then run `/oauth/url`
again with that `accountId`.

### `POST /oauth/revoke/:id`

Revokes the grant and clears the refresh token, **keeping the row**. This is
"log out": the account stays in the list with its permission level and
position, and logging back in is one step.

### `GET /accounts`

```
?page=0&limit=15&search=&status=&sortBy=&descending=
&accessLevel=full&provider=google
```

`status` is `any` | `connected` | `needsLogin` | `hidden`. `sortBy` is
`primaryFirst` | `email` | `name` | `lastUsed` | `created` | `accessLevel`.
`accessLevel` and `provider` may repeat to filter on several.

Answers `{ data: [...], meta: { total, page, limit, hasMore } }`. `limit` is
clamped to 100. Every sort ends on `email` as a tiebreaker, so a paginated
list cannot repeat or skip a row between pages.

### `GET /accounts/:id`

### `PATCH /accounts/:id`

```json
{ "displayName": "Work drive", "isEnabled": true,
  "isPrimary": true, "rootFolderId": null }
```

`accessLevel` is **rejected** here rather than ignored: it is the OAuth scope,
so changing it means a new consent flow. The upload account (`isPrimary`) is
always visible, so it cannot be hidden — make another account primary first.

### `DELETE /accounts/:id`

Revokes the grant and forgets the row. Nothing is deleted from Google Drive.

### `POST /login/url` and `POST /login/exchange` — **public**

The login flow. `/login/url` takes `{ redirectUri, platform?, loginHint? }`
and answers `{ url, state }`; `/login/exchange` takes `{ state, code }` and
answers `{ idToken, email, displayName, photoUrl, emailVerified }`.

Neither creates a session. The client posts the `idToken` to
`POST /api/v1/auth/google` as before.

These are the only unauthenticated routes in the group, and they have to be:
they are how a user signs in. They are mounted *ahead* of the authenticated
`/google` sub-router so its token guard does not swallow them — there is a
test for exactly that, because the mount order is the whole thing keeping it
working. The same protections apply as above: the redirect URI is validated,
the PKCE verifier stays server-side, and the state is single use, short lived
and marked `login`, so it cannot be redeemed at `/oauth/exchange` for a Drive
connection (and a Drive state cannot be redeemed here).

They also differ from the Drive flow in two deliberate ways: the scopes are
the identity ones alone — a login must not ask for file access — and
`access_type=offline` is **not** sent, so Google issues no refresh token for a
grant that is read once and discarded.

Being public, they are worth rate limiting at the edge: each `/login/url` call
writes a short-lived row. The TTL index cleans up, but nothing here caps how
fast a caller may ask.

## 4. Data

`features/auth/googleAccountModel.js` — one row per account per user
(`{ userId, provider, email }` is unique).

- `refreshToken` is `select: false` and stripped by the JSON transform, so no
  ordinary query or response can leak it.
- Exactly one account per user is `isPrimary`, kept true by
  `ensureOnePrimary()` after anything that can disturb it.
- `sortIndex` is kept dense by `reindex()` so the arranged order survives a
  deletion.

`features/auth/googleOAuthRequestModel.js` — in-flight consent flows, dropped
by a TTL index.

## 5. Tests

```
node --test features/auth/googleDriveOAuth.test.js
```

26 tests, no database or network needed: scope/level mapping both ways, the
redirect-URI allow list (including the code-exfiltration cases), PKCE challenge
derivation, the consent URL's parameters, that `startConsent` keeps the
verifier server-side, the list query's search escaping and status mapping, and
three live HTTP checks that the routes mount where the client expects and that
mounting them did not shadow the existing `POST /auth/google` login.

Registered in `package.json`'s `test` script.

## 6. The client

Done, in the Flutter repo:

| Piece | File |
| --- | --- |
| HTTP client for these endpoints | `features/google_drive/data/google_drive_backend_api.dart` |
| Loopback listener for the redirect | `features/google_drive/data/loopback_redirect_listener.dart` |
| Sign-in and token fetching | `features/google_drive/data/google_drive_auth_service.dart` |
| Isar mirror of `GET /accounts` | `features/google_drive/data/accounts_sync_service.dart` |

Notes on how it uses this API:

- **Tokens are never stored.** `AccountSession.tokens` is an in-memory cache
  only; `_BackendRefreshingClient` calls `/oauth/refresh/:id` when the token it
  holds is within a minute of expiry, and concurrent requests share one fetch.
- **`remoteId`** on the local row is the `_id` here. A row without one has not
  been synced and cannot be refreshed, which the UI reports as "connect again".
- **`isSignedOut` vs `needsReauth`** are kept apart: the first is a log out
  (we dropped the refresh token), the second is a grant that stopped working.
  Both need a login, but they read differently to a user.
- **Offline** reads fall back to the Isar mirror and the page says so, rather
  than showing an empty list.

Login, in the same repo:

| Piece | File |
| --- | --- |
| HTTP client for `/google/login/*` | `features/auth/repository/google_login_backend_api.dart` |
| Desktop sign-in via the backend | `features/auth/repository/google_signIn_repositopry.dart` (`GoogleAuthDesktop`) |
| Shared loopback listener | `core/network/oauth/loopback_redirect_listener.dart` |

`GoogleAuthDesktop` returns an id token exactly as it did before, so
`AuthCubit.loginWithGoogle` and `registerWithGoogle` are untouched — only
*how* the token is obtained changed. Mobile and web still use `google_sign_in`
for login, which involves no client secret, so there was nothing to move.

**There are no OAuth client secrets left in the Flutter app.**

### Still on the client

Connecting a Drive account from **mobile or web** is not wired: the loopback
redirect is a desktop mechanism, and the client fails with a clear message
rather than opening a consent screen whose redirect goes nowhere. Android and
iOS would use `google_sign_in` with `forceCodeForRefreshToken` and send the
resulting `serverAuthCode` to a new endpoint that exchanges it with the web
client secret.
