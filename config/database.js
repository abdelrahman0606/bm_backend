const {
  connectAtlas,
} = require("../infrastructure/database/atlas/atlas.connection");

/**
 * Opens the MongoDB Atlas connection only.
 *
 * Kept for the standalone scripts that already call it (for example
 * `migrateTasksToIssues.js`), which have no reason to open the local MongoDB
 * connection. The server itself goes through
 * `infrastructure/database/database.manager`, which owns both connections.
 */
const dbConnection = async () => {
  try {
    await connectAtlas();
  } catch (err) {
    console.error("Database connection error:", err.message);
    process.exit(1);
  }
};

module.exports = dbConnection;
