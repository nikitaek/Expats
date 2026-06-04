import { flightradar24 as fr24Config } from "../config.js";

const BASE = "https://fr24api.flightradar24.com/api";

function headers() {
  return {
    Authorization: `Bearer ${fr24Config.apiToken}`,
    Accept: "application/json",
    "Accept-Version": "v1",
  };
}

function bumpFirstSeen(iso) {
  const d = new Date(iso);
  d.setUTCSeconds(d.getUTCSeconds() + 1);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function toUtcRange(dateFrom, dateTo) {
  return {
    flight_datetime_from: `${dateFrom} 00:00:00`,
    flight_datetime_to: `${dateTo} 23:59:59`,
  };
}

/** Split inclusive date range into chunks of maxDays (FR24 limit: 14). */
export function splitDateRange(dateFrom, dateTo, maxDays = 14) {
  const chunks = [];
  const cursor = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  while (cursor <= end) {
    const chunkStart = cursor.toISOString().slice(0, 10);
    const chunkEndDate = new Date(cursor);
    chunkEndDate.setDate(chunkEndDate.getDate() + maxDays - 1);
    if (chunkEndDate > end) chunkEndDate.setTime(end.getTime());
    const chunkEnd = chunkEndDate.toISOString().slice(0, 10);
    chunks.push({ dateFrom: chunkStart, dateTo: chunkEnd });
    cursor.setDate(cursor.getDate() + maxDays);
  }
  return chunks;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchSummaryPage(params, { variant = "full", retries = 4 } = {}) {
  if (!fr24Config.apiToken) {
    throw new Error("FR24_API_TOKEN is not set in .env");
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await sleep(fr24Config.requestDelayMs * (attempt + 1));

    const url = new URL(`${BASE}/flight-summary/${variant}`);
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, { headers: headers() });
    const body = await res.json().catch(() => ({}));

    if (res.status === 429 && attempt < retries) {
      lastErr = new Error(`FR24 API 429: Rate limit exceeded`);
      continue;
    }

    if (!res.ok) {
      const msg = body?.message || body?.error || res.statusText;
      throw new Error(`FR24 API ${res.status}: ${msg}`);
    }
    if (body?.message && !Array.isArray(body?.data)) {
      throw new Error(`FR24 API: ${body.message}`);
    }

    return body.data || [];
  }
  throw lastErr || new Error("FR24 API request failed");
}

/**
 * Paginate flight-summary by advancing flight_datetime_from past last first_seen.
 * Plan may cap at 20 rows per request regardless of limit param.
 */
export async function fetchSummaryPaginated({
  dateFrom,
  dateTo,
  filters = {},
  maxPages = 50,
  variant = "full",
}) {
  const pageSize = fr24Config.pageSize;
  const range = toUtcRange(dateFrom, dateTo);
  let from = range.flight_datetime_from;
  const all = new Map();

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchSummaryPage(
      {
        ...range,
        flight_datetime_from: from,
        ...filters,
        limit: pageSize,
        sort: "asc",
      },
      { variant },
    );

    if (!rows.length) break;

    let added = 0;
    for (const row of rows) {
      if (!row?.fr24_id) continue;
      if (!all.has(row.fr24_id)) {
        all.set(row.fr24_id, row);
        added++;
      }
    }

    const last = rows[rows.length - 1];
    const nextFrom = bumpFirstSeen(last.first_seen);
    if (rows.length < pageSize || added === 0) break;
    if (nextFrom <= from) break;
    from = nextFrom;
  }

  return [...all.values()];
}

export const VIETNAM_ARRIATA = new Set([
  "SGN", "HAN", "CXR", "DAD", "PQC", "VDO", "HPH", "VCA", "HUI", "DLI",
  "BMV", "VII", "THD", "VDH", "PXU",
]);

export const MOSCOW_DEPARTURE_IATA = ["SVO", "DME", "VKO"];

/**
 * Paginated outbound board at origin(s); keep legs whose destination is Vietnam.
 * Uses flight_datetime_from + last first_seen (+1s) pagination (preferred style).
 */
export async function fetchOutboundToVietnam({
  dateFrom,
  dateTo,
  depIataList,
  maxPages = 80,
  variant = "full",
}) {
  const vnRows = [];
  const seen = new Set();

  for (const dep of depIataList) {
    const rows = await fetchSummaryPaginated({
      dateFrom,
      dateTo,
      filters: { airports: `outbound:${dep.toUpperCase()}` },
      maxPages,
      variant,
    });

    for (const row of rows) {
      const dest = (row.dest_iata || row.dest_iata_actual || "").toUpperCase();
      if (!VIETNAM_ARRIATA.has(dest)) continue;
      if (seen.has(row.fr24_id)) continue;
      seen.add(row.fr24_id);
      vnRows.push(row);
    }
  }

  return vnRows;
}

/**
 * Single routes= query (no pagination needed when result count < page cap).
 * Example: routes=SVO-DAD,VVO-DAD,ALA-DAD
 */
export async function fetchRoutesSimple({
  dateFrom,
  dateTo,
  routes,
  variant = "full",
}) {
  return fetchRoutes({ dateFrom, dateTo, routes, variant });
}

/** Up to 15 routes per request (FR24 limit). */
export async function fetchRoutes({
  dateFrom,
  dateTo,
  routes,
  variant = "full",
}) {
  const routeList = [...routes];
  const results = [];

  for (let i = 0; i < routeList.length; i += 15) {
    const batch = routeList.slice(i, i + 15);
    const rows = await fetchSummaryPage(
      {
        ...toUtcRange(dateFrom, dateTo),
        routes: batch.join(","),
        limit: 2000,
        sort: "asc",
      },
      { variant },
    );
    results.push(...rows);
  }

  const byId = new Map();
  for (const row of results) {
    if (row?.fr24_id) byId.set(row.fr24_id, row);
  }
  return [...byId.values()];
}

/** Map FR24 summary row → scheduler-friendly shape. */
export function fr24ToCanonical(row) {
  const landed = row.datetime_landed || "";
  const date = landed.slice(0, 10);
  const eta = landed.includes("T") ? landed.split("T")[1]?.slice(0, 5) : "";

  return {
    source: "flightradar24",
    fr24_id: row.fr24_id,
    date,
    eta,
    dep_iata: (row.orig_iata || "").toUpperCase(),
    arr_iata: (row.dest_iata || row.dest_iata_actual || "").toUpperCase(),
    arr_time: landed,
    airline_iata: (row.operated_as || row.painted_as || "").toUpperCase(),
    flight_iata: (row.flight || row.callsign || "").toLowerCase(),
    flight_number: row.flight || "",
    callsign: row.callsign || "",
    aircraft_icao: (row.type || "").toUpperCase(),
    aircraft_text: row.category || "",
    reg: row.reg || "",
    status: row.flight_ended === "true" || row.flight_ended === true ? "landed" : "unknown",
    datetime_takeoff: row.datetime_takeoff || null,
    datetime_landed: landed,
    first_seen: row.first_seen || null,
    category: row.category || null,
  };
}
