# Device usage synchronization

How application usage recorded on a desktop reaches the backend and becomes
readable from the mobile app and the user's other devices.

Two projects are involved:

| | |
| --- | --- |
| Flutter | `D:\projects\business_management` — `lib/time_management/` |
| Node.js | this repository — `features/time_management_sharing/` |

## The data flow today, and what changed

**Before.** The desktop tracker wrote one cumulative Isar record per
application and local day (`AppUsageModel`: `date` + `appName` unique,
`totalDuration`, window titles). Every 10 minutes
`syncConfiguredUsage()` walked **every saved Share Time configuration** and
re-uploaded **every day it covered** as an `absolute` snapshot scoped to a
share and a recipient. There was no device identity, no record of what had
already been uploaded, and nothing a mobile client could read as "my usage
across my devices".

**After.** The record itself carries a local change sequence, so a cycle
uploads only what changed, and the usage is stored per device so totals across
devices can be summed. The share-scoped path is untouched and still works the
way it did; this is a second, independent path.

```
Isar record changes ──► revision++ , pendingSync = true
                              │
            (every ~12 min)   ▼
      DeviceUsageSyncService ──► POST /api/v1/time-management-usage/sync
                              │      (batch of snapshots + batchId)
                              ▼
              acknowledgement ──► mark only accepted revisions synced
                              │
                              ▼
   TimeManagementDeviceUsage (local MongoDB, one row per device+record+day)
                              │
                              ▼
       GET /api/v1/time-management-usage/report  ──► mobile / other desktops
```

## Strategy: per-device cumulative snapshots

Both strategies were considered; snapshots won on the existing data model.

The local record **is** the device's cumulative total for an application and a
day, mutated in place while tracking, with no change log. So the unit the
client can produce reliably is "my total for Chrome on 2026-10-25 is 45
minutes, at revision 7".

The backend stores each device's contribution and **replaces** it:

* re-sending is idempotent by construction — no counter is ever incremented,
  so a lost acknowledgement costs one redundant upload and never a double
  count;
* a correction, including a downward one, is just a higher revision;
* the aggregate is the sum of each device's latest accepted contribution.

Deltas would have required the client to persist "already synced duration" per
record, and correctness would then rest entirely on a dedupe ledger surviving:
if an acknowledgement is lost, a delta is either applied twice or dropped. The
two strategies are **not** combined — nothing in this path adds to a stored
total.

Worked example (the 30 + 15 + 30 case):

| step | device A contribution | device B contribution | aggregate |
| --- | --- | --- | --- |
| A records 30 and syncs | 30 | — | 30 |
| A records 15 more, syncs its total of 45 | 45 | — | 45 |
| B records 30 and syncs | 45 | 30 | **75** |
| A retries its last batch | 45 | 30 | **75** |

## Identities

| what | identity | where |
| --- | --- | --- |
| user | `userId` from the verified auth context — never from the body | `req.userId` |
| device | `deviceId`: a UUID generated once and persisted in the local cache | `DeviceIdentityProvider` |
| stored contribution | `userId + deviceId + appKey + date` (unique index) | `appKey` is the application name exactly as that device recorded it, so one client record maps to exactly one document |
| application, for aggregation | `appId`, normalized **server-side** from the display name (`Code.exe`, `code.EXE` → `code`) | `timeManagementAppIdentity.js` |
| one upload | `batchId`, derived by the client from the device and the exact revisions in the batch | `DeviceUsageSyncPlanner.batchIdFor` |
| one record's change | `revision`, a monotonic local counter | `AppUsageModel.revision` |

`appId` is deliberately *not* part of the document identity. Two records that
normalize to the same application — two devices, or two differently spelled
local records — are stored separately and summed at read time, instead of one
overwriting the other. The display name is always preserved.

A timestamp is not used for change detection: several window updates can land
in the same millisecond, and device clocks differ.

## The protocol

### `POST /api/v1/time-management-usage/sync`

