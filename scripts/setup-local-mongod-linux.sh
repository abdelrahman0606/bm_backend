#!/usr/bin/env bash
#
# Sets up the local MongoDB that the Time Management feature reads and writes,
# on the Ubuntu server that runs this backend, and writes MONGODB_LOCAL_URI into
# the config.env the app reads.
#
# This is the scripted form of the Ubuntu section of DUAL_DATABASE_SETUP.md:
#
#   1. install MongoDB Community Server 8.0
#   2. write /etc/mongod.conf — loopback only, single-node replica set rs-tm
#   3. enable and start mongod, so it survives a reboot
#   4. initiate the replica set
#   5. create tm_admin and the least-privilege tm_app user
#   6. enable keyfile authentication
#   7. verify, then write MONGODB_LOCAL_URI into config.env
#
# A single-node replica set is required rather than a standalone: the usage-sync
# endpoint writes its batch record and the daily totals in one transaction, and
# transactions need a replica set.
#
# Safe to run again. Each step checks whether it has already been done, so a
# second run repairs what is missing and leaves the rest alone. The generated
# password is never printed and never passed on a command line, so it cannot be
# read out of the logs or out of `ps`.
#
# Usage:
#   sudo ./setup-local-mongod-linux.sh --config /path/to/config.env [--yes]
#
#   --config  the config.env the app reads, the one next to production/server.
#   --yes     skip the confirmation prompt (for an unattended run).
#
set -euo pipefail

readonly REPLICA_SET="rs-tm"
readonly MEMBER="127.0.0.1:27017"
readonly APP_DB="time_management_db"
readonly APP_USER="tm_app"
readonly ADMIN_USER="tm_admin"
readonly MONGOD_CONF="/etc/mongod.conf"
readonly KEYFILE="/etc/mongodb-keyfile"
readonly URI_ENV="MONGODB_LOCAL_URI"

CONFIG_ENV=""
ASSUME_YES=0

# Anything secret is written to a file only root can read, never to argv.
WORK_DIR=""

log() { printf '[setup-mongod] %s\n' "$*"; }
die() { printf '[setup-mongod] error: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    find "$WORK_DIR" -type f -exec shred -u {} + 2>/dev/null || true
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT INT TERM

# ── Arguments ───────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --config) CONFIG_ENV="${2:-}"; shift 2 ;;
    --config=*) CONFIG_ENV="${1#*=}"; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run with sudo: it installs a package and writes $MONGOD_CONF"
[ -n "$CONFIG_ENV" ] || die "--config is required: the path of the config.env the app reads"
[ -f "$CONFIG_ENV" ] || die "no such file: $CONFIG_ENV"

command -v systemctl >/dev/null || die "systemd is required; this script targets Ubuntu"

if [ "$ASSUME_YES" -ne 1 ]; then
  cat <<EOF

This will, on THIS machine:
  - install the mongodb-org package if it is missing
  - write $MONGOD_CONF (the current one is backed up)
  - enable and restart the mongod service
  - create the $ADMIN_USER and $APP_USER database users if they are missing
  - enable authentication with a keyfile at $KEYFILE
  - set $URI_ENV in $CONFIG_ENV (backed up first)

Nothing in MongoDB Atlas is touched, and no existing data is deleted.

EOF
  printf 'Continue? [y/N] '
  read -r answer
  case "$answer" in [yY]|[yY][eE][sS]) ;; *) die "cancelled" ;; esac
fi

WORK_DIR="$(mktemp -d)"
chmod 700 "$WORK_DIR"

# Keeps every generated file unreadable to anyone but root.
umask 077

timestamp() { date +%Y%m%d-%H%M%S; }

# ── 1. Install MongoDB Community Server 8.0 ─────────────────────────────────

if command -v mongod >/dev/null; then
  log "mongod already installed: $(mongod --version | sed -n '1p')"
else
  log "installing MongoDB Community Server 8.0"
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y gnupg curl >/dev/null

  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
    | gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor --yes

  # shellcheck disable=SC1091
  . /etc/os-release
  codename="$(lsb_release -cs 2>/dev/null || echo "${UBUNTU_CODENAME:-}")"
  [ -n "$codename" ] || die "could not determine the Ubuntu codename"

  printf 'deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu %s/mongodb-org/8.0 multiverse\n' \
    "$codename" > /etc/apt/sources.list.d/mongodb-org-8.0.list

  apt-get update >/dev/null
  apt-get install -y mongodb-org >/dev/null
  log "installed $(mongod --version | sed -n '1p')"
fi

command -v mongosh >/dev/null || die "mongosh is missing; expected it from the mongodb-org package"

# ── 2. Configure mongod ─────────────────────────────────────────────────────
#
# Written without the security block: the users have to exist before
# authentication is turned on, in step 6.

