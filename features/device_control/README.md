# Device Control — backend

Centralized policy enforcement for enrolled company devices. This folder holds
the whole feature. Outside it: three route lines plus the event-dispatcher
binding in `server.js`, two values in `core/access/permissionModel.js`, and one
value in `core/events/eventTypes.js`.

## What a request goes through

Two audiences, two kinds of credential, mounted separately on purpose:

| Mount | Who | Credential |
| --- | --- | --- |
| `/api/v1/device-control` | administrators and employees | the normal user JWT, then `attachActor` and a `device` / `devicePolicy` permission |
| `/api/v1/device-agent` | the Windows service | a device JWT with `aud: device-agent`, which no user route accepts |

The company is always resolved from the authenticated user through
`core/access/companyResolver`. No handler reads `companyId` from a body or a
query string.

## The rules worth knowing before changing anything

1. **A policy is applied only when the device says so.** `Device.appliedPolicyVersion`
   is written in exactly one place — `recordEnforcement` — and only when at
   least one control reported `applied`. Assigning a policy never marks a
   device enforced.
2. **An approval grants an exception, never a policy edit.** `approveRequest`
   writes one `PolicyException` scoped to one device, one category and one
   resource, with an expiry. `applyException` has no code path that reaches a
   section other than the one its category names.
3. **Nobody decides their own request.** Checked in `approveRequest` and
   `rejectRequest` against the requester id, server-side, regardless of role.
4. **Policies are signed with Ed25519.** The agent holds only the public key,
   so a compromised device can verify a policy and never mint one. The signed
   payload contains the device id and `effectiveVersion`, which is what stops
   a policy being replayed at another machine or rolled back to an older one.
5. **`unsupported` is not success.** `overallStatus()` returns `partial` when
   some controls applied and others did not, so the console cannot show green
   for a machine that enforced half a policy.

## The live feed

`deviceControlEvents.js` publishes one event type, `device-control`, with the
change named in the event's `action`. The actions are the audit action names,
so the feed and the audit trail use one vocabulary.

Three rules, and they are the reason the file exists rather than services
calling the gateway themselves:

1. **A payload carries ids and statuses only.** An event is a nudge to
   refetch, never an authorization — the refetch is checked by the API. There
   is a test asserting no secret, hash or key reaches a payload.
2. **Delivery is best-effort and is never awaited.** A policy that was saved
   is saved whether or not the frame went out. Every publisher swallows its
   own failure and callers do not await it, so realtime cannot add latency to
   a response or turn a successful write into an error.
3. **Recipients are resolved, not assumed.** Sockets join only `user:<id>`, so
   there is no company room — and that is right, because most of these events
   are for administrators and a company room would reach every employee. Who
   counts as an administrator comes from `permissionNotifier.approversFor`,
   which re-checks each candidate through the permission engine.

Two asymmetries worth knowing before changing anything:

- **There is no `device.offline` event.** Nothing happens here when a device
  stops talking, so there is nothing to publish; a client derives offline from
  `lastSeenAt`. `device.online` is published only when the silence passed the
  30-minute window the dashboard calls offline, so an ordinary heartbeat costs
  no recipient lookup.
- **A clean enforcement report does not reach administrators.** The owner
  always does, because it is their machine and costs no query. A fleet
  applying a policy cleanly would otherwise mean one lookup per device to say
  that nothing is wrong. `unsupported` is published as `enforcement.reported`
  rather than `enforcement.failed` — nothing broke — but it *does* reach
  administrators, because nothing is being enforced either.

Filing a request also notifies whoever holds `device:update`, through
`permissionNotifier.notifyEntitled`. The push says who and what kind, with ids
in the metadata; the resource and the employee's reason are left out on
purpose, because a push payload goes to a third-party transport and both are
the employee's own words about their own machine.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `DEVICE_POLICY_PRIVATE_KEY` | in production | Ed25519 private key, PEM. Signs policies |
| `DEVICE_POLICY_PUBLIC_KEY` | in production | the matching public key, handed to the agent at enrollment |
| `JWT_SECRET` | yes | already used by the API; device tokens are separated by audience, not by secret |

Generate a keypair:

```bash
node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('ed25519');console.log(privateKey.export({type:'pkcs8',format:'pem'}));console.log(publicKey.export({type:'spki',format:'pem'}))"
```

Without these the server generates an ephemeral pair in development and warns.
Policies signed with it stop verifying when the process restarts, which on an
agent looks like an unexplained refusal — so set them before testing the
Windows service.

## Enrollment, end to end

1. Admin creates the device record: `POST /device-control/devices`.
2. Admin cuts a code: `POST /device-control/devices/:id/enrollment-token`.
   The plaintext is in that response and nowhere else, and expires in an hour.
3. Agent redeems it: `POST /device-agent/enroll` → device id, device secret,
   and the policy public key to pin.
4. Agent gets a token: `POST /device-agent/token` → 2-hour JWT.
5. Agent polls `POST /device-agent/heartbeat`, fetches `GET /device-agent/policy`
   when `effectiveVersion` moves, and reports with `POST /device-agent/enforcement`.

`GET /device-agent/policy` answers `204` when no policy is assigned. The agent
must treat that as *remove what I applied*, not as *nothing to do* — otherwise
taking a device off a policy leaves it restricted for ever.

## Tests

```bash
npm run test:device-control
```

Thirty-one pure cases, no database. Eighteen on the feature's safety —
signing and tampering, exception scoping, enforcement pessimism, assignment
precedence — and thirteen on the live feed: no secret in a payload, a
heartbeat costing nothing, a clean report not waking anybody, and a failing
transport or recipient lookup never reaching the caller.

The database-backed cases for company isolation still need writing; see the
note in the project plan.
