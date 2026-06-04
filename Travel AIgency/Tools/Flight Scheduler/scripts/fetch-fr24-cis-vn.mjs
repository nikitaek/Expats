#!/usr/bin/env node
/**
 * Fetch CIS → Vietnam via Flightradar24.
 *
 * Primary: outbound departure boards + flight_datetime_from / first_seen pagination.
 * Supplement: explicit routes= (e.g. SVO-DAD,VVO-DAD,ALA-DAD).
 *
 *   FR24_API_TOKEN=... npm run fetch:fr24
 *   npm run fetch:fr24 -- --date-from 2026-05-14 --date-to 2026-05-30
 *   npm run fetch:fr24 -- --routes SVO-DAD,VVO-DAD,ALA-DAD
 *   npm run fetch:fr24 -- --departures SVO,DME,VKO,VVO,ALA,NQZ
 */
import "dotenv/config";
import path from "node:path";
import { paths } from "../server/config.js";
import { writeJson } from "../server/lib/fs-json.js";
import { getRussianSpeakingIso2Set } from "../server/services/seeds.js";
import { resolveDepartureAirport } from "../server/services/aviation-edge.js";
import {
  splitDateRange,
  fetchRoutesSimple,
  fetchOutboundToVietnam,
  fr24ToCanonical,
  MOSCOW_DEPARTURE_IATA,
} from "../server/services/flightradar24.js";

const DEFAULT_CIS_DEPARTURES = [
  "SVO", "DME", "VKO", "VVO", "OVB", "KJA", "KZN", "KHV", "ALA", "NQZ", "TAS",
  "MSQ", "BAX", "NOZ", "BQS",
];

const DEFAULT_ROUTES = ["SVO-DAD", "VVO-DAD", "ALA-DAD"];

function parseArgs(argv) {
  const opts = {
    dateFrom: "2026-05-14",
    dateTo: "2026-05-30",
    routes: [...DEFAULT_ROUTES],
    departures: [...DEFAULT_CIS_DEPARTURES],
    skipRoutes: false,
    skipDepartures: false,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--date-from" && argv[i + 1]) opts.dateFrom = argv[++i];
    else if (argv[i] === "--date-to" && argv[i + 1]) opts.dateTo = argv[++i];
    else if (argv[i] === "--routes" && argv[i + 1]) {
      opts.routes = argv[++i].split(",").map((s) => s.trim().toUpperCase());
    } else if (argv[i] === "--departures" && argv[i + 1]) {
      opts.departures = argv[++i].split(",").map((s) => s.trim().toUpperCase());
    } else if (argv[i] === "--moscow-only") {
      opts.departures = [...MOSCOW_DEPARTURE_IATA];
      opts.routes = [];
      opts.skipRoutes = true;
    } else if (argv[i] === "--routes-only") {
      opts.skipDepartures = true;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: node scripts/fetch-fr24-cis-vn.mjs [options]

Options:
  --date-from YYYY-MM-DD
  --date-to YYYY-MM-DD
  --routes LIST          Comma routes (default: SVO-DAD,VVO-DAD,ALA-DAD)
  --departures LIST      Outbound boards to paginate (default: 15 CIS hubs)
  --moscow-only          Only SVO,DME,VKO outbound pagination
  --routes-only          Skip outbound pagination
  --help

Primary ingest uses outbound:* + flight_datetime_from pagination.
Routes= is merged as a supplement.`);
      process.exit(0);
    }
  }
  return opts;
}

async function filterRuSpeaking(flights) {
  const ru = await getRussianSpeakingIso2Set();
  const out = [];
  for (const f of flights) {
    const ap = await resolveDepartureAirport(f.dep_iata);
    const cc = ap?.country_code?.toUpperCase();
    if (cc && ru.has(cc)) out.push({ ...f, fromCountry: cc });
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!process.env.FR24_API_TOKEN) {
    console.error("Set FR24_API_TOKEN in .env");
    process.exit(1);
  }

  console.log("Flightradar24 — CIS → Vietnam");
  console.log(`  Range: ${opts.dateFrom} → ${opts.dateTo}`);
  console.log(`  Pagination: flight_datetime_from + first_seen (+1s)`);
  if (!opts.skipDepartures) {
    console.log(`  Outbound boards: ${opts.departures.join(", ")}`);
  }
  if (!opts.skipRoutes && opts.routes.length) {
    console.log(`  Routes supplement: ${opts.routes.join(",")}`);
  }

  const rawFr24 = [];
  const chunks = splitDateRange(opts.dateFrom, opts.dateTo, 14);

  if (!opts.skipDepartures) {
    console.log("\n[1] Outbound departure pagination → Vietnam ...");
    for (const { dateFrom, dateTo } of chunks) {
      for (const dep of opts.departures) {
        const rows = await fetchOutboundToVietnam({
          dateFrom,
          dateTo,
          depIataList: [dep],
          maxPages: 80,
        });
        if (rows.length) {
          console.log(`  ${dateFrom}→${dateTo} outbound:${dep}: ${rows.length} VN`);
        }
        rawFr24.push(...rows);
      }
    }
  }

  if (!opts.skipRoutes && opts.routes.length) {
    console.log("\n[2] Routes supplement ...");
    for (const { dateFrom, dateTo } of chunks) {
      const rows = await fetchRoutesSimple({
        dateFrom,
        dateTo,
        routes: opts.routes,
      });
      console.log(`  ${dateFrom}→${dateTo} routes=${opts.routes.join(",")}: ${rows.length}`);
      rawFr24.push(...rows);
    }
  }

  const deduped = new Map();
  for (const row of rawFr24) {
    if (row?.fr24_id) deduped.set(row.fr24_id, row);
  }
  const ruFiltered = await filterRuSpeaking(
    [...deduped.values()].map(fr24ToCanonical),
  );
  const toDad = ruFiltered.filter((f) => f.arr_iata === "DAD");

  const byRoute = {};
  for (const f of ruFiltered) {
    const k = `${f.dep_iata}→${f.arr_iata}`;
    byRoute[k] = (byRoute[k] || 0) + 1;
  }

  const outFile = path.join(
    paths.root,
    "data/cache/fr24",
    `cis-vn_${opts.dateFrom}_${opts.dateTo}.json`,
  );
  await writeJson(outFile, {
    fetchedAt: new Date().toISOString(),
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    method: "outbound_pagination_primary",
    departuresScanned: opts.skipDepartures ? [] : opts.departures,
    routesSupplement: opts.skipRoutes ? [] : opts.routes,
    stats: {
      rawLegs: deduped.size,
      ruSpeakingFiltered: ruFiltered.length,
      toDaNang: toDad.length,
    },
    byRoute,
    flights: ruFiltered.sort((a, b) =>
      `${a.date}${a.eta}`.localeCompare(`${b.date}${b.eta}`),
    ),
  });

  console.log("\n=== RESULTS ===");
  console.log(`  Raw: ${deduped.size}  RU→VN: ${ruFiltered.length}  →DAD: ${toDad.length}`);
  console.log("  DAD:");
  for (const f of toDad) {
    console.log(`    ${f.date} ${f.eta} ${f.dep_iata}→DAD ${f.flight_iata}`);
  }
  console.log(`\nWrote ${outFile}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
