import path from "node:path";
import { aviationEdge, paths } from "../config.js";
import { readJson, writeJson } from "../lib/fs-json.js";
import { normalizeAircraftCode } from "./pax-estimate.js";

function airportCachePath(iata) {
  return path.join(paths.airportCache, `${iata.toUpperCase()}.json`);
}

function timetableSnapshotPath(arrIata) {
  return path.join(paths.timetableCache, `${arrIata.toUpperCase()}.json`);
}

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysFromToday(dateStr) {
  const a = new Date(`${dateStr}T12:00:00`);
  const b = new Date(`${todayIso()}T12:00:00`);
  return Math.round((a - b) / 86_400_000);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Latest calendar date accepted by flightsHistory (inclusive). */
export function latestHistoryDateIso() {
  return addDays(todayIso(), -aviationEdge.historyMinDaysBehind);
}

/** True when flightsHistory can be queried for this date. */
export function isHistoryApiDate(dateStr) {
  return daysFromToday(dateStr) <= -aviationEdge.historyMinDaysBehind;
}

/**
 * Which Aviation Edge schedules product to use.
 * @see https://aviation-edge.com/developers/
 * - history: past dates
 * - timetable: today through +7 days (live board window; filter by arrival date)
 * - future: +8 days and beyond (full-day algorithmic timetable)
 */
export function scheduleModeForDate(dateStr) {
  const offset = daysFromToday(dateStr);
  if (offset <= -aviationEdge.historyMinDaysBehind) return "history";
  if (offset >= aviationEdge.futureMinDaysAhead) return "future";
  return "timetable";
}

export function scheduleCoverageNote(dateStr) {
  const offset = daysFromToday(dateStr);
  if (offset <= -aviationEdge.historyMinDaysBehind) {
    return "Historical schedules (flightsHistory) for past dates.";
  }
  if (offset < 0) {
    return `Date is within ${aviationEdge.historyMinDaysBehind} days — flightsHistory not available yet; using live timetable (partial day).`;
  }
  if (offset === 0) {
    return "Real-time timetable (~±6 hours). Full 24h coverage is not available.";
  }
  if (offset > 0 && offset < aviationEdge.futureMinDaysAhead) {
    return `Real-time timetable filtered to ${dateStr}. Only flights in the current live window appear; full-day data starts ${aviationEdge.futureMinDaysAhead}+ days ahead (flightsFuture).`;
  }
  return `Full-day future schedule (flightsFuture) for ${dateStr}.`;
}

function apiUrl(pathname, params) {
  const url = new URL(`${aviationEdge.baseUrl}/${pathname}`);
  url.searchParams.set("key", aviationEdge.apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  return url;
}

function errorMessageFromBody(body) {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body)) return null;
  if (body.success === false && body.error) return String(body.error);
  if (body.error) return String(body.error);
  return null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  const apiError = errorMessageFromBody(body);

  if (!res.ok) {
    throw new Error(
      `Aviation Edge API error (${res.status}): ${apiError || res.statusText}`,
    );
  }

  if (apiError) {
    throw new Error(`Aviation Edge API error: ${apiError}`);
  }

  return body;
}

function combineDateAndTime(dateStr, timeValue) {
  if (!timeValue) return "";
  const t = String(timeValue).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t;
  const hm = t.match(/^(\d{1,2}):(\d{2})/);
  if (hm && dateStr) {
    return `${dateStr}T${hm[1].padStart(2, "0")}:${hm[2]}:00.000`;
  }
  return t;
}

/** Map Aviation Edge schedule row → internal shape used by normalize.js */
export function toCanonicalRow(row, selectedDate, arrIata) {
  const dep = row.departure || {};
  const arr = row.arrival || {};
  const airline = row.airline || {};
  const flight = row.flight || {};
  const aircraft = row.aircraft || {};

  const arrIataCode = (arr.iataCode || arrIata || "").toUpperCase();
  const depIata = (dep.iataCode || "").toUpperCase();

  const arrScheduled = combineDateAndTime(selectedDate, arr.scheduledTime);
  const arrEstimated = combineDateAndTime(selectedDate, arr.estimatedTime);
  const arrActual = combineDateAndTime(selectedDate, arr.actualTime);

  const modelCode = normalizeAircraftCode(aircraft.modelCode);
  const modelText = (aircraft.modelText || "").trim();

  return {
    dep_iata: depIata,
    arr_iata: arrIataCode,
    arr_time: arrScheduled,
    arr_estimated: arrEstimated || null,
    arr_actual: arrActual || null,
    airline_iata: (airline.iataCode || "").toUpperCase(),
    flight_iata: flight.iataNumber || "",
    flight_number: flight.number || "",
    aircraft_icao: modelCode,
    aircraft_text: modelText,
    status: row.status || "",
  };
}

function parseResponseArray(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.response)) return body.response;
  return [];
}

