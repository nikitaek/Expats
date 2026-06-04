#!/usr/bin/env node
/**
 * Fill the Aviation Edge "dead zone" (tomorrow … day before flightsFuture)
 * by projecting from flightsHistory on the same weekday (7/14/21/28 days back).
 *
 * Usage:
 *   npm run fill:gap
 *   node scripts/fill-gap.mjs --date 2026-06-05 --airports SGN,DAD
 *   node scripts/fill-gap.mjs --force
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aviationEdge } from "../server/config.js";
import { getAirports } from "../server/services/seeds.js";
import { hasRawCache } from "../server/services/raw-cache.js";
import { loadScopeFromProjection } from "../server/services/scheduler.js";
import { enumerateDates } from "../server/services/aggregate.js";
import { isNearTermGapDate } from "../server/services/project-history.js";
import { writeJson } from "../server/lib/fs-json.js";
import { paths } from "../server/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const opts = {
    force: false,
    dateFrom: null,
    dateTo: null,
    airports: null,
    delayMs: 300,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") opts.force = true;
    else if (a === "--date" && argv[i + 1]) {
      opts.dateFrom = opts.dateTo = argv[++i];
    } else if (a === "--from" && argv[i + 1]) opts.dateFrom = argv[++i];
    else if (a === "--to" && argv[i + 1]) opts.dateTo = argv[++i];
    else if (a === "--delay" && argv[i + 1]) opts.delayMs = Number(argv[++i]);
    else if (a === "--airports" && argv[i + 1]) {
      opts.airports = argv[++i]
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{3}$/.test(c));
    } else if (a === "--help" || a === "-h") {
      console.log(`Fill near-term gap dates using historical projection.

Default range: tomorrow through today+${aviationEdge.futureMinDaysAhead - 1}.

Options:
  --date YYYY-MM-DD   Single day
  --from / --to       Date range
  --airports LIST     Comma-separated IATA (default: all seed airports)
  --force             Overwrite existing cache
  --delay MS          Pause between loads (default: 300)
`);
      process.exit(0);
    }
  }
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultGapRange() {
  const today = todayIso();
  const from = addDays(today, 1);
  const to = addDays(today, aviationEdge.futureMinDaysAhead - 1);
  return { from, to };
}

async function main() {
  const opts = parseArgs(process.argv);
  const today = todayIso();
  const defaults = defaultGapRange();
  const dateFrom = opts.dateFrom || defaults.from;
  const dateTo = opts.dateTo || defaults.to;

  if (!aviationEdge.apiKey) {
    console.error("AVIATION_EDGE_API_KEY is missing. Set it in .env");
    process.exit(1);
  }

  const allAirports = await getAirports();
  const airports = opts.airports
    ? allAirports.filter((a) => opts.airports.includes(a.iata))
    : allAirports;

  if (airports.length === 0) {
    console.error("No airports matched.");
    process.exit(1);
  }

  const dates = enumerateDates(dateFrom, dateTo).filter(isNearTermGapDate);
  if (dates.length === 0) {
    console.error(
      `No gap dates in ${dateFrom}…${dateTo}. Gap is tomorrow … +${aviationEdge.futureMinDaysAhead - 1} days from today (${today}).`,
    );
    process.exit(1);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  console.log("Flight Scheduler — fill near-term gap (historical projection)");
  console.log(`Today: ${today} | future API from +${aviationEdge.futureMinDaysAhead} days`);
  console.log(`Dates: ${dates[0]} … ${dates[dates.length - 1]} (${dates.length} days)`);
  console.log(`Airports: ${airports.map((a) => a.iata).join(", ")}`);
  console.log("");

  const startedAt = new Date().toISOString();

  for (const date of dates) {
    for (const airport of airports) {
      const iata = airport.iata;
      const label = `${date} ${iata}`;

      if (!opts.force && (await hasRawCache(date, iata))) {
        skipped += 1;
        console.log(`${label} — skipped (cached)`);
        continue;
      }

      try {
        const result = await loadScopeFromProjection(date, iata);
        ok += 1;
        console.log(
          `${label} — OK from ${result.projectedFrom} total=${result.totalIncoming} ru=${result.filteredCount}`,
        );
      } catch (err) {
        failed += 1;
        errors.push({ date, iata, message: err.message });
        console.error(`${label} — FAIL: ${err.message}`);
      }

      if (opts.delayMs > 0) await sleep(opts.delayMs);
    }
  }

  const manifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    today,
    dateFrom: dates[0],
    dateTo: dates[dates.length - 1],
    futureMinDaysAhead: aviationEdge.futureMinDaysAhead,
    stats: { ok, skipped, failed },
    errors: errors.slice(0, 50),
  };

  const manifestPath = path.join(paths.rawCache, "..", "fill-gap-manifest.json");
  await writeJson(manifestPath, manifest);

  console.log("\n=== Fill gap complete ===");
  console.log(`OK: ${ok} | skipped: ${skipped} | failed: ${failed}`);
  console.log(`Manifest: ${path.relative(ROOT, manifestPath)}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
