/**
 * Helpers shared by the database connection modules.
 *
 * Connection strings carry credentials, so nothing in this layer ever logs a
 * raw URI: every log line goes through `redactMongoUri` first.
 */

/**
 * Strips the credentials and the option query string from a Mongo URI so the
 * remainder (scheme, host, database) is safe to log.
 */
const redactMongoUri = (uri) => {
  if (typeof uri !== "string" || uri.trim() === "") return "(unset)";
  return uri
    .trim()
    .replace(/\/\/[^/@]*@/, "//")
    .replace(/\?.*$/, "");
};

/**
 * Reads a required connection string from the environment.
 * Throws naming only the variable, never a value.
 */
const readRequiredUri = (envName, purpose) => {
  const uri = process.env[envName];
  if (typeof uri !== "string" || uri.trim() === "") {
    throw new Error(
      `${envName} is not configured, so the ${purpose} cannot be opened`,
    );
  }
  return uri.trim();
};

module.exports = { redactMongoUri, readRequiredUri };
