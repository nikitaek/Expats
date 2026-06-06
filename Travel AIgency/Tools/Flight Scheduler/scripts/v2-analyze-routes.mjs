#!/usr/bin/env node
/**
 * Analyze canonical flight data: flights, estimated passengers, summary tables.
 */
import path from "node:path";
import { parseArgs } from "../src/shared/lib/cli-args.js";
import { paths } from "../src/shared/config/env.js";
import { readJson, writeJson } from "../src/shared/lib/fs-json.js";
import { loadEnabledRoutes } from "../src/shared/lib/routes-seed.js";
import { fr24PlanDataFrom } from "../src/shared/lib/dates.js";
import { enrichFlight } from "../src/shared/enrichment/pax-estimate.js";
import * as objectStore from "../src/shared/storage/object-store.js";

const args = parseArgs();
const dateFrom = args.date_from || fr24PlanDataFrom();
const dateTo = args.date_to || new Date().toISOString().slice(0, 10);

function monthKey(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 7);
}

function routeFromFlight(f) {
  return f.route || `${f.originIata}-${f.destinationIata}`;
}

function arrivalDay(f) {
  const arrival = f.actualArrivalAt || f.scheduledArrivalAt;
  return arrival ? String(arrival).slice(0, 10) : null;
}

/** Keep one row per fr24Id (overlapping download windows deduped). */
function dedupeFlights(flights) {
  const byId = new Map();
  for (const f of flights) {
    const id = f.fr24Id;
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, f);
      continue;
    }
    const a = arrivalDay(existing);
    const b = arrivalDay(f);
    if (b && (!a || b > a)) byId.set(id, f);
  }
  return [...byId.values()];
}

function aggregateByKey(flights, keyFn, labelFn = (k) => k) {
  const m = new Map();
  for (const f of flights) {
    const key = keyFn(f);
    if (!key) continue;
    if (!m.has(key)) {
      m.set(key, { code: key, label: labelFn(key), flights: 0, paxEst: 0 });
    }
    const row = m.get(key);
    row.flights += 1;
    row.paxEst += Number(f.paxEst) || 0;
  }
  return [...m.values()]
    .map((row) => ({
      ...row,
      avgPaxPerFlight: row.flights ? Math.round(row.paxEst / row.flights) : 0,
    }))
    .sort((a, b) => b.paxEst - a.paxEst);
}

function addSharePct(rows, totalPax) {
  if (!totalPax) return rows.map((r) => ({ ...r, sharePct: 0 }));
  return rows.map((r) => ({
    ...r,
    sharePct: Math.round((r.paxEst / totalPax) * 1000) / 10,
  }));
}

function formatMarkdownTable(headers, rows) {
  const sep = headers.map(() => "---");
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ];
  return lines.join("\n");
}

const vietnamAirports = await readJson(path.join(paths.seeds, "airports.json"), []);
const originAirports = await readJson(
  path.join(paths.seeds, "v2-origin-airports.json"),
  [],
);
const airportLabels = new Map([
  ...vietnamAirports.map((a) => [a.iata, `${a.iata} — ${a.city}`]),
  ...originAirports.map((a) => [
    a.iata,
    `${a.iata} — ${a.city}, ${a.country}`,
  ]),
]);

const enabledRoutes = await loadEnabledRoutes();

const keys = await objectStore.listPrefix("canonical/flights/");
const flightKeys = keys.filter((k) => k.endsWith("/flights.json"));

const rawFlights = [];
for (const key of flightKeys) {
  const body = await objectStore.getObject(key);
  for (const f of body.flights || []) {
    const day = arrivalDay(f);
    if (day && (day < dateFrom || day > dateTo)) continue;
    rawFlights.push({ ...f, _arrivalDay: day });
  }
}

const duplicateCount = rawFlights.length;
const flights = dedupeFlights(rawFlights);

for (let i = 0; i < flights.length; i++) {
  if (flights[i].paxEst == null) {
    flights[i] = await enrichFlight(flights[i]);
  }
}

const totalPax = flights.reduce((n, f) => n + (Number(f.paxEst) || 0), 0);

const byRoute = addSharePct(
  aggregateByKey(
    flights,
    routeFromFlight,
    (route) => route,
  ),
  totalPax,
);

const byOrigin = addSharePct(
  aggregateByKey(
    flights,
    (f) => f.originIata,
    (iata) => airportLabels.get(iata) || iata,
  ),
  totalPax,
);

const byDestination = addSharePct(
  aggregateByKey(
    flights,
    (f) => f.destinationIata,
    (iata) => airportLabels.get(iata) || iata,
  ),
  totalPax,
);

