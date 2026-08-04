const EVENT_TYPES = Object.freeze({
  NOTIFICATION: "notification",
  CALL: "call",
  TYPING: "typing",
  USER: "user",
  /** Emitted by the Telegram Updates Service for any inbound Telegram update. */
  TELEGRAM_UPDATE: "telegram:update",
});

module.exports = { EVENT_TYPES };
