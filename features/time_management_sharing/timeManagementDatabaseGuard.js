const {
  isLocalMongoReady,
} = require("../../infrastructure/database/database.manager");
const ApiError = require("../../utils/apiError");

/**
 * Refuses Time Management requests while local MongoDB is not ready.
 *
 * This feature's data lives only in local MongoDB. If that connection is not
 * open, the request has no database to serve it and must say so — the one thing
 * it must never do is fall back to Atlas, where this feature's collections do
 * not belong. Mongoose would otherwise buffer the operation until it times out
 * with a generic error; a 503 names the real cause.
 */
const requireLocalMongoReady = (req, res, next) => {
  if (isLocalMongoReady()) return next();

  return next(
    new ApiError(
      "Time management storage is temporarily unavailable, please retry shortly",
      503,
    ),
  );
};

module.exports = { requireLocalMongoReady };
