# Dual MongoDB architecture — Atlas + local MongoDB

The backend talks to two independent MongoDB deployments:

| Connection             | Deployment                      | Used by                                                                         |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `atlasConnection`      | MongoDB Atlas (`MONGODB_URI`)   | users, auth, companies, invitations, notifications, canvas, files, whatsapp, attendance, my day |
| `localMongoConnection` | Local MongoDB (`MONGODB_LOCAL_URI`) | Time Management sharing (`features/time_management_sharing`) — **only**      |
| `tasksDb`              | Atlas (`TASKS_MONGODB_URI`)     | tasks management (pre-existing separate connection, untouched)                   |

Neither connection is a fallback for the other. A model is bound to exactly one
connection, so a failure on one side can never move reads or writes to the
other database.

```
infrastructure/database/
  atlas/atlas.connection.js          → atlasConnection      (Mongoose's default connection)
  local-mongo/local-mongo.connection.js → localMongoConnection (mongoose.createConnection)
  database.manager.js                → opens, validates and closes both
  mongoUriUtils.js                   → credential-safe URI logging
```

`atlasConnection` *is* Mongoose's default connection: every feature that
predates this split registers its models with `mongoose.model(...)`, which binds
them there. Naming it instead of re-registering ~40 models keeps collections,
indexes and behaviour exactly as they were.

Time Management models are registered with
`localMongoConnection.model(...)` through a factory with a `connection.models`
guard, never with `mongoose.model(...)`.

## Environment variables

Add to `config.env` (never committed — it is in `.gitignore`):

```ini
# Existing MongoDB Atlas connection (name unchanged)
MONGODB_URI=mongodb+srv://...

# Separate Atlas connection used by tasks management (unchanged)
TASKS_MONGODB_URI=mongodb+srv://...

# Local MongoDB Community Server — Time Management only.
MONGODB_LOCAL_URI=mongodb://tm_app:<password>@127.0.0.1:27017/time_management_db?authSource=time_management_db&replicaSet=rs-tm
```

Optional:

| Variable                                 | Default | Effect                                                                                                  |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `MONGODB_LOCAL_REQUIRED`                 | `false` | `true` makes an unavailable local MongoDB abort startup instead of leaving Time Management unavailable |
| `MONGODB_ATLAS_STARTUP_ATTEMPTS`         | `5`     | How many times startup tries Atlas before aborting. `1` restores the old fail-on-first-error behaviour |
| `MONGODB_ATLAS_STARTUP_RETRY_DELAY_MS`   | `1000`  | Delay before the second attempt; it doubles each time, capped at 8s                                     |

Both URIs are validated at startup, before anything connects. A missing one
fails with the variable's name — never with a value. No log line ever contains
credentials: every URI goes through `redactMongoUri` first.

## Startup, failure and shutdown behaviour

1. `initializeDatabases()` validates both connection strings.
2. Atlas connects first. A transient failure — DNS, network, or server
   selection — is retried up to `MONGODB_ATLAS_STARTUP_ATTEMPTS` times with a
   doubling delay (1s, 2s, 4s, 8s, capped), because a resolver hiccup on one
   shard host is not evidence that the cluster is unreachable. A rejected
   credential or an unparseable connection string is **not** retried: it fails
   identically every time and needs an operator. Once the attempts are spent
   the failure is fatal: the process logs `[atlas-db]` / `[database]` and
   exits 1, as before.
3. Local MongoDB connects second. A failure is reported, then retried every
   10s in the background. The rest of the API keeps serving Atlas normally;
   every Time Management route answers **503** until the local connection is
   ready (`timeManagementDatabaseGuard.js`), and the delivery scheduler skips
   its ticks. Nothing is served from Atlas in the meantime. Set
   `MONGODB_LOCAL_REQUIRED=true` to make this fatal instead.
4. The Time Management collections and their indexes are created before the
   first request (`timeManagementCollections.js`), and again if local MongoDB
   connects later. This is not just a warm-up: the usage-sync endpoint writes
   inside a transaction, and MongoDB cannot create a collection inside one, so
   on a database that has never been written the first sync would otherwise
   fail with a transient write conflict.
5. HTTP starts listening only after step 2/3, and the scheduler starts last.
6. `SIGINT`/`SIGTERM` stop the scheduler, stop accepting requests, then close
   both connections.

Repeated calls are de-duplicated, so no duplicate connection is ever opened.

## Running the tests

`npm test` needs a local mongod running (`scripts/start-local-mongod.cmd`) for
the Time Management suites, and the Atlas connection in `config.env` for
everything else.

The Time Management suites never write to the database the backend is running
against. `features/time_management_sharing/timeManagementTestDatabase.js`
points each of them at a throwaway database on the same mongod — the same
server, so the same replica set, which the transactional usage sync needs — and
refuses any URI whose database name does not contain `test`:

| Suite                                     | Database                               |
| ----------------------------------------- | -------------------------------------- |
| `timeManagementSharing`                   | `time_management_db_test_sharing`        |
| `timeManagementSharingRoutes`             | `time_management_db_test_routes`         |
| `timeManagementSharingScheduling`         | `time_management_db_test_scheduling`     |
| `timeManagementShareConfigurations`       | `time_management_db_test_configurations` |