write_mongod_conf() {
  local with_auth="$1" conf="$WORK_DIR/mongod.conf"

  cat > "$conf" <<EOF
# Managed by scripts/setup-local-mongod-linux.sh — see DUAL_DATABASE_SETUP.md

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
  replSetName: $REPLICA_SET

systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
EOF

  if [ "$with_auth" = "with-auth" ]; then
    cat >> "$conf" <<EOF

security:
  # keyFile is required for a replica set with authentication, even with one
  # member, and it implies authorization: enabled.
  keyFile: $KEYFILE
  authorization: enabled
EOF
  fi

  if [ -f "$MONGOD_CONF" ] && cmp -s "$conf" "$MONGOD_CONF"; then
    log "$MONGOD_CONF already correct"
    return 1
  fi

  if [ -f "$MONGOD_CONF" ]; then
    cp -p "$MONGOD_CONF" "$MONGOD_CONF.bak-$(timestamp)"
    log "backed up the previous $MONGOD_CONF"
  fi

  cat "$conf" > "$MONGOD_CONF"
  chmod 644 "$MONGOD_CONF"
  log "wrote $MONGOD_CONF"
  return 0
}

auth_already_enabled() {
  [ -f "$MONGOD_CONF" ] && grep -qE '^[[:space:]]*authorization:[[:space:]]*enabled' "$MONGOD_CONF"
}

# On a re-run with authentication already on, the config must keep it on,
# otherwise this script would lock the app out of its own database.
if auth_already_enabled; then
  log "authentication is already enabled"
  write_mongod_conf with-auth || true
  AUTH_WAS_ON=1
else
  write_mongod_conf no-auth || true
  AUTH_WAS_ON=0
fi

mkdir -p /var/lib/mongodb /var/log/mongodb
chown -R mongodb:mongodb /var/lib/mongodb /var/log/mongodb
chmod 750 /var/lib/mongodb

# ── 3. Start the service, enabled so it survives a reboot ───────────────────
#
# mongod must come back before PM2 restarts the app. If PM2 wins the race the
# app still starts, logs the failure and recovers on its 10s retry, while Time
# Management answers 503 until then.