const byMonth = new Map();
for (const f of flights) {
  const m = monthKey(f._arrivalDay) || "unknown";
  if (!byMonth.has(m)) byMonth.set(m, { flights: 0, paxEst: 0 });
  const row = byMonth.get(m);
  row.flights += 1;
  row.paxEst += Number(f.paxEst) || 0;
}

const routesWithFlights = byRoute.map((r) => ({
  route: r.code,
  flights: r.flights,
  paxEst: r.paxEst,
  avgPaxPerFlight: r.avgPaxPerFlight,
  sharePct: r.sharePct,
}));

const routesEmpty = enabledRoutes.filter(
  (r) => !byRoute.some((row) => row.code === r),
);

const report = {
  generatedAt: new Date().toISOString(),
  dateFrom,
  dateTo,
  planDataFrom: fr24PlanDataFrom(),
  note:
    "FR24 subscription does not include Jan–Apr 2026; analysis covers plan-allowed window only.",
  paxEstimation: {
    method:
      "Per flight: aircraft type → typical seat capacity from data/seeds/aircraft-pax.json (default 150 if unknown).",
    disclaimer:
      "Estimated capacity, not actual load factor. Same aircraft type uses fleet-average seats; duplicates removed by fr24_id.",
  },
  totals: {
    flightsRaw: duplicateCount,
    flightsUnique: flights.length,
    duplicatesRemoved: duplicateCount - flights.length,
    paxEstTotal: totalPax,
    avgPaxPerFlight: flights.length
      ? Math.round(totalPax / flights.length)
      : 0,
  },
  enabledRoutes: enabledRoutes.length,
  canonicalFiles: flightKeys.length,
  routesWithFlights: routesWithFlights.length,
  routesEmpty,
  byMonth: Object.fromEntries(
    [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => [month, v]),
  ),
  tables: {
    byRoute: routesWithFlights,
    byOrigin,
    byDestination,
  },
  routesWithFlights,
};

const baseName = `ytd-summary-${dateFrom}_${dateTo}`;
const jsonPath = path.join(paths.data, "analysis", `${baseName}.json`);
const mdPath = path.join(paths.data, "analysis", `${baseName}.md`);

await writeJson(jsonPath, report);

const md = [
  `# Flight analysis ${dateFrom} → ${dateTo}`,
  "",
  `Generated: ${report.generatedAt}`,
  "",
  "## Totals",
  "",
  formatMarkdownTable(
    ["Metric", "Value"],
    [
      ["Unique flights", String(report.totals.flightsUnique)],
      ["Raw rows (before dedupe)", String(report.totals.flightsRaw)],
      ["Duplicates removed", String(report.totals.duplicatesRemoved)],
      ["Estimated passengers (total)", String(report.totals.paxEstTotal)],
      ["Avg est. passengers / flight", String(report.totals.avgPaxPerFlight)],
    ],
  ),
  "",
  `_${report.paxEstimation.disclaimer}_`,
  "",
  "## By route (origin → destination)",
  "",
  formatMarkdownTable(
    ["Route", "Flights", "Est. passengers", "Avg / flight", "Share %"],
    byRoute.map((r) => [
      r.code,
      String(r.flights),
      String(r.paxEst),
      String(r.avgPaxPerFlight),
      String(r.sharePct),
    ]),
  ),
  "",
  "## By source airport (origin)",
  "",
  formatMarkdownTable(
    ["Origin", "Flights", "Est. passengers", "Avg / flight", "Share %"],
    byOrigin.map((r) => [
      r.label,
      String(r.flights),
      String(r.paxEst),
      String(r.avgPaxPerFlight),
      String(r.sharePct),
    ]),
  ),
  "",
  "## By destination airport (Vietnam)",
  "",
  formatMarkdownTable(
    ["Destination", "Flights", "Est. passengers", "Avg / flight", "Share %"],
    byDestination.map((r) => [
      r.label,
      String(r.flights),
      String(r.paxEst),
      String(r.avgPaxPerFlight),
      String(r.sharePct),
    ]),
  ),
  "",
  "## By month",
  "",
  formatMarkdownTable(
    ["Month", "Flights", "Est. passengers"],
    [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => [month, String(v.flights), String(v.paxEst)]),
  ),
].join("\n");

await import("node:fs/promises").then((fs) => fs.writeFile(mdPath, md, "utf8"));

console.log("\n=== TOTALS ===");
console.log(JSON.stringify(report.totals, null, 2));
console.log("\n=== BY DESTINATION (top 10) ===");
console.table(byDestination.slice(0, 10));
console.log("\n=== BY ORIGIN (top 10) ===");
console.table(byOrigin.slice(0, 10));
console.log(`\nWrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