One database per suite, because `node --test` runs the files in parallel and the
delivery scheduler is global: it picks up every due share in the database it is
pointed at, so a shared database lets one suite create a delivery that another
suite then counts. Set `MONGODB_LOCAL_TEST_URI` to move them elsewhere; the
suite name is still appended, and a database name without `test` in it is
refused.

With no mongod running, those suites skip themselves and say so instead of
failing — every Time Management model is bound to the local connection, so
without it each operation would buffer out after 10s and the cleanup in `after`
would never finish, leaving the test process alive.

`timeManagementDeviceUsageSync` has its own, older guard: it skips unless
`MONGODB_SYNC_TEST_URI` names a test database.

## Local development on Windows (portable mongod, no installer)

Time Management has no fallback: with no local MongoDB running, every one of its
endpoints answers **503** ("Time management storage is temporarily
unavailable") — by design, so a developer's data never lands in Atlas. For a
Windows development machine the quickest faithful setup is a portable mongod,
which needs no installer and no administrator rights:

1. Download the MongoDB Windows archive (`mongodb-windows-x86_64-8.0.15.zip`
   from `https://fastdl.mongodb.org/windows/`) and extract it to
   `D:\mongodb-portable\`, so `D:\mongodb-portable\mongodb-win32-…-8.0.15\bin\mongod.exe`
   exists. Database files live outside it, in `D:\mongodb-data\db`, so they
   survive replacing the binaries.
2. Start it, and leave the window open:

   ```bash
   scripts/start-local-mongod.cmd
   ```

3. Once, to make transactions available (a single-node replica set):

   ```bash
   node scripts/init-local-mongod-replicaset.js
   ```

4. `MONGODB_LOCAL_URI` in `config.env`:

   ```ini
   MONGODB_LOCAL_URI=mongodb://127.0.0.1:27017/time_management_db?replicaSet=rs-tm
   ```

It binds to `127.0.0.1` only and runs without authentication, which is
acceptable for a loopback-only development server and is **not** how the
production server is configured (see below: there, authentication and a
least-privilege user are required). mongod is not a service here, so it has to
be started again after a reboot — the backend logs the failure, retries every
10s, and Time Management recovers on its own once mongod is up.

## Installing local MongoDB on the deployment server (Ubuntu 22.04 / 24.04)

> Run these on the application server, where the Node.js process runs.
> They install a new service; they do not change the existing application or
> restart it. **Do not restart production services without authorization.**

`scripts/setup-local-mongod-linux.sh` performs steps 1 to 5 below and then
writes `MONGODB_LOCAL_URI` into the `config.env` you point it at, with a
generated password it never prints. It restarts `mongod` (not the app), and it
is safe to run again: each step checks whether it has already been done.

```bash
sudo ./scripts/setup-local-mongod-linux.sh --config /path/to/config.env
```

It stops without changing anything if authentication is already enabled and
`MONGODB_LOCAL_URI` is already set, because it cannot read that password back
to reuse it. To rotate the password, remove the `MONGODB_LOCAL_URI` line from
`config.env` and run it again. It never restarts the application, so finish
with `pm2 restart bm_backend` yourself.

The steps below are what the script does, kept as the reference — and for a
server you would rather configure by hand.

### 1. Install MongoDB Community Server 8.0

```bash
sudo apt-get install -y gnupg curl
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
  | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/8.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
```

The bundled driver is MongoDB Node driver 7.2 (Mongoose 9), which supports
server 7.0 and 8.0.

### 2. Configure `/etc/mongod.conf`

A **single-node replica set** is required, not a standalone: the usage-sync
endpoint writes the batch record and the daily totals in one transaction, and
transactions need a replica set. (The code degrades to a non-transactional write
on a standalone, but then a concurrent retry is no longer atomic.)

```yaml
storage:
  # Persistent disk, never /tmp. Journaling stays enabled (default).
  dbPath: /var/lib/mongodb
  wiredTiger:
    collectionConfig:
      # Better compression ratio than the snappy default, for a large,
      # text-heavy store. Applies to collections created after this change.
      blockCompressor: zstd

net:
  port: 27017
  # Loopback only: the backend runs on this machine. Never expose 27017.
  bindIp: 127.0.0.1

replication:
  replSetName: rs-tm

systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
```

```bash
sudo chown -R mongodb:mongodb /var/lib/mongodb /var/log/mongodb
sudo chmod 750 /var/lib/mongodb
sudo systemctl enable --now mongod     # enable = survives reboots
```

### 3. Initiate the replica set and create the users

```bash
mongosh --host 127.0.0.1 --eval 'rs.initiate({_id: "rs-tm", members: [{_id: 0, host: "127.0.0.1:27017"}]})'
```

```bash
# Replace both passwords with generated secrets; store them only in config.env.
mongosh --host 127.0.0.1 <<'EOF'
use admin
db.createUser({
  user: "tm_admin",
  pwd: passwordPrompt(),
  roles: [{ role: "userAdminAnyDatabase", db: "admin" }, { role: "clusterAdmin", db: "admin" }]
})

use time_management_db
db.createUser({
  user: "tm_app",
  pwd: passwordPrompt(),
  // Least privilege: read and write this one database, nothing else.
  roles: [{ role: "readWrite", db: "time_management_db" }]
})
EOF
```

### 4. Enable authentication

A replica set with authentication also needs an internal keyfile, even with one
member:

```bash
openssl rand -base64 756 | sudo tee /etc/mongodb-keyfile > /dev/null
sudo chown mongodb:mongodb /etc/mongodb-keyfile
sudo chmod 400 /etc/mongodb-keyfile
```

Append to `/etc/mongod.conf` (`keyFile` implies `authorization: enabled`):

```yaml
security:
  keyFile: /etc/mongodb-keyfile
  authorization: enabled
```

```bash
sudo systemctl restart mongod
# Verify: this must now fail, and the authenticated form must succeed.
mongosh "mongodb://127.0.0.1:27017/time_management_db" --eval 'db.getCollectionNames()'
mongosh "mongodb://tm_app:<password>@127.0.0.1:27017/time_management_db?replicaSet=rs-tm" --eval 'db.getCollectionNames()'
```

### 5. Confirm it is not publicly reachable

```bash
sudo ss -lntp | grep 27017        # must show 127.0.0.1:27017 only
sudo ufw deny 27017               # defence in depth, if ufw is in use
```

## Deployment changes

- Add `MONGODB_LOCAL_URI` to the `config.env` that sits next to the
  `production/server` binary on the server. The app will not start without it.
- Percent-encode any special characters in the password.
- `mongod` must be enabled (`systemctl enable mongod`) so it comes back before
  PM2 restarts the app after a reboot. If PM2 wins the race, the app starts,
  logs the failure and recovers on the 10s retry — Time Management answers 503
  until then.
- No change to `.github/workflows/deploy.yml`, `Dockerfile` or `fly.toml` is
  required by this work. Note that the Docker/Fly deployments have no local
  MongoDB of their own: they need `MONGODB_LOCAL_URI` pointed at a reachable
  MongoDB (a sidecar or host service) or Time Management stays at 503 there.
- Back up the local database yourself — it has none of Atlas's managed
  backups. For example a daily `mongodump` of `time_management_db` to
  persistent storage.

## Migration from Atlas

State of the Atlas database `bm` when this change was made (read-only count):

| Collection                       | Documents |
| -------------------------------- | --------- |
| `timemanagementshares`           | **2**     |
| `timemanagementusages`           | 0         |
| `timemanagementsyncbatches`      | 0         |
| `timemanagementsharedeliveries`  | 0         |
| `timemanagementsharelinks`       | 0         |

Only two share configurations exist. If they are disposable test data, no
migration is needed: the local collections are simply created on first write.
If they must be kept, run the migration script, which is explicit, repeatable
and non-destructive:

```bash
node migrateTimeManagementToLocalMongo.js            # dry run: reports counts only
node migrateTimeManagementToLocalMongo.js --confirm  # copies Atlas → local
```

- Nothing in Atlas is modified or deleted; it stays a complete fallback.
- Documents keep their `_id`, so ids and references between Time Management
  documents survive unchanged.
- Writes are `replaceOne` upserts keyed by `_id`, so re-running after a failure
  cannot create duplicates.
- Documents are streamed in batches of 500, so a large collection is never
  loaded into application memory.
- Counts are verified per collection afterwards and a shortfall exits non-zero.

Only the five `timemanagement*` collections are touched. The Atlas copies can
be dropped later, manually, once the local database has been verified — the
script never does it.

## Cross-database dependency: users and companies

Time Management documents reference `User` and `Company`, which live in Atlas.
MongoDB cannot join across deployments, so this is handled explicitly:

- Every `populate` of `senderUserId` / `recipientUserId` passes the
  Atlas-bound `UserModel` through the `model` option
  (`populateSender` / `populateRecipient` in `timeManagementSharingService.js`).
  Mongoose then resolves the reference with a second query on the Atlas
  connection. `ref: "User"` alone is not enough and fails loudly.
- Authorization, company membership and notifications already go through the
  Atlas-bound `UserModel`, `CompanyModel`, `InvitationModel` and
  `NotificationHelper`, which keep their own connection.
- Usage reports therefore cost one local query plus one Atlas lookup. Both
  databases must be reachable for the report endpoints that name users.

## Tests

```bash
npm run test:database   # connection split; needs no database, uses no Atlas data
npm test                # the above plus the existing integration suites
```

`npm run test:database` asserts the two connections are independent, that each
Time Management model is on `localMongoConnection` and absent from the default
(Atlas) connection, that the Atlas models are the reverse, that a name
registered on both connections yields two distinct models, that a local failure
yields 503 rather than an Atlas read, that startup validates both URIs, and that
no log line can carry credentials. The CRUD cases skip themselves when no local
MongoDB is reachable.

The four pre-existing integration suites write to Atlas **and** now require a
reachable local MongoDB, because the Time Management collections they exercise
live there.
