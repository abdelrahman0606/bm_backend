const ApiError = require("../../utils/apiError");

const SCHEDULE_TYPES = ["hourly", "daily", "weekly", "monthly"];
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Smallest interval an hourly schedule may use, to keep delivery volume sane. */
const MIN_HOURLY_INTERVAL_MINUTES = 15;

/**
 * Validates and normalises a schedule coming from a client.
 * Returns a plain object matching the `schedule` sub-schema.
 */
function normalizeSchedule(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError("schedule must be an object", 400);
  }

  const type = raw.type || "daily";
  if (!SCHEDULE_TYPES.includes(type)) {
    throw new ApiError(
      `schedule.type must be one of ${SCHEDULE_TYPES.join(", ")}`,
      400
    );
  }

  const toInt = (value, fallback) => {
    if (value === undefined || value === null || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new ApiError("schedule values must be numbers", 400);
    }
    return Math.trunc(parsed);
  };

  const hour = toInt(raw.hour, 0);
  const minute = toInt(raw.minute, 0);
  const dayOfWeek = toInt(raw.dayOfWeek, 1);
  const dayOfMonth = toInt(raw.dayOfMonth, 1);
  const timezoneOffsetMinutes = toInt(raw.timezoneOffsetMinutes, 0);

  if (hour < 0 || hour > 23) {
    throw new ApiError("schedule.hour must be between 0 and 23", 400);
  }
  if (minute < 0 || minute > 59) {
    throw new ApiError("schedule.minute must be between 0 and 59", 400);
  }
  if (dayOfWeek < 1 || dayOfWeek > 7) {
    throw new ApiError("schedule.dayOfWeek must be between 1 and 7", 400);
  }
  if (dayOfMonth < 1 || dayOfMonth > 31) {
    throw new ApiError("schedule.dayOfMonth must be between 1 and 31", 400);
  }
  if (timezoneOffsetMinutes < -840 || timezoneOffsetMinutes > 840) {
    throw new ApiError(
      "schedule.timezoneOffsetMinutes must be between -840 and 840",
      400
    );
  }

  if (type === "hourly") {
    const interval = hour * 60 + minute;
    if (interval < MIN_HOURLY_INTERVAL_MINUTES) {
      throw new ApiError(
        `hourly schedules must repeat at least every ${MIN_HOURLY_INTERVAL_MINUTES} minutes`,
        400
      );
    }
  }

  return {
    type,
    hour,
    minute,
    dayOfWeek,
    dayOfMonth,
    timezoneOffsetMinutes,
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
  };
}

/** `dayOfWeek` uses the client week order: 1 = Saturday … 7 = Friday. */
function clientDayToJsDay(dayOfWeek) {
  // JS: 0 = Sunday … 6 = Saturday
  const map = { 1: 6, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5 };
  return map[dayOfWeek] === undefined ? 6 : map[dayOfWeek];
}

/**
 * Next UTC instant the schedule should fire at, strictly after [from].
 *
 * Local-time schedules (daily/weekly/monthly) are resolved by shifting into the
 * owner's local clock, placing the wall-clock time, then shifting back to UTC.
 */
function computeNextRunAt(schedule, from = new Date()) {
  if (!schedule || schedule.enabled === false) return null;

  const type = schedule.type || "daily";
  const offsetMs = (schedule.timezoneOffsetMinutes || 0) * MINUTE_MS;
  const fromMs = from.getTime();

  if (type === "hourly") {
    const intervalMinutes = Math.max(
      MIN_HOURLY_INTERVAL_MINUTES,
      (schedule.hour || 0) * 60 + (schedule.minute || 0)
    );
    return new Date(fromMs + intervalMinutes * MINUTE_MS);
  }

  // Work in "local" milliseconds so date arithmetic matches the user's clock.
  const local = new Date(fromMs + offsetMs);
  const hour = schedule.hour || 0;
  const minute = schedule.minute || 0;

  const localAt = (year, month, day) =>
    Date.UTC(year, month, day, hour, minute, 0, 0);

  if (type === "daily") {
    let candidate = localAt(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate()
    );
    if (candidate <= local.getTime()) candidate += DAY_MS;
    return new Date(candidate - offsetMs);
  }

  if (type === "weekly") {
    const targetJsDay = clientDayToJsDay(schedule.dayOfWeek || 1);
    let candidate = localAt(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate()
    );
    let dayDiff = (targetJsDay - local.getUTCDay() + 7) % 7;
    candidate += dayDiff * DAY_MS;
    if (candidate <= local.getTime()) candidate += 7 * DAY_MS;
    return new Date(candidate - offsetMs);
  }

  // monthly
  const targetDay = schedule.dayOfMonth || 1;
  let year = local.getUTCFullYear();
  let month = local.getUTCMonth();
  const clampDay = (y, m, d) =>
    Math.min(d, new Date(Date.UTC(y, m + 1, 0)).getUTCDate());

  let candidate = localAt(year, month, clampDay(year, month, targetDay));
  if (candidate <= local.getTime()) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    candidate = localAt(year, month, clampDay(year, month, targetDay));
  }
  return new Date(candidate - offsetMs);
}

/**
 * Stable identifier of one scheduled occurrence. Two scheduler runs for the
 * same occurrence produce the same key, which the unique index on
 * (shareId, occurrenceKey) turns into a single delivery.
 */
function occurrenceKeyFor(date) {
  return new Date(date).toISOString();
}

/**
 * Local calendar date (YYYY-MM-DD) of an instant for the given offset. Used to
 * pick the usage rows a delivery covers, since usage is stored per local day.
 */
function localDateString(instant, timezoneOffsetMinutes = 0) {
  const shifted = new Date(
    new Date(instant).getTime() + (timezoneOffsetMinutes || 0) * MINUTE_MS
  );
  const y = shifted.getUTCFullYear();
  const m = `${shifted.getUTCMonth() + 1}`.padStart(2, "0");
  const d = `${shifted.getUTCDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

module.exports = {
  SCHEDULE_TYPES,
  MIN_HOURLY_INTERVAL_MINUTES,
  normalizeSchedule,
  computeNextRunAt,
  occurrenceKeyFor,
  localDateString,
  clientDayToJsDay,
};
