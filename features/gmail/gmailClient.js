const axios = require("axios");
const ApiError = require("../../utils/apiError");

/**
 * The HTTP layer for the Gmail API.
 *
 * Written against the REST endpoints with `axios` rather than pulling in
 * `googleapis`: that package is a ~50MB dependency carrying every Google API
 * there is, the backend already uses `axios` and `google-auth-library` for
 * the Drive integration, and the twenty endpoints Gmail needs are a thin
 * surface. Adding the heavier client would duplicate an HTTP stack the
 * project already has.
 *
 * Everything awkward about talking to Gmail is handled here so no service
 * above has to:
 *
 * **Expired tokens.** An access token lives an hour and sync runs for longer
 * than that. On a 401 the client asks for a new token once and replays the
 * request. Twice would mean the grant is dead, which is a different problem.
 *
 * **Quota.** Gmail rate-limits per user and per project, and signals it as
 * either 429 or 403 with a reason string. Those, and 5xx, are retried with
 * exponential backoff and jitter — jitter because a mailbox that just got
 * rate-limited is usually one of several syncing at once, and synchronized
 * retries would collide again.
 *
 * **Error identity.** A Google error arrives as a nested JSON object. It is
 * flattened into a `GmailApiError` carrying the reason string, the HTTP
 * status and — the field everything branches on — whether retrying could
 * plausibly work.
 */

const BASE_URL = "https://gmail.googleapis.com/gmail/v1";

/** Default attempts for a retryable failure, including the first. */
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 20000;

/** Reasons Google gives that mean "later, not never". */
const RETRYABLE_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "backendError",
  "internalError",
  "serviceUnavailable",
]);

/**
 * A Gmail failure, with the one question callers actually ask of it.
 *
 * Extends ApiError so the global error middleware renders it like anything
 * else, with a status a client can act on rather than a blanket 500.
 */
class GmailApiError extends ApiError {
  constructor({ message, httpStatus, reason, retryable, details }) {
    // A Google 401 is about *our* stored grant, not the caller's session, so
    // it is reported as a 502: answering 401 would make a client think its
    // own token expired and log the user out of the whole app.
    const status = httpStatus === 401 ? 502 : httpStatus || 502;
    super(message, status >= 400 && status < 600 ? status : 502);
    this.name = "GmailApiError";
    this.httpStatus = httpStatus || null;
    this.reason = reason || null;
    this.retryable = retryable === true;
    this.details = details || null;
  }
}

/** Pulls the useful parts out of Google's nested error body. */
const describeFailure = (error) => {
  const { response } = error;
  const httpStatus = response?.status || null;
  const body = response?.data?.error;

  const reason =
    body?.errors?.[0]?.reason ||
    (typeof body?.status === "string" ? body.status : null) ||
    null;
  const message = body?.message || error.message || "Gmail request failed";

  const retryable =
    RETRYABLE_REASONS.has(reason) ||
    httpStatus === 429 ||
    (httpStatus >= 500 && httpStatus <= 599) ||
    // No response at all: a dropped connection or a DNS blip, both worth one
    // more try. A request we never managed to send cannot have had an effect.
    (!response && ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(error.code));

  return { httpStatus, reason, message, retryable, details: body || null };
};

