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
});

module.exports = { EVENT_TYPES };