function filterRowsByArrivalDate(rows, date) {
  return rows.filter((r) => {
    const day = (r.arr_estimated || r.arr_actual || r.arr_time || "").slice(0, 10);
    return day === date;
  });
}

function rowsFromItems(items, date, arrIata) {
  const rows = items.map((row) => toCanonicalRow(row, date, arrIata));
  return filterRowsByArrivalDate(rows, date);
}

async function fetchTimetableFromApi(arrIata) {
  const url = apiUrl("timetable", {
    iataCode: arrIata.toUpperCase(),
    type: "arrival",
    codeshared: "null",
  });
  return fetchJson(url);
}

/**
 * One timetable API call per airport, reused for today/tomorrow/etc. within TTL.
 */
async function getTimetableItems(arrIata, { forceRefresh = false } = {}) {
  const file = timetableSnapshotPath(arrIata);
  if (!forceRefresh) {
    try {
      const snap = await readJson(file);
      const age = Date.now() - new Date(snap.fetchedAt).getTime();
      if (age < aviationEdge.timetableSnapshotTtlMs && Array.isArray(snap.items)) {
        return { items: snap.items, fromSnapshot: true, fetchedAt: snap.fetchedAt };
      }
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  const raw = await fetchTimetableFromApi(arrIata);
  const items = parseResponseArray(raw);
  if (items.length === 0) {
    return { items: [], fromSnapshot: false, fetchedAt: new Date().toISOString() };
  }

  const fetchedAt = new Date().toISOString();
  await writeJson(file, { fetchedAt, arrIata: arrIata.toUpperCase(), items, raw });
  return { items, fromSnapshot: false, fetchedAt };
}

async function fetchHistory(date, arrIata) {
  const url = apiUrl("flightsHistory", {
    code: arrIata.toUpperCase(),
    type: "arrival",
    date_from: date,
    date_to: date,
  });
  return fetchJson(url);
}

async function fetchFuture(date, arrIata) {
  const url = apiUrl("flightsFuture", {
    iataCode: arrIata.toUpperCase(),
    type: "arrival",
    date,
  });
  return fetchJson(url);
}

/**
 * Load incoming arrivals for a Vietnamese airport on a calendar date.
 * @returns {{ mode: string, rows: object[], raw: unknown, coverageNote: string, timetableFromSnapshot?: boolean }}
 */
export async function fetchIncomingSchedules(date, arrIata) {
  if (!aviationEdge.apiKey) {
    throw new Error(
      "AVIATION_EDGE_API_KEY is not set. Copy .env.example to .env and add your key.",
    );
  }

  const mode = scheduleModeForDate(date);
  const coverageNote = scheduleCoverageNote(date);
  let raw;
  let rows = [];
  let timetableFromSnapshot;

  if (mode === "history") {
    raw = await fetchHistory(date, arrIata);
    rows = rowsFromItems(parseResponseArray(raw), date, arrIata);
  } else if (mode === "future") {
    try {
      raw = await fetchFuture(date, arrIata);
    } catch (err) {
      if (/no record found/i.test(err.message)) {
        return { mode, rows: [], raw: [], coverageNote, timetableFromSnapshot: false };
      }
      throw err;
    }
    rows = parseResponseArray(raw).map((row) => toCanonicalRow(row, date, arrIata));
  } else {
    const { items, fromSnapshot, fetchedAt } = await getTimetableItems(arrIata);
    timetableFromSnapshot = fromSnapshot;
    raw = { snapshot: true, fetchedAt, itemCount: items.length };
    rows = rowsFromItems(items, date, arrIata);
  }

  return {
    mode,
    rows,
    raw,
    coverageNote,
    timetableFromSnapshot,
  };
}

/** Aviation Edge does not support multiple IATA codes in one timetable request (verified). */
export const multiAirportPerRequestSupported = false;

export async function resolveDepartureAirport(depIata) {
  const code = depIata?.toUpperCase();
  if (!code) return null;

  try {
    return await readJson(airportCachePath(code));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  if (!aviationEdge.apiKey) {
    return { iata_code: code, city: code, country_code: null, name: code };
  }

  const url = apiUrl("airportDatabase", { codeIataAirport: code });
  let airport;
  try {
    const data = await fetchJson(url);
    airport = Array.isArray(data) ? data[0] : data;
  } catch (err) {
    // Unknown or unsupported IATA — do not fail the whole schedule load.
    const record = {
      iata_code: code,
      city: code,
      country_code: null,
      name: code,
      lookupError: err.message,
    };
    await writeJson(airportCachePath(code), record);
    return record;
  }

  const record = airport
    ? {
        iata_code: airport.codeIataAirport || code,
        icao_code: airport.codeIcaoAirport || null,
        city: airport.codeIataCity || airport.nameAirport || code,
        country_code: airport.codeIso2Country || null,
        name: airport.nameAirport || code,
      }
    : { iata_code: code, city: code, country_code: null, name: code };

  await writeJson(airportCachePath(code), record);
  return record;
}
