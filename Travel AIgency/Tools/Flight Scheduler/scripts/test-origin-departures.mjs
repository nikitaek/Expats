#!/usr/bin/env node
/**
 * Test Aviation Edge from CIS departure airports — do Vietnam-bound flights
 * appear on departure timetables / flightsHistory when missing from DAD arrivals?
 */
import "dotenv/config";
import { aviationEdge } from "../server/config.js";
import { toCanonicalRow } from "../server/services/aviation-edge.js";

const VN_IATA = new Set([
  "SGN", "HAN", "CXR", "DAD", "PQC", "VDO", "HPH", "VCA", "HUI", "DLI",
  "BMV", "VII", "THD", "VDH", "PXU",
]);

const ORIGINS = [
  { iata: "SVO", label: "Moscow Sheremetyevo" },
  { iata: "DME", label: "Moscow Domodedovo" },
  { iata: "VKO", label: "Moscow Vnukovo" },
  { iata: "VVO", label: "Vladivostok" },
  { iata: "OVB", label: "Novosibirsk" },
  { iata: "KJA", label: "Krasnoyarsk" },
  { iata: "KZN", label: "Kazan" },
  { iata: "KHV", label: "Khabarovsk" },
  { iata: "ALA", label: "Almaty" },
  { iata: "NQZ", label: "Astana" },
  { iata: "TAS", label: "Tashkent" },
  { iata: "MSQ", label: "Minsk" },
  { iata: "BAX", label: "Barnaul" },
  { iata: "NOZ", label: "Novokuznetsk" },
  { iata: "BQS", label: "Blagoveshchensk" },
];

const DATES = ["2026-05-20", "2026-05-23", "2026-05-25", "2026-05-27"];
const VN_DEST_FOCUS = ["DAD", "SGN", "HAN", "CXR", "PQC"];

function apiUrl(pathname, params) {
  const url = new URL(`${aviationEdge.baseUrl}/${pathname}`);
  url.searchParams.set("key", aviationEdge.apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  return url.toString();
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error || res.statusText;
    throw new Error(`${res.status}: ${err}`);
  }
  if (body?.success === false && body?.error) throw new Error(body.error);
  if (body?.error && !Array.isArray(body)) throw new Error(String(body.error));
  return body;
}

function parseArray(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.response)) return body.response;
  return [];
}

function dayFromRow(row, leg) {
  const block = leg === "dep" ? row.departure : row.arrival;
  const t =
    block?.actualTime ||
    block?.estimatedTime ||
    block?.scheduledTime ||
    "";
  const s = String(t);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/i);
  if (m) return m[1];
  return "";
}

function summarizeRow(raw, date) {
  const c = toCanonicalRow(raw, date, raw.arrival?.iataCode || "");
  const depDay = dayFromRow(raw, "dep");
  const arrDay = dayFromRow(raw, "arr");
  return {
    dep: c.dep_iata,
    arr: c.arr_iata,
    airline: c.airline_iata,
    flight: c.flight_iata || `${c.airline_iata}${c.flight_number}`,
    status: c.status,
    depDay,
    arrDay,
  };
}

async function fetchHistoryDeparture(date, depIata, arrFilter) {
  const params = {
    code: depIata,
    type: "departure",
    date_from: date,
    date_to: date,
  };
  if (arrFilter) params.arr_iataCode = arrFilter;
  const url = apiUrl("flightsHistory", params);
  const raw = await fetchJson(url);
  return { url, items: parseArray(raw), raw };
}

async function fetchTimetableDeparture(depIata) {
  const url = apiUrl("timetable", {
    iataCode: depIata,
    type: "departure",
    codeshared: "null",
  });
  const raw = await fetchJson(url);
  return { url, items: parseArray(raw) };
}