/** Exponential backoff with full jitter, honouring `Retry-After` when sent. */
const backoffFor = (attempt, error) => {
  const retryAfter = Number(error?.response?.headers?.["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
  }
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return Math.round(ceiling * (0.5 + Math.random() / 2));
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Builds a client bound to one mailbox.
 *
 * `getAccessToken({ forceRefresh })` is supplied by the token service, so the
 * client never touches the database or a refresh token. That split is what
 * keeps this file testable with a stub and keeps the decrypted token's
 * lifetime as short as the call it is used for.
 */
const createClient = ({
  getAccessToken,
  userId = "me",
  maxAttempts = MAX_ATTEMPTS,
  // Injected by the tests.
  http = axios,
  onRetry = null,
}) => {
  if (typeof getAccessToken !== "function") {
    throw new ApiError("A Gmail client needs a getAccessToken function", 500);
  }

  const request = async (method, path, options = {}) => {
    const { params, data, headers, responseType, timeout } = options;
    let refreshed = false;

    const attemptOnce = async (attempt) => {
      const accessToken = await getAccessToken({ forceRefresh: refreshed });
      try {
        const response = await http({
          method,
          url: `${BASE_URL}/users/${encodeURIComponent(userId)}${path}`,
          params,
          data,
          responseType: responseType || "json",
          timeout: timeout || 60000,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(data ? { "Content-Type": "application/json" } : {}),
            ...(headers || {}),
          },
          // Large mailboxes return large pages; the default 10MB cap is not
          // enough for a message with an inline image.
          maxContentLength: 64 * 1024 * 1024,
          maxBodyLength: 64 * 1024 * 1024,
        });
        return response.data;
      } catch (error) {
        const failure = describeFailure(error);

        // One token refresh, then give up on that theory: a second 401 means
        // the grant itself is gone, and replaying forever would hammer
        // Google's token endpoint with a credential it has already refused.
        if (failure.httpStatus === 401 && !refreshed) {
          refreshed = true;
          return attemptOnce(attempt);
        }

        if (failure.retryable && attempt < maxAttempts) {
          const wait = backoffFor(attempt, error);
          if (onRetry) onRetry({ attempt, wait, failure, method, path });
          await sleep(wait);
          return attemptOnce(attempt + 1);
        }

        throw new GmailApiError(failure);
      }
    };

    return attemptOnce(1);
  };

  const query = (params) => ({ params });

  return {
    request,

    /** The mailbox's own address and current history id. */
    getProfile: () => request("GET", "/profile"),

    messages: {
      list: ({
        q,
        labelIds,
        maxResults = 100,
        pageToken,
        includeSpamTrash = false,
      } = {}) =>
        request("GET", "/messages", {
          params: {
            // Gmail's own search syntax, passed straight through. Nothing
            // here reimplements `from:`, `has:attachment` or `older_than:` —
            // Gmail is the only thing that implements them correctly.
            ...(q ? { q } : {}),
            ...(labelIds ? { labelIds } : {}),
            maxResults,
            ...(pageToken ? { pageToken } : {}),
            includeSpamTrash,
          },
        }),

      /**
       * `format` matters for quota as much as for content: `metadata` costs
       * far less than `full` and is all a list needs, so the sync asks for
       * metadata and only an opened message is fetched in full.
       */
      get: (id, { format = "full", metadataHeaders } = {}) =>
        request("GET", `/messages/${encodeURIComponent(id)}`, {
          params: {
            format,
            ...(metadataHeaders ? { metadataHeaders } : {}),
          },
        }),

      modify: (id, { addLabelIds = [], removeLabelIds = [] }) =>
        request("POST", `/messages/${encodeURIComponent(id)}/modify`, {
          data: { addLabelIds, removeLabelIds },
        }),

      /** Up to 1000 ids in one call, which is how bulk operations stay cheap. */
      batchModify: ({ ids, addLabelIds = [], removeLabelIds = [] }) =>
        request("POST", "/messages/batchModify", {
          data: { ids, addLabelIds, removeLabelIds },
        }),

      trash: (id) =>
        request("POST", `/messages/${encodeURIComponent(id)}/trash`),
      untrash: (id) =>
        request("POST", `/messages/${encodeURIComponent(id)}/untrash`),
      /** Irreversible, and refused by anything short of full access. */
      delete: (id) => request("DELETE", `/messages/${encodeURIComponent(id)}`),

      send: ({ raw, threadId }) =>
        request("POST", "/messages/send", {
          data: { raw, ...(threadId ? { threadId } : {}) },
        }),

      attachment: (messageId, attachmentId) =>
        request(
          "GET",
          `/messages/${encodeURIComponent(messageId)}/attachments/` +
            `${encodeURIComponent(attachmentId)}`,
        ),
    },

    threads: {
      list: ({ q, labelIds, maxResults = 50, pageToken, includeSpamTrash = false } = {}) =>
        request("GET", "/threads", {
          params: {
            ...(q ? { q } : {}),
            ...(labelIds ? { labelIds } : {}),
            maxResults,
            ...(pageToken ? { pageToken } : {}),
            includeSpamTrash,
          },
        }),
      get: (id, { format = "full" } = {}) =>
        request("GET", `/threads/${encodeURIComponent(id)}`, query({ format })),
      modify: (id, { addLabelIds = [], removeLabelIds = [] }) =>
        request("POST", `/threads/${encodeURIComponent(id)}/modify`, {
          data: { addLabelIds, removeLabelIds },
        }),
      trash: (id) => request("POST", `/threads/${encodeURIComponent(id)}/trash`),
      untrash: (id) =>
        request("POST", `/threads/${encodeURIComponent(id)}/untrash`),
      delete: (id) => request("DELETE", `/threads/${encodeURIComponent(id)}`),
    },

    labels: {
      list: () => request("GET", "/labels"),
      get: (id) => request("GET", `/labels/${encodeURIComponent(id)}`),
      create: (label) => request("POST", "/labels", { data: label }),
      update: (id, label) =>
        request("PATCH", `/labels/${encodeURIComponent(id)}`, { data: label }),
      delete: (id) => request("DELETE", `/labels/${encodeURIComponent(id)}`),
    },

    drafts: {
      list: ({ maxResults = 50, pageToken } = {}) =>
        request("GET", "/drafts", {
          params: { maxResults, ...(pageToken ? { pageToken } : {}) },
        }),
      get: (id, { format = "full" } = {}) =>
        request("GET", `/drafts/${encodeURIComponent(id)}`, query({ format })),
      create: ({ raw, threadId }) =>
        request("POST", "/drafts", {
          data: { message: { raw, ...(threadId ? { threadId } : {}) } },
        }),
      update: (id, { raw, threadId }) =>
        request("PUT", `/drafts/${encodeURIComponent(id)}`, {
          data: { message: { raw, ...(threadId ? { threadId } : {}) } },
        }),
      send: (id) => request("POST", "/drafts/send", { data: { id } }),
      delete: (id) => request("DELETE", `/drafts/${encodeURIComponent(id)}`),
    },

    /**
     * The change log a mailbox keeps. `startHistoryId` is the cursor; Gmail
     * answers 404 when it is too old to replay, which is the signal to fall
     * back to a full resync.
     */
    history: {
      list: ({ startHistoryId, historyTypes, labelId, maxResults = 500, pageToken } = {}) =>
        request("GET", "/history", {
          params: {
            startHistoryId,
            ...(historyTypes ? { historyTypes } : {}),
            ...(labelId ? { labelId } : {}),
            maxResults,
            ...(pageToken ? { pageToken } : {}),
          },
        }),
    },

    /** Asks Gmail to publish this mailbox's changes to a Pub/Sub topic. */
    watch: ({ topicName, labelIds, labelFilterBehavior }) =>
      request("POST", "/watch", {
        data: {
          topicName,
          ...(labelIds ? { labelIds } : {}),
          ...(labelFilterBehavior ? { labelFilterBehavior } : {}),
        },
      }),

    stopWatch: () => request("POST", "/stop"),
  };
};

module.exports = {
  BASE_URL,
  MAX_ATTEMPTS,
  RETRYABLE_REASONS,
  GmailApiError,
  describeFailure,
  backoffFor,
  createClient,
};
