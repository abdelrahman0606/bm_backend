const ApiError = require("../../utils/apiError");

/**
 * The Gmail OAuth scopes this feature asks for, and nothing else.
 *
 * Gmail scopes are *restricted* in Google's terms: every one of them beyond
 * `gmail.metadata` requires app verification and, for a production app, an
 * annual CASA security assessment. That is a reason to ask for the narrowest
 * set that does the job, not a reason to ask for `mail.google.com` and be
 * done — a review is failed on exactly that.
 *
 * So access is offered as three levels, each a named bundle of scopes:
 *
 *   readOnly — read messages, threads, labels and attachments. Nothing in
 *              the mailbox can change.
 *   modify   — read, plus organize (labels, read/unread, star, archive,
 *              trash) and send. This is the level the full feature needs and
 *              the default. It cannot delete permanently.
 *   full     — `mail.google.com`: everything, including permanent deletion
 *              and IMAP/SMTP. Asked for only when the user wants permanent
 *              deletion, because it is the hardest level to justify in
 *              review and the most damaging to hold.
 *
 * `gmail.modify` deliberately does not include permanent deletion: Google
 * splits that off so an app that organizes mail cannot destroy it. We keep
 * that split rather than papering over it, which is why "delete forever" is
 * a documented capability of one level and refused at the others.
 */

const SCOPE = Object.freeze({
  READONLY: "https://www.googleapis.com/auth/gmail.readonly",
  MODIFY: "https://www.googleapis.com/auth/gmail.modify",
  SEND: "https://www.googleapis.com/auth/gmail.send",
  LABELS: "https://www.googleapis.com/auth/gmail.labels",
  METADATA: "https://www.googleapis.com/auth/gmail.metadata",
  FULL: "https://mail.google.com/",
  /**
   * Contacts, read only. Optional and asked for separately: recipient
   * suggestions work from the mailbox's own history without it, so it is not
   * worth widening the review surface by default.
   */
  CONTACTS_READONLY: "https://www.googleapis.com/auth/contacts.readonly",
  CONTACTS_OTHER_READONLY:
    "https://www.googleapis.com/auth/contacts.other.readonly",
});

const ACCESS_LEVELS = ["readOnly", "modify", "full"];

/**
 * The scopes each level requests.
 *
 * `gmail.modify` already covers sending and label management, so `gmail.send`
 * and `gmail.labels` are not requested alongside it — a redundant scope on a
 * restricted consent screen is a question to answer in review for no gain.
 */
const SCOPES_BY_LEVEL = Object.freeze({
  readOnly: [SCOPE.READONLY],
  modify: [SCOPE.MODIFY],
  full: [SCOPE.FULL],
});

/** What each level is allowed to do, checked before any Gmail call. */
const CAPABILITIES = Object.freeze({
  readOnly: Object.freeze({
    read: true,
    send: false,
    organize: false,
    manageLabels: false,
    trash: false,
    deleteForever: false,
  }),
  modify: Object.freeze({
    read: true,
    send: true,
    organize: true,
    manageLabels: true,
    trash: true,
    deleteForever: false,
  }),
  full: Object.freeze({
    read: true,
    send: true,
    organize: true,
    manageLabels: true,
    trash: true,
    deleteForever: true,
  }),
});

const LEVEL_TITLES = Object.freeze({
  readOnly: "Read only",
  modify: "Read, organize and send",
  full: "Full access, including permanent deletion",
});

const scopesForLevel = (accessLevel) => {
  const scopes = SCOPES_BY_LEVEL[accessLevel];
  if (!scopes) {
    throw new ApiError(
      `Unknown Gmail access level "${accessLevel}". Expected one of: ` +
        `${ACCESS_LEVELS.join(", ")}`,
      400,
    );
  }
  return [...scopes];
};

/**
 * Recovers the level from the scopes Google actually granted.
 *
 * The granted set is the only honest source: a user can untick a permission
 * on the consent screen, and a stored level taken from the *request* would
 * then claim access the account does not have. Read from widest to narrowest
 * so a grant carrying several scopes lands on the one that really applies.
 */
const levelFromScopes = (scopes = []) => {
  const granted = new Set(scopes);
  if (granted.has(SCOPE.FULL)) return "full";
  if (granted.has(SCOPE.MODIFY)) return "modify";
  if (granted.has(SCOPE.READONLY) || granted.has(SCOPE.METADATA)) {
    return "readOnly";
  }
  // A grant carrying only `gmail.send` can send and nothing else. There is no
  // level for that, and calling it "readOnly" would promise reads it cannot
  // do, so it is reported as unusable and the account is marked for re-login.
  return null;
};

/** Plain-language verbs, so the refusal reads as a sentence. */
const CAPABILITY_VERBS = Object.freeze({
  read: "read mail",
  send: "send mail",
  organize: "organize mail",
  manageLabels: "manage labels",
  trash: "move mail to the trash",
  deleteForever: "delete mail permanently",
});

const capabilitiesOf = (accessLevel) =>
  CAPABILITIES[accessLevel] || CAPABILITIES.readOnly;

/**
 * Throws unless the account's level permits `capability`.
 *
 * Called at the top of every write path. The point is that the refusal
 * happens here, with a message naming the level the user would need, rather
 * than as an opaque 403 from Google halfway through an operation.
 */
const assertCan = (account, capability) => {
  const level = account?.accessLevel || "readOnly";
  if (capabilitiesOf(level)[capability]) return true;

  const needed = ACCESS_LEVELS.find(
    (candidate) => CAPABILITIES[candidate][capability],
  );
  throw new ApiError(
    `${account?.email || "This account"} is connected with "${
      LEVEL_TITLES[level] || level
    }" access, which cannot ${CAPABILITY_VERBS[capability] || capability}. ` +
      `Reconnect it with "${LEVEL_TITLES[needed] || needed}" access.`,
    403,
  );
};

/** True when the grant lets us read contacts from the People API. */
const hasContactsScope = (scopes = []) =>
  scopes.includes(SCOPE.CONTACTS_READONLY) ||
  scopes.includes(SCOPE.CONTACTS_OTHER_READONLY);

module.exports = {
  SCOPE,
  ACCESS_LEVELS,
  SCOPES_BY_LEVEL,
  CAPABILITIES,
  CAPABILITY_VERBS,
  LEVEL_TITLES,
  scopesForLevel,
  levelFromScopes,
  capabilitiesOf,
  assertCan,
  hasContactsScope,
};