```json
{
  "batchId": "a5f3…",            // stable for this content; a retry repeats it
  "deviceId": "7c1e…",
  "deviceName": "Desktop A",
  "platform": "windows",
  "timezoneOffsetMinutes": 180,
  "items": [
    {
      "localId": "41",           // the client's record id, echoed back
      "appName": "Chrome.exe",
      "date": "2026-10-25",      // the device's local day
      "revision": 7,
      "totalDuration": 2700000,  // this device's cumulative total, in ms
      "windows": [{ "title": "Inbox", "durationMs": 600000 }]
    }
  ]
}
```

At most **200 items** per request; at most 500 window titles per item. A record
with more window titles sends its longest 500 and sets `windowsTruncated` —
`totalDuration` stays exact, so only the breakdown is partial and it is marked
rather than silently cut.

### The acknowledgement

```json
{
  "batchId": "a5f3…",
  "status": "completed",          // or "partial"
  "itemCount": 1, "appliedCount": 1, "staleCount": 0, "rejectedCount": 0,
  "dates": ["2026-10-25"],
  "results": [
    { "localId": "41", "appKey": "Chrome.exe", "appId": "chrome",
      "date": "2026-10-25", "revision": 7, "status": "applied", "reason": null }
  ],
  "idempotent": false
}
```

| status | meaning | client |
| --- | --- | --- |
| `applied` | stored as this device's contribution | mark synced at that revision |
| `stale` | the backend already holds this revision or newer | mark synced |
| `rejected` | not stored, `reason` says why | leave pending, retry later |

The client marks **only** `applied` and `stale`, per `localId`, so a partial
batch leaves exactly the failed records pending. The ledger entry is written
only after the contributions are durably applied, so nothing is acknowledged
early.

`GET /api/v1/time-management-usage/sync/:batchId` returns the stored
acknowledgement of a batch whose response was lost.

### `GET /api/v1/time-management-usage/report`

`date` | `dateFrom`+`dateTo` | `appId`/`appName` | `deviceId` | `userId` |
`includeWindows` | `page` | `limit` (max 200).

Answers with `summary`, `byApp` (each with its per-device split), `byDate`,
`byDevice`, optional `windows`, and `pagination`. Everything is grouped,
summed and paged by MongoDB in one `$facet` pipeline, so a mobile client never
downloads usage history to add it up, and window arrays are only read when one
application's detail is asked for.

Today / yesterday / a chosen day / a range / one application are all this one
endpoint. `userId` reads **another** user's aggregate and is allowed only when
that user has an **accepted** share with the caller — the same rule the
existing report endpoint applies.

## The synchronization cycle

`TimeTrackingConfig.deviceUsageSyncInterval` (default **12 minutes**, the one
place that sets the cadence) drives `_startDeviceUsageSync()` in
`time_management.dart`. One cycle:

1. `getPendingSyncCount()` — an index lookup on `pendingSync`. Zero means no
   request at all.
2. a bounded page (`batchSize`, default 100) of pending records → one request.
3. mark only what was acknowledged, re-reading each record inside the write
   transaction.
4. stop as soon as a batch moves nothing; up to `maxBatches` (default 10) per
   cycle, so a long backlog is spread over cycles instead of blocking one.

Overlap is impossible: the service holds an `isRunning` flag and the tracker
holds its own guard. A failure backs off — 1, 2, 4, 8 … minutes, capped at 30
— and the backoff resets on the first success. The repository is created once
per view, so that state survives timer ticks. Nothing here blocks the UI or
the tracker: tracking keeps writing to Isar while a cycle runs.

A desktop timer only runs while the app runs, so the cycle also runs once at
start-up and picks up whatever accumulated while the app was closed — found
through the index, not by re-reading the database. Nothing is scheduled on
mobile: a phone does not track application usage, it only reads the aggregate.

## Edge cases

| case | handling |
| --- | --- |
| duplicate request | same `batchId` → the stored acknowledgement is returned, nothing is re-applied |
| replay with a new `batchId` | a snapshot is set, not added, so the total cannot grow; reported as `stale` |
| timeout after the backend processed it | next cycle re-uploads; the write is a no-op and the ack can also be re-read by `batchId` |
| partial batch failure | unordered bulk write; good items apply, the failed `localId`s stay pending |
| app restart mid-cycle | nothing was marked, so the same records are pending; the batch id is reproduced from the content |
| local change during an upload | `revision` is already higher than the acknowledged one, so the record stays pending — the change is never lost and the local total is never rewritten |
| two devices, same app and day | two documents, summed at read time |
| out-of-order / late snapshot | the revision guard refuses to regress a stored contribution |
| correction (including downward) | a higher revision replaces the contribution |
| clock differences / timezone boundary | the device's local `date` plus its `timezoneOffsetMinutes` are stored as reported |
| large backlog | bounded pages, bounded batches, bounded cycles |
| concurrent cycles | `isRunning` guard, and the backend write is atomic per document |
| local record deleted | see limitations |