wait_for_mongod() {
  # ping needs no authentication, so this works before and after step 6.
  local i
  for i in $(seq 1 60); do
    if mongosh --quiet --host "$MEMBER" --eval 'db.runCommand({ping: 1}).ok' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

log "enabling and restarting mongod"
systemctl enable mongod >/dev/null 2>&1 || true
systemctl restart mongod
wait_for_mongod || die "mongod did not become reachable; check journalctl -u mongod and /var/log/mongodb/mongod.log"
log "mongod is listening on $MEMBER"

# ── 4. Initiate the replica set ─────────────────────────────────────────────

run_js() { # run_js <file> — the file may hold secrets, so it never goes in argv
  mongosh --quiet --nodb --file "$1"
}

cat > "$WORK_DIR/rs.js" <<EOF
const c = new Mongo("mongodb://$MEMBER/admin?directConnection=true");
const admin = c.getDB("admin");
let state = "none";
try {
  const status = admin.runCommand({ replSetGetStatus: 1 });
  state = status.myState === 1 ? "primary" : String(status.myState);
} catch (err) {
  // 94 = NotYetInitialized, the expected first-run case.
  if (err.code !== 94 && !/no replset config/i.test(err.message)) throw err;
  admin.runCommand({
    replSetInitiate: { _id: "$REPLICA_SET", members: [{ _id: 0, host: "$MEMBER" }] },
  });
  state = "initiated";
}
print(state);
EOF

rs_state="$(run_js "$WORK_DIR/rs.js")" || die "could not read or initiate the replica set"
log "replica set $REPLICA_SET: $rs_state"

# Initiation takes a moment to elect the single member as primary.
cat > "$WORK_DIR/wait_primary.js" <<EOF
const c = new Mongo("mongodb://$MEMBER/admin?directConnection=true");
const admin = c.getDB("admin");
for (let i = 0; i < 60; i += 1) {
  try {
    if (admin.runCommand({ replSetGetStatus: 1 }).myState === 1) { print("primary"); quit(0); }
  } catch (err) { /* still electing */ }
  sleep(1000);
}
print("not-primary");
quit(1);
EOF

run_js "$WORK_DIR/wait_primary.js" >/dev/null || die "$REPLICA_SET never reached PRIMARY"
log "replica set is PRIMARY"

# ── 5. Users ────────────────────────────────────────────────────────────────
#
# The password is generated from characters that need no percent-encoding, so
# the URI can never be mangled by an escaped character.

generate_password() {
  # openssl writes a finite amount and tr consumes all of it, so no stage of
  # this ever takes a SIGPIPE — which `set -o pipefail` would turn into an
  # abort, as `tr < /dev/urandom | head -c 40` does.
  local pwd=""
  while [ "${#pwd}" -lt 40 ]; do
    pwd="$pwd$(openssl rand -base64 48 | LC_ALL=C tr -dc 'A-Za-z0-9')"
  done
  printf '%s' "${pwd:0:40}"
}

config_env_uri() {
  sed -n "s/^$URI_ENV=//p" "$CONFIG_ENV" | tail -1
}

existing_uri="$(config_env_uri)"

if [ "$AUTH_WAS_ON" -eq 1 ] && [ -n "$existing_uri" ]; then
  # Already set up, and config.env holds the password: change nothing, because
  # this script cannot read that password back to reuse it.
  log "$URI_ENV is already set in $CONFIG_ENV and authentication is on"
  log "nothing to change; re-run with the line removed from config.env to reset the password"
  printf '\n'
  log "verify with: pm2 logs --lines 30"
  exit 0
fi

APP_PASSWORD="$(generate_password)"
ADMIN_PASSWORD="$(generate_password)"

# Secrets go in the file, not in argv.
cat > "$WORK_DIR/users.js" <<EOF
const c = new Mongo("mongodb://$MEMBER/admin?directConnection=true");
const admin = c.getDB("admin");
const appDb = c.getDB("$APP_DB");

const upsert = (db, user, pwd, roles) => {
  if (db.getUser(user)) {
    db.changeUserPassword(user, pwd);
    print("reset:" + user);
  } else {
    db.createUser({ user: user, pwd: pwd, roles: roles });
    print("created:" + user);
  }
};

upsert(admin, "$ADMIN_USER", "$ADMIN_PASSWORD", [
  { role: "userAdminAnyDatabase", db: "admin" },
  { role: "clusterAdmin", db: "admin" },
]);

// Least privilege: read and write this one database, nothing else.
upsert(appDb, "$APP_USER", "$APP_PASSWORD", [
  { role: "readWrite", db: "$APP_DB" },
]);
EOF

if [ "$AUTH_WAS_ON" -eq 1 ]; then
  # Authentication is on but config.env has no URI, so the app password is
  # unknown and has to be reset. That needs an authenticated admin, which this
  # script does not have.
  die "authentication is on but $URI_ENV is missing from $CONFIG_ENV. Reset it yourself with an admin account:
  mongosh \"mongodb://$ADMIN_USER:<password>@$MEMBER/admin?replicaSet=$REPLICA_SET\" --eval 'db.getSiblingDB(\"$APP_DB\").changeUserPassword(\"$APP_USER\", passwordPrompt())'
then add the $URI_ENV line to $CONFIG_ENV."
fi

log "creating the database users"
run_js "$WORK_DIR/users.js" | while read -r line; do log "  $line"; done

# ── 6. Enable authentication ────────────────────────────────────────────────

if [ ! -f "$KEYFILE" ]; then
  log "generating the replica set keyfile"
  openssl rand -base64 756 > "$KEYFILE"
  chown mongodb:mongodb "$KEYFILE"
  chmod 400 "$KEYFILE"
else
  log "keyfile already present at $KEYFILE"
  chown mongodb:mongodb "$KEYFILE"
  chmod 400 "$KEYFILE"
fi

write_mongod_conf with-auth || true
log "restarting mongod with authentication enabled"
systemctl restart mongod
wait_for_mongod || die "mongod did not come back after enabling authentication; see journalctl -u mongod"

# ── 7. Verify, then write the URI into config.env ───────────────────────────

APP_URI="mongodb://$APP_USER:$APP_PASSWORD@$MEMBER/$APP_DB?authSource=$APP_DB&replicaSet=$REPLICA_SET"

cat > "$WORK_DIR/verify.js" <<EOF
// The authenticated connection must work.
const ok = new Mongo("$APP_URI");
ok.getDB("$APP_DB").getCollectionNames();

// And the unauthenticated one must not.
let refused = false;
try {
  new Mongo("mongodb://$MEMBER/$APP_DB?directConnection=true")
    .getDB("$APP_DB")
    .getCollectionNames();
} catch (err) {
  refused = true;
}
if (!refused) {
  print("UNAUTHENTICATED ACCESS STILL ALLOWED");
  quit(1);
}
print("ok");
EOF

log "verifying authentication"
run_js "$WORK_DIR/verify.js" >/dev/null \
  || die "verification failed: the app credentials do not work, or the database is still readable without them"
log "authenticated access works, unauthenticated access is refused"

cp -p "$CONFIG_ENV" "$CONFIG_ENV.bak-$(timestamp)"
log "backed up $CONFIG_ENV"

# Rewritten in place with `cat >`, so the file keeps its owner and mode.
{
  grep -v "^$URI_ENV=" "$CONFIG_ENV" || true
  printf '%s\n' "$URI_ENV=$APP_URI"
} > "$WORK_DIR/config.env"
cat "$WORK_DIR/config.env" > "$CONFIG_ENV"
log "set $URI_ENV in $CONFIG_ENV"

# ── Summary ─────────────────────────────────────────────────────────────────

printf '\n'
log "done. MongoDB $REPLICA_SET is running on $MEMBER, database $APP_DB, user $APP_USER."
log "the generated passwords were written only to $CONFIG_ENV; the admin password was not kept."
printf '\n'
log "next: restart the app so it picks up the new variable"
log "  pm2 restart bm_backend"
printf '\n'
log "then confirm 27017 is not publicly reachable:"
log "  ss -lntp | grep 27017      # must show 127.0.0.1:27017 only"
printf '\n'
log "the local database has no managed backups like Atlas — schedule a mongodump of $APP_DB."