function filterToVietnam(items, date) {
  const hits = [];
  for (const row of items) {
    const arr = (row.arrival?.iataCode || "").toUpperCase();
    if (!VN_IATA.has(arr)) continue;
    const depDay = dayFromRow(row, "dep");
    const arrDay = dayFromRow(row, "arr");
    // departure board: match if dep or arr falls on requested date
    if (depDay !== date && arrDay !== date) continue;
    hits.push(summarizeRow(row, date));
  }
  return hits;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!aviationEdge.apiKey) {
    console.error("AVIATION_EDGE_API_KEY missing in .env");
    process.exit(1);
  }

  console.log("=== Aviation Edge: CIS departures → Vietnam ===\n");
  console.log("Dates:", DATES.join(", "));
  console.log("VN airports:", [...VN_IATA].join(", "));
  console.log("");

  const allVnHits = [];
  const dadHits = [];

  for (const date of DATES) {
    console.log(`\n######## ${date} ########\n`);

    for (const origin of ORIGINS) {
      await sleep(350);
      let total = 0;
      let vn = [];
      try {
        const { items } = await fetchHistoryDeparture(date, origin.iata);
        total = items.length;
        vn = filterToVietnam(items, date);
      } catch (err) {
        console.log(`  ${origin.iata} HISTORY departures: ERROR ${err.message}`);
        continue;
      }

      if (vn.length > 0) {
        console.log(`  ${origin.iata} (${origin.label}): ${total} departures, ${vn.length} to Vietnam:`);
        for (const h of vn) {
          console.log(
            `    → ${h.arr}  ${h.flight}  ${h.airline}  status=${h.status}  depDay=${h.depDay} arrDay=${h.arrDay}`,
          );
          allVnHits.push({ date, origin: origin.iata, ...h });
          if (h.arr === "DAD") dadHits.push({ date, origin: origin.iata, ...h });
        }
      } else if (total > 0) {
        console.log(`  ${origin.iata}: ${total} departures, 0 to Vietnam`);
      } else {
        console.log(`  ${origin.iata}: 0 departures in history`);
      }
    }
  }

  // Targeted: departure + arr_iataCode=DAD filter (API-side)
  console.log("\n\n=== API filter: departure + arr_iataCode=DAD ===\n");
  for (const origin of ["SVO", "VVO", "DME", "ALA", "NQZ", "TAS"]) {
    for (const date of ["2026-05-23", "2026-05-25"]) {
      await sleep(350);
      try {
        const { items } = await fetchHistoryDeparture(date, origin, "DAD");
        const vn = filterToVietnam(items, date).filter((h) => h.arr === "DAD");
        console.log(
          `  ${date} ${origin}→DAD (filtered): ${items.length} raw, ${vn.length} on date`,
        );
        for (const h of vn) {
          console.log(`    ${h.flight} ${h.airline} status=${h.status}`);
        }
      } catch (err) {
        console.log(`  ${date} ${origin}→DAD: ERROR ${err.message}`);
      }
    }
  }

  // Live timetable departures (current window only)
  console.log("\n\n=== Live timetable: type=departure (current board window) ===\n");
  for (const origin of ["SVO", "VVO", "DME", "ALA", "TAS"]) {
    await sleep(400);
    try {
      const { items } = await fetchTimetableDeparture(origin.iata);
      const vn = items
        .map((row) => summarizeRow(row, ""))
        .filter((h) => VN_IATA.has(h.arr));
      console.log(`  ${origin.iata}: ${items.length} board rows, ${vn.length} with VN destination`);
      for (const h of vn.slice(0, 8)) {
        console.log(`    → ${h.arr} ${h.flight} depDay=${h.depDay} arrDay=${h.arrDay}`);
      }
    } catch (err) {
      console.log(`  ${origin.iata} timetable: ERROR ${err.message}`);
    }
  }

  // Compare: DAD arrival side same dates
  console.log("\n\n=== Control: DAD arrivals (existing approach) ===\n");
  for (const date of DATES) {
    await sleep(350);
    try {
      const url = apiUrl("flightsHistory", {
        code: "DAD",
        type: "arrival",
        date_from: date,
        date_to: date,
      });
      const items = parseArray(await fetchJson(url));
      const cisOrigins = new Set(ORIGINS.map((o) => o.iata));
      const fromCis = items.filter((r) =>
        cisOrigins.has((r.departure?.iataCode || "").toUpperCase()),
      );
      console.log(
        `  ${date} DAD arrivals: ${items.length} total, ${fromCis.length} from CIS origin list`,
      );
      for (const r of fromCis.slice(0, 5)) {
        const h = summarizeRow(r, date);
        console.log(`    from ${h.dep} ${h.flight}`);
      }
    } catch (err) {
      console.log(`  ${date} DAD: ERROR ${err.message}`);
    }
  }

  console.log("\n\n=== SUMMARY ===");
  console.log(`Total CIS-departure → Vietnam hits (all dates/origins): ${allVnHits.length}`);
  console.log(`Total CIS-departure → DAD hits: ${dadHits.length}`);
  if (allVnHits.length) {
    const byDest = {};
    for (const h of allVnHits) {
      byDest[h.arr] = (byDest[h.arr] || 0) + 1;
    }
    console.log("By VN destination:", byDest);
    console.log("\nAll hits:");
    for (const h of allVnHits) {
      console.log(`  ${h.date} ${h.origin}→${h.arr} ${h.flight} (${h.airline})`);
    }
  } else {
    console.log("No Vietnam-bound flights found on CIS departure history boards.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