## Files

**Backend (new)**

- `features/time_management_sharing/timeManagementAppIdentity.js`
- `features/time_management_sharing/timeManagementDeviceUsageModel.js`
- `features/time_management_sharing/timeManagementDeviceSyncBatchModel.js`
- `features/time_management_sharing/timeManagementDeviceUsageService.js`
- `features/time_management_sharing/timeManagementDeviceUsageController.js`
- `features/time_management_sharing/timeManagementDeviceUsageValidator.js`
- `features/time_management_sharing/timeManagementDeviceUsageRoute.js`
- `features/time_management_sharing/timeManagementDeviceUsageSync.test.js`

**Backend (modified)**: `server.js` (model preload + the new router at
`/api/v1/time-management-usage`), `package.json` (test scripts).

**Flutter (new)**

- `lib/time_management/src/models/device_usage_sync_model.dart`
- `lib/time_management/src/data/sync/device_identity.dart`
- `lib/time_management/src/data/sync/device_usage_sync_planner.dart`
- `lib/time_management/src/data/sync/device_usage_sync_service.dart`
- `test/time_management/device_usage_sync_test.dart`

**Flutter (modified)**: `app_usage_model.dart` (+ regenerated `.g.dart`),
`app_usage_database.dart`, `time_management_remote_data_source.dart`,
`time_management_repository.dart`, `time_management.dart`,
`core/settings.dart`, `core/constants/api_constants.dart`.

## Storage and indexes

`timemanagementdeviceusages`

- `{userId, deviceId, appKey, date}` unique — the contribution identity
- `{userId, date}` — range reports
- `{userId, appId, date}` — one application over time

`timemanagementdevicesyncbatches`

- `batchId` unique — the idempotency lookup
- `{userId, deviceId, createdAt}` — a device's recent batches
- `processedAt` TTL, 30 days — the ledger only has to cover a client's retry
  window. Expiry is safe because idempotency does not depend on it: an expired
  batch replayed later is re-applied as a snapshot, which changes nothing.

Both collections live on **local MongoDB** (`localMongoConnection`), like the
rest of Time Management — see `DUAL_DATABASE_SETUP.md`. The routes are behind
the same readiness guard, so they answer 503 rather than ever touching Atlas.

## Migration

None. The two collections are created on first write. Existing local records
get `revision = 1`, `syncedRevision = -1`, `pendingSync = true` from the Isar
schema defaults, so the first cycle after the update uploads the usage already
on each device — which is exactly the intended initial synchronization. The
desktop needs `dart run build_runner build` (already run here) for the
regenerated `app_usage_model.g.dart`.

The share-scoped `timemanagementusages` collection and its `/sync` endpoint are
unchanged, so nothing has to be migrated between the two paths.

## Limitations

- **A deleted local record cannot be reported.** Nothing in the app deletes
  usage records today (`deleteAppUsage`, `deleteAllByIds` and `clearAll` have
  no callers), so there is no tombstone mechanism. If deletion is ever
  exposed, the smallest safe addition is a snapshot with `totalDuration: 0`
  and a bumped revision before the local row goes away.
- **Window breakdown is capped at 500 titles per application and day**, flagged
  by `windowsTruncated`. Totals are never capped.
- **Reinstalling the desktop app produces a new `deviceId`**, so its earlier
  contribution stays in the aggregate as a device that no longer reports. The
  per-device breakdown shows it; removing it is a manual decision.
- **Usage recorded while signed out is not uploaded** until a user is signed
  in, and it is then attributed to whoever signs in on that device.
- The report endpoint reads only device-synced usage. Usage delivered through
  the older share path lives in its own collection and is read by the existing
  `/time-management-shares/reports` endpoint.
