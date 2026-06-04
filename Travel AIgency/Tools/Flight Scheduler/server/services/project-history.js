import { aviationEdge } from "../config.js";
import {
  daysFromToday,
  fetchIncomingSchedules,
  scheduleModeForDate,
} from "./aviation-edge.js";

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Calendar dates strictly after today and before flightsFuture minimum. */
export function isNearTermGapDate(dateStr) {
  const offset = daysFromToday(dateStr);
  return offset > 0 && offset < aviationEdge.futureMinDaysAhead;
}

export { daysFromToday };

function replaceIsoDate(iso, targetDate) {
  if (!iso) return iso;
  const t = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    return `${targetDate}T${t.slice(11)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    return `${targetDate}${t.slice(10)}`;
  }
  return t;
}

/** Copy canonical rows from a historical day onto a target calendar date. */
export function shiftCanonicalRows(rows, targetDate) {
  return rows.map((row) => ({
    ...row,
    arr_time: replaceIsoDate(row.arr_time, targetDate),
    arr_estimated: row.arr_estimated
      ? replaceIsoDate(row.arr_estimated, targetDate)
      : null,
    arr_actual: null,
  }));
}

/**
 * Pick past source dates (same weekday) to pull flightsHistory from.
 * @param {string} targetDate
 * @param {number[]} weekOffsets — multiples of 7 days back
 */
export function historicalSourceDates(targetDate, weekOffsets = [7, 14, 21, 28]) {
  return weekOffsets
    .map((w) => addDays(targetDate, -w))
    .filter((d) => scheduleModeForDate(d) === "history");
}

export function projectionCoverageNote(targetDate, sourceDate) {
  return `Estimated schedule for ${targetDate} from historical arrivals on ${sourceDate} (same weekday). Not live data — run prefetch while dates are ${aviationEdge.futureMinDaysAhead}+ days out for full-day API timetables.`;
}

/**
 * Load historical arrivals for one source day and remap onto targetDate.
 */
export async function fetchProjectedRows(targetDate, arrIata, weekOffsets) {
  const sources = historicalSourceDates(targetDate, weekOffsets);
  let lastError;

  for (const sourceDate of sources) {
    try {
      const { rows } = await fetchIncomingSchedules(sourceDate, arrIata);
      if (rows.length === 0) continue;
      return {
        sourceDate,
        rows: shiftCanonicalRows(rows, targetDate),
      };
    } catch (err) {
      lastError = err;
    }
  }

  const err = new Error(
    `Could not project ${arrIata} on ${targetDate} from history (${sources.join(", ") || "no past dates"}). ${lastError?.message || ""}`.trim(),
  );
  err.code = "NO_PROJECTION_DATA";
  err.details = { targetDate, arrIata, sourcesTried: sources };
  throw err;
}
