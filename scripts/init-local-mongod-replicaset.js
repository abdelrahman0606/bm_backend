const mongoose = require("mongoose");

/**
 * Initiates the single-node replica set of the local development MongoDB.
 *
 * Run once, after `scripts/start-local-mongod.cmd` has started mongod with
 * `--replSet rs-tm`. Running it again is harmless: an already-initiated set
 * reports itself and nothing is changed.
 *
 * A replica set — even with one member — is what makes transactions available,
 * which the usage-sync endpoint uses to write a batch record and the daily
 * totals together. It needs no authentication and no administrator rights,
 * because the server is bound to the loopback interface and has no users yet.
 *
 *   node scripts/init-local-mongod-replicaset.js
 */

const REPLICA_SET = "rs-tm";
const MEMBER = "127.0.0.1:27017";

const run = async () => {
  // directConnection, because the set does not exist yet: the driver must not
  // try to discover a topology.
  const connection = await mongoose
    .createConnection(`mongodb://${MEMBER}/admin?directConnection=true`, {
      serverSelectionTimeoutMS: 5000,
    })
    .asPromise();

  const admin = connection.db.admin();

  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    console.log(
      `[init-replicaset] already initiated: set "${status.set}", state ${status.myState === 1 ? "PRIMARY" : status.myState}`,
    );
    return;
  } catch (err) {
    // 94 = NotYetInitialized, which is the expected first-run case.
    if (err.code !== 94 && !/no replset config/i.test(err.message)) {
      throw err;
    }
  }

  await admin.command({
    replSetInitiate: {
      _id: REPLICA_SET,
      members: [{ _id: 0, host: MEMBER }],
    },
  });
  console.log(`[init-replicaset] initiated "${REPLICA_SET}" with ${MEMBER}`);

  // Election of a single member is quick, but not instant.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const status = await admin.command({ replSetGetStatus: 1 });
    if (status.myState === 1) {
      console.log("[init-replicaset] member is PRIMARY, transactions available");
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }

  throw new Error("the member did not become PRIMARY within 15s");
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[init-replicaset] failed: ${err.message}`);
    process.exit(1);
  });
