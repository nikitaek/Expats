/** Format Date as YYYY-MM-DD in a given IANA timezone. */
export function formatDateInTz(date, timeZone = "Asia/Ho_Chi_Minh") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n, timeZone = "Asia/Ho_Chi_Minh") {
  const today = formatDateInTz(new Date(), timeZone);
  return addDays(today, -n);
}

export function daysAhead(n, timeZone = "Asia/Ho_Chi_Minh") {
  const today = formatDateInTz(new Date(), timeZone);
  return addDays(today, n);
}

/**
 * Today in UTC (YYYY-MM-DD). FR24 flight-summary validates `flight_datetime_from`
 * against UTC: it "must be a date before tomorrow", i.e. <= today UTC.
 */
export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * FR24 flight-summary only accepts a `date_from` that is today (UTC) or earlier.
 * Returns true when this window can be requested.
 */
export function isFetchableStart(dateFrom, today = todayUTC()) {
  return dateFrom <= today;
}

/** Earliest date allowed by FR24 subscription (YYYY-MM-DD). Override via FR24_DATA_FROM. */
export function fr24PlanDataFrom() {
  return process.env.FR24_DATA_FROM || "2026-05-07";
}

/** Clamp requested start to subscription minimum. */
export function clampDateFrom(requested, planMin = fr24PlanDataFrom()) {
  return requested < planMin ? planMin : requested;
}

export function isWithinPlanRange(dateFrom, planMin = fr24PlanDataFrom()) {
  return dateFrom >= planMin;
}
