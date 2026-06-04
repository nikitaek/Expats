#!/usr/bin/env node
/**
 * Compare FR24 fetch strategies for CIS → Vietnam (May 2026 sample).
 *
 *   FR24_API_TOKEN=... node scripts/test-fr24-strategies.mjs
 *   node scripts/test-fr24-strategies.mjs --date-from 2026-05-14 --date-to 2026-05-30
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
  fetchSummaryPaginated,
  fr24ToCanonical,
  MOSCOW_DEPARTURE_IATA,
  VIETNAM_ARRIATA,
} from "../server/services/flightradar24.js";

const CORE_ROUTES = ["SVO-DAD", "VVO-DAD", "ALA-DAD"];
const CIS_ORIGINS = [
  "SVO", "DME", "VKO", "VVO", "OVB", "KJA", "KZN", "KHV", "ALA", "NQZ", "TAS",
  "MSQ", "BAX", "NOZ", "BQS",
];

function parseArgs(argv) {
  const opts = { dateFrom: "2026-05-14", dateTo: "2026-05-30" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--date-from" && argv[i + 1]) opts.dateFrom = argv[++i];
    else if (argv[i] === "--date-to" && argv[i + 1]) opts.dateTo = argv[++i];
  }
  return opts;
}

function summarize(flights, label) {
  const byRoute = new Map();
  let dad = 0;
  for (const f of flights) {
    const key = `${f.dep_iata}→${f.arr_iata}`;
    byRoute.set(key, (byRoute.get(key) || 0) + 1);
    if (f.arr_iata === "DAD") dad++;
  }
  return { label, total: flights.length, toDad: dad, byRoute: Object.fromEntries(byRoute) };
}

async function filterRu(flights) {
  const ru = await getRussianSpeakingIso2Set();
  const out = [];
  for (const f of flights) {
    const ap = await resolveDepartureAirport(f.dep_iata);
    const cc = ap?.country_code?.toUpperCase();
    if (cc && ru.has(cc)) out.push({ ...f, fromCountry: cc });
  }
  return out;
}

async function strategyRoutes(dateFrom, dateTo) {
  console.log("\n━━━ Strategy A: routes=SVO-DAD,VVO-DAD,ALA-DAD ━━━");
  const raw = [];
  for (const { dateFrom: df, dateTo: dt } of splitDateRange(dateFrom, dateTo, 14)) {
    const rows = await fetchRoutesSimple({
      dateFrom: df,
      dateTo: dt,
      routes: CORE_ROUTES,
    });
    console.log(`  chunk ${df}→${dt}: ${rows.length} legs`);
    raw.push(...rows);
  }
  const dedup = new Map();
  for (const r of raw) if (r.fr24_id) dedup.set(r.fr24_id, r);
  const canon = [...dedup.values()].map(fr24ToCanonical);
  const ru = await filterRu(canon);
  return { raw: [...dedup.values()], flights: ru };
}

async function strategyMoscowOutbound(dateFrom, dateTo) {
  console.log("\n━━━ Strategy B: Moscow outbound + first_seen pagination ━━━");
  console.log(`  airports: ${MOSCOW_DEPARTURE_IATA.map((d) => `outbound:${d}`).join(", ")}`);
  const raw = [];
  for (const { dateFrom: df, dateTo: dt } of splitDateRange(dateFrom, dateTo, 14)) {
    for (const dep of MOSCOW_DEPARTURE_IATA) {
      const rows = await fetchOutboundToVietnam({
        dateFrom: df,
        dateTo: dt,
        depIataList: [dep],
        maxPages: 80,
      });
      console.log(`  ${df}→${dt} outbound:${dep}: ${rows.length} VN legs`);
      raw.push(...rows);
    }
  }
  const dedup = new Map();
  for (const r of raw) if (r.fr24_id) dedup.set(r.fr24_id, r);
  const canon = [...dedup.values()].map(fr24ToCanonical);
  const ru = await filterRu(canon);
  return { raw: [...dedup.values()], flights: ru };
}

async function strategyAllCisOutbound(dateFrom, dateTo) {
  console.log("\n━━━ Strategy C: all CIS origins outbound + pagination ━━━");
  const raw = [];
  for (const { dateFrom: df, dateTo: dt } of splitDateRange(dateFrom, dateTo, 14)) {
    const rows = await fetchOutboundToVietnam({
      dateFrom: df,
      dateTo: dt,
      depIataList: CIS_ORIGINS,
      maxPages: 40,
    });
    console.log(`  chunk ${df}→${dt}: ${rows.length} VN legs (all CIS outbound)`);
    raw.push(...rows);
  }
  const dedup = new Map();
  for (const r of raw) if (r.fr24_id) dedup.set(r.fr24_id, r);
  const canon = [...dedup.values()].map(fr24ToCanonical);
  const ru = await filterRu(canon);
  return { raw: [...dedup.values()], flights: ru };
}

/** Paginated inbound:DAD for reference (not preferred for CIS charters). */
async function strategyInboundDadPaginated(dateFrom, dateTo) {
  console.log("\n━━━ Reference: inbound:DAD + first_seen pagination (sample day) ━━━");
  const sample = "2026-05-23";
  const rows = await fetchSummaryPaginated({
    dateFrom: sample,
    dateTo: sample,
    filters: { airports: "inbound:DAD" },
    maxPages: 15,
  });
  const cis = rows
    .map(fr24ToCanonical)
    .filter((f) => CIS_ORIGINS.includes(f.dep_iata));
  console.log(`  ${sample}: ${rows.length} total inbound, ${cis.length} CIS origin`);
  return { sample, total: rows.length, cisOrigin: cis.length };
}

