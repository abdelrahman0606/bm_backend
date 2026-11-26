const EVENT_TYPES = Object.freeze({
  NOTIFICATION: "notification",
  CALL: "call",
  TYPING: "typing",
  USER: "user",
  /** Emitted by the Telegram Updates Service for any inbound Telegram update. */
  TELEGRAM_UPDATE: "telegram:update",
  /**
   * Device Policy Management.
   *
   * One type for the whole feature, with the change named in the event's
   * `action` (`device.enrolled`, `policy.assigned`, `request.approved`…).
   * The client registers one handler for the type and routes on the action,
   * which is also how the audit actions are named — so the live feed and the
   * audit trail use one vocabulary rather than two.
   */
  DEVICE_CONTROL: "device-control",
  /**
   * Gmail.
   *
   * One type for the feature, with the change named in the event's `action`
   * (`message.received`, `message.sent`, `sync.completed`...), the same shape
   * Device Control uses: a client registers one handler and routes on the
   * action, and the action vocabulary is also what the Gmail operation log
   * records, so the live feed and the audit trail read alike.
   */
  GMAIL: "gmail",
});

module.exports = { EVENT_TYPES };
