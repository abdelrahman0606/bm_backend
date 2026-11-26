# Gmail push notifications — setup

How to make new mail arrive in seconds instead of on the server's sweep.

**None of this is required for the feature to work.** Without it, the
scheduler collects mail on its own interval (15 minutes by default) and
everything else — reading, sending, organizing — is unaffected. Push buys
latency, nothing else. Set it up when the latency matters, not before.

---

## 0. The one thing that blocks most setups

Pub/Sub delivers to **"a publicly accessible HTTPS address"** whose server has
**"a valid SSL certificate signed by a certificate authority"**
([docs](https://docs.cloud.google.com/pubsub/docs/create-push-subscription)).

That rules out, in order of how often it comes up:

| Endpoint | Works? | Why |
| --- | --- | --- |
| `http://62.72.43.136:7070/...` | No | Not HTTPS |
| `https://62.72.43.136:7070/...` | No | No public CA issues certificates for a bare IP, so the certificate rule cannot be met at all |
| `https://192.168.1.3/...` | No | Pub/Sub cannot reach a private address |
| `https://localhost/...` | No | Same |
| `https://api.yourdomain.com/...` | Yes | A hostname with a real certificate |

The failure mode is the problem: `users.watch` succeeds, Pub/Sub accepts the
subscription, and **no notification is ever delivered**. Nothing errors. It
looks exactly like a quiet mailbox.

`GET /api/v1/gmail/health` checks these rules for you and says which one is
broken — see [step 6](#6-check-it).

**Domain ownership verification is not required** any more; the docs say
plainly that "Pub/Sub doesn't require proof of ownership for push subscription
URL domains." Older guides that describe verifying a domain in the API Console
are out of date.

### Getting a usable endpoint

- **Production:** put the backend behind a hostname with TLS. Caddy is the
  shortest path — two lines of config and it obtains and renews a Let's
  Encrypt certificate itself:

  ```
  api.yourdomain.com {
      reverse_proxy localhost:7070
  }
  ```

- **Development:** a tunnel gives you a public HTTPS hostname without
  deploying anything. `cloudflared tunnel --url http://localhost:7070` prints
  a `https://<random>.trycloudflare.com` URL. It changes on every restart, so the
  subscription has to be updated each time — fine for a day of testing, not
  for a deployment.

- **Neither:** skip push. Lower `GMAIL_IDLE_RESYNC_MS` instead (see
  [step 7](#7-if-you-skip-push)).

---

## 1. Enable the Gmail API

In the Google Cloud project that owns the OAuth client:

```powershell
gcloud services enable gmail.googleapis.com --project=YOUR_PROJECT_ID
```

## 2. Create the topic

```powershell
gcloud pubsub topics create gmail-push --project=YOUR_PROJECT_ID
```

## 3. Let Gmail publish to it

**This is the step that is silently fatal when missed.** Gmail publishes as
its own service account; without this grant, `users.watch` returns success and
publishes nowhere.

```powershell
gcloud pubsub topics add-iam-policy-binding gmail-push --project=YOUR_PROJECT_ID --member=serviceAccount:gmail-api-push@system.gserviceaccount.com --role=roles/pubsub.publisher
```

The address is literally `gmail-api-push@system.gserviceaccount.com` for
everyone — it is not specific to your project.

## 4. Choose how the endpoint authenticates

The endpoint is public, so it refuses every request until one of these is
configured. Pick one.

### Option A — shared secret (simpler)

Generate a long random value:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Put it in `config.env` as `GMAIL_PUSH_TOKEN`, and append it to the endpoint
URL as `?token=<value>` when creating the subscription. The endpoint compares
it in constant time.

Good enough when the URL is not guessable. The secret travels in the URL, so
it will appear in any proxy or load-balancer access log that records query
strings — worth knowing before choosing it.

### Option B — OIDC token (Google's recommendation)

Pub/Sub signs a JWT with a service account you nominate, and the endpoint
verifies it against Google's keys.

```powershell
gcloud iam service-accounts create gmail-push-caller --project=YOUR_PROJECT_ID
```

Then grant the account creating the subscription permission to act as it:

```powershell
gcloud iam service-accounts add-iam-policy-binding gmail-push-caller@YOUR_PROJECT_ID.iam.gserviceaccount.com --project=YOUR_PROJECT_ID --member=user:YOU@example.com --role=roles/iam.serviceAccountTokenCreator
```

Set `GMAIL_PUSH_AUDIENCE` to the exact endpoint URL and
`GMAIL_PUSH_SERVICE_ACCOUNT` to
`gmail-push-caller@YOUR_PROJECT_ID.iam.gserviceaccount.com`.

The service account check is not optional ceremony: the signature alone only
proves Google minted the token, and checking *which* account it was minted for
is what ties it to your subscription rather than anyone else's.

## 5. Create the push subscription

With a shared secret:

```powershell
gcloud pubsub subscriptions create gmail-push-sub --project=YOUR_PROJECT_ID --topic=gmail-push --push-endpoint="https://api.yourdomain.com/api/v1/gmail-push?token=YOUR_PUSH_TOKEN" --ack-deadline=30
```

With an OIDC token:

```powershell
gcloud pubsub subscriptions create gmail-push-sub --project=YOUR_PROJECT_ID --topic=gmail-push --push-endpoint="https://api.yourdomain.com/api/v1/gmail-push" --push-auth-service-account=gmail-push-caller@YOUR_PROJECT_ID.iam.gserviceaccount.com --push-auth-token-audience="https://api.yourdomain.com/api/v1/gmail-push" --ack-deadline=30
```

A 30-second acknowledgement deadline is generous: the endpoint only
authenticates, deduplicates and marks the mailbox due, then answers 204. The
sync itself runs on the scheduler, which is a durable handoff — it survives a
restart between the acknowledgement and the work.

## 6. Check it

Add to `config.env`:

```
GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/gmail-push
GMAIL_PUSH_ENDPOINT=https://api.yourdomain.com/api/v1/gmail-push
GMAIL_PUSH_TOKEN=...            # option A
GMAIL_PUSH_AUDIENCE=...         # option B
GMAIL_PUSH_SERVICE_ACCOUNT=...  # option B
```

`GMAIL_PUSH_ENDPOINT` is not called by anything — it is recorded so the health
check can tell you whether Pub/Sub could reach it. Restart the server, then:

```powershell
curl -H "Authorization: Bearer YOUR_BM_TOKEN" http://localhost:7070/api/v1/gmail/health
```

The `push` object reports the topic, which authentication mode is live, and
whether the endpoint satisfies Google's rules — with a sentence per problem.
Each mailbox then reports its own `watch`: whether it is active, when it
expires, and **how many notifications have actually arrived**. That last
number is the only real proof: the checks above are necessary conditions, and
only a delivered notification shows the whole chain works.

A mailbox connected before push was configured has no watch. Start one:

```
POST /api/v1/gmail/accounts/:id/watch
```

or use "Turn on push notifications" on the mailbox's row in the app. New
mailboxes get one at connect time.

## 7. If you skip push

The scheduler is the fallback and it is not a lesser path — it is what makes
the feature work at all when a notification is dropped, when a watch lapses,
and for the seven-day expiry Google enforces on every watch regardless.

Two knobs in `config.env`:

```
GMAIL_IDLE_RESYNC_MS=120000       # how long an up-to-date mailbox waits (default 900000)
GMAIL_SCHEDULER_INTERVAL_MS=30000 # how often the worker looks for due mailboxes (default 60000)
```

Two minutes is a reasonable floor for a handful of mailboxes. Each pass is one
`history.list` call when nothing changed, so the cost is small — but it is per
mailbox per interval, and Gmail's per-user quota is finite. Do not set it to
seconds and expect it to scale.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `users.watch` succeeds, no notification ever arrives | `gmail-api-push@system.gserviceaccount.com` has no Publisher role on the topic (step 3), or the endpoint is not reachable (step 0) |
| 403 at the endpoint | Wrong token, or an OIDC token from another service account. The endpoint fails closed by design |
| 503 at the endpoint | Neither `GMAIL_PUSH_TOKEN` nor `GMAIL_PUSH_AUDIENCE` is set, so it refuses everything rather than defaulting open |
| Pub/Sub reports delivery failures with a 403 | A firewall in front of the endpoint. The docs name this case explicitly |
| Notifications arrive, mail does not appear | Push only marks the mailbox due; check `syncState.lastError` in `/health` |
| Push worked, then stopped after a week | A watch expires after seven days. The scheduler renews a day early — check it is running (`GMAIL_SCHEDULER_DISABLED`) |

## Sources

- [Create push subscriptions](https://docs.cloud.google.com/pubsub/docs/create-push-subscription)
- [Push subscriptions](https://docs.cloud.google.com/pubsub/docs/push)