async function main() {
  const { dateFrom, dateTo } = parseArgs(process.argv);
  if (!process.env.FR24_API_TOKEN) {
    console.error("Set FR24_API_TOKEN in .env");
    process.exit(1);
  }

  console.log("FR24 strategy comparison");
  console.log(`  ${dateFrom} → ${dateTo}`);
  console.log(`  VN airports tracked: ${[...VIETNAM_ARRIATA].join(", ")}`);

  const ref = await strategyInboundDadPaginated(dateFrom, dateTo);
  const a = await strategyRoutes(dateFrom, dateTo);
  const b = await strategyMoscowOutbound(dateFrom, dateTo);
  const c = await strategyAllCisOutbound(dateFrom, dateTo);

  const summaries = [
    summarize(a.flights, "A: routes SVO/VVO/ALA → DAD"),
    summarize(b.flights, "B: Moscow outbound → VN"),
    summarize(c.flights, "C: all CIS outbound → VN"),
  ];

  console.log("\n━━━ COMPARISON ━━━");
  for (const s of summaries) {
    console.log(`\n${s.label}`);
    console.log(`  total RU-speaking→VN: ${s.total}, →DAD: ${s.toDad}`);
    const dadRoutes = Object.entries(s.byRoute)
      .filter(([k]) => k.endsWith("→DAD"))
      .sort((a, b) => b[1] - a[1]);
    for (const [route, n] of dadRoutes) console.log(`    ${route}: ${n}`);
  }

  console.log("\n  Core routes only (A) — DAD detail:");
  for (const f of a.flights.filter((x) => x.arr_iata === "DAD")) {
    console.log(`    ${f.date} ${f.eta} ${f.dep_iata}→DAD ${f.flight_iata}`);
  }

  console.log("\n  Moscow outbound (B) — all VN:");
  for (const f of b.flights) {
    console.log(`    ${f.date} ${f.eta} ${f.dep_iata}→${f.arr_iata} ${f.flight_iata}`);
  }

  const outFile = path.join(
    paths.root,
    "data/cache/fr24",
    `strategy-test_${dateFrom}_${dateTo}.json`,
  );
  await writeJson(outFile, {
    fetchedAt: new Date().toISOString(),
    dateFrom,
    dateTo,
    inboundDadReference: ref,
    strategies: {
      routesCore: { summary: summaries[0], flights: a.flights },
      moscowOutbound: { summary: summaries[1], flights: b.flights },
      cisOutbound: { summary: summaries[2], flights: c.flights },
    },
  });
  console.log(`\nWrote ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
