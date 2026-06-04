import { aviationstack } from "../config.js";
import { normalizeAircraftCode } from "./pax-estimate.js";

/**
 * Aviationstack timetable → canonical rows (same shape as aviation-edge.js).
 * @see https://docs.apilayer.com/aviationstack/docs/aviationstack-api-v-1-0-0
 */
export function stackTimetableRowToCanonical(row, arrIata) {
  const dep = row.departure || {};
  const arr = row.arrival || {};
  const airline = row.airline || {};
  const flight = row.flight || {};
  const aircraft = row.aircraft || {};

  const arrIataCode = (arr.iataCode || arrIata || "").toUpperCase();
  const depIata = (dep.iataCode || "").toUpperCase();

  const arrScheduled = arr.scheduledTime || "";
  const arrEstimated = arr.estimatedTime || null;
  const arrActual = arr.actualTime || null;

  const modelCode = normalizeAircraftCode(aircraft.icaoCode || aircraft.iataCode || "");
  const modelText = (aircraft.modelText || aircraft.regNumber || "").trim();

  return {
    dep_iata: depIata,
    arr_iata: arrIataCode,
    arr_time: arrScheduled,
    arr_estimated: arrEstimated,
    arr_actual: arrActual,
    airline_iata: (airline.iataCode || "").toUpperCase(),
    flight_iata: flight.iataNumber || "",
    flight_number: flight.number || "",
    aircraft_icao: modelCode,
    aircraft_text: modelText,
    status: row.status || "",
  };
}

export function arrivalDateFromRow(row) {
  const t = row.arrival?.scheduledTime || row.arrival?.estimatedTime || "";
  return String(t).slice(0, 10);
}

export function filterCanonicalByArrivalDate(rows, date) {
  return rows.filter((r) => {
    const day = (r.arr_estimated || r.arr_actual || r.arr_time || "").slice(0, 10);
    return day === date;
  });
}

function apiError(body) {
  if (!body?.error) return null;
  const e = body.error;
  return typeof e === "object" ? e.message || e.code : String(e);
}

/**
 * One timetable page: arrivals for a single airport (paginated).
 * @returns {{ items: object[], pagination: object, raw: object }}
 */
export async function fetchTimetablePage(arrIata, { offset = 0, limit = 100 } = {}) {
  const key = aviationstack.accessKey;
  if (!key) {
    throw new Error(
      "AVIATIONSTACK_ACCESS_KEY is not set. Add it to .env or pass --key.",
    );
  }

  const url = new URL(`${aviationstack.baseUrl}/timetable`);
  url.searchParams.set("access_key", key);
  url.searchParams.set("iataCode", arrIata.toUpperCase());
  url.searchParams.set("type", "arrival");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  const err = apiError(body);

  if (!res.ok) {
    const error = new Error(`Aviationstack HTTP ${res.status}: ${err || res.statusText}`);
    if (res.status === 429 || body?.error?.code === "rate_limit_reached") {
      error.code = "RATE_LIMIT";
    }
    throw error;
  }
  if (err) {
    const error = new Error(`Aviationstack API: ${err}`);
    if (body?.error?.code === "rate_limit_reached") error.code = "RATE_LIMIT";
    throw error;
  }

  const items = Array.isArray(body?.data) ? body.data : [];
  return {
    items,
    pagination: body?.pagination ?? { total: items.length, limit, offset },
    raw: body,
  };
}

/**
 * Fetch all timetable pages for one airport within a request budget slice.
 */
export async function fetchAllTimetableForAirport(arrIata, {
  maxPages = 10,
  pageLimit = 100,
  onPage,
} = {}) {
  const allItems = [];
  const raws = [];
  let offset = 0;
  let total = Infinity;
  let pages = 0;

  while (offset < total && pages < maxPages) {
    const page = await fetchTimetablePage(arrIata, { offset, limit: pageLimit });
    raws.push({ offset, pagination: page.pagination });
    allItems.push(...page.items);
    total = page.pagination?.total ?? allItems.length;
    pages += 1;
    if (onPage) onPage({ arrIata, offset, pages, total, count: page.items.length });
    if (page.items.length === 0) break;
    offset += pageLimit;
    if (offset >= total) break;
  }

  const canonical = allItems.map((row) => stackTimetableRowToCanonical(row, arrIata));
  return { canonical, rawPages: raws, pagesUsed: pages, totalReported: total };
}

export function bucketCanonicalByDate(canonical, targetDates) {
  const dateSet = new Set(targetDates);
  const buckets = new Map();
  for (const d of targetDates) buckets.set(d, []);

  for (const row of canonical) {
    const day = (row.arr_time || "").slice(0, 10);
    if (dateSet.has(day)) buckets.get(day).push(row);
  }
  return buckets;
}

export function coverageNoteFor(date) {
  return `Arrivals for ${date} from Aviationstack timetable (/v1/timetable). Airport country lookups use cached Aviation Edge data when available.`;
}

function replaceIsoDate(iso, targetDate) {
  if (!iso) return iso;
  const t = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) return `${targetDate}T${t.slice(11)}`;
  return t;
}

/** Repeat today's timetable rows on a future calendar date (no extra API calls). */
export function projectCanonicalToDate(rows, targetDate) {
  return rows.map((row) => ({
    ...row,
    arr_time: replaceIsoDate(row.arr_time, targetDate),
    arr_estimated: row.arr_estimated
      ? replaceIsoDate(row.arr_estimated, targetDate)
      : null,
    arr_actual: null,
  }));
}

export function projectedCoverageNote(sourceDate, targetDate) {
  return `Estimated arrivals for ${targetDate} by copying Aviationstack timetable from ${sourceDate} (same times). Upgrade plan or use daily prefetch for dated future timetables.`;
}
