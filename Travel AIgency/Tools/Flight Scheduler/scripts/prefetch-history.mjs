#!/usr/bin/env node
/**
 * Load Aviation Edge historical schedules (flightsHistory) for past dates.
 * Rewrites raw + normalized cache with actual flown/arrival data.
 *
 * Usage:
 *   npm run prefetch:history
 *   node scripts/prefetch-history.mjs --from 2026-05-15 --to 2026-06-03
 *   node scripts/prefetch-history.mjs --date 2026-05-20 --airports SGN,HAN
 *   node scripts/prefetch-history.mjs --skip-cached
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aviationEdge, paths } from "../server/config.js";
import { getAirports } from "../server/services/seeds.js";
import { hasRawCache } from "../server/services/raw-cache.js";
import { loadScopeFromApi } from "../server/services/scheduler.js";
import { scheduleModeForDate, latestHistoryDateIso, isHistoryApiDate } from "../server/services/aviation-edge.js";
import { enumerateDates } from "../server/services/aggregate.js";
import { writeJson } from "../server/lib/fs-json.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/** Top Vietnamese airports by Russian-tourist priority (see airports.json). */
const DEFAULT_AIRPORT_COUNT = 8;
const DEFAULT_HISTORY_FROM = "2026-05-15";

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysFromToday(dateStr, today) {
  const a = new Date(`${dateStr}T12:00:00`);
  const b = new Date(`${today}T12:00:00`);
  return Math.round((a - b) / 86_400_000);
}

function parseArgs(argv) {
  const opts = {
    force: true,
    dateFrom: null,
    dateTo: null,
    airports: null,
    topAirports: DEFAULT_AIRPORT_COUNT,
    delayMs: 400,
    includeRecent: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") opts.force = true;
    else if (a === "--skip-cached") opts.force = false;
    else if (a === "--include-recent") opts.includeRecent = true;
    else if (a === "--date" && argv[i + 1]) {
      opts.dateFrom = opts.dateTo = argv[++i];
    } else if (a === "--from" && argv[i + 1]) opts.dateFrom = argv[++i];
    else if (a === "--to" && argv[i + 1]) opts.dateTo = argv[++i];
    else if (a === "--delay" && argv[i + 1]) opts.delayMs = Number(argv[++i]);
    else if (a === "--top" && argv[i + 1]) {
      opts.topAirports = Number(argv[++i]);
    } else if (a === "--airports" && argv[i + 1]) {
      opts.airports = argv[++i]
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{3}$/.test(c));
    } else if (a === "--help" || a === "-h") {
      console.log(`Load historical schedules (flightsHistory) into local cache.

Default range: ${DEFAULT_HISTORY_FROM} through yesterday.
Default airports: top ${DEFAULT_AIRPORT_COUNT} by priority (Russian-tourist popularity).
Cache is rewritten by default (use --skip-cached to keep existing files).

Options:
  --from YYYY-MM-DD   Range start (default: ${DEFAULT_HISTORY_FROM})
  --to YYYY-MM-DD     Range end (default: yesterday)
  --date YYYY-MM-DD   Single day
  --airports LIST     Comma-separated IATA codes
  --top N             Use top N seed airports by priority (default: ${DEFAULT_AIRPORT_COUNT})
  --force             Overwrite existing cache (default)
  --skip-cached       Skip scopes that already have raw cache
  --include-recent    Include dates within history lag (timetable API, partial day)
  --delay MS          Pause between API loads (default: 400)
`);
      process.exit(0);
    }
  }
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err) {
  if (err.code === "NO_SCHEDULE_DATA") return false;
  return /limit requests|rate|timeout|429|503/i.test(err.message || "");
}

function isProviderGap(err) {
  const msg = err.message || "";
  return (
    err.code === "NO_SCHEDULE_DATA" ||
    /no older data currently available|code#32|date_to > 3 days from current date/i.test(msg)
  );
}

async function loadWithRetries(date, iata, maxAttempts = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await loadScopeFromApi(date, iata);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts) throw err;
      const wait = 2000 * attempt;
      console.warn(`  retry ${attempt}/${maxAttempts - 1} in ${wait}ms… (${err.message})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function resolveAirports(opts) {
  const allAirports = await getAirports();
  if (opts.airports) {
    return allAirports.filter((a) => opts.airports.includes(a.iata));
  }
  const limit = opts.topAirports > 0 ? opts.topAirports : DEFAULT_AIRPORT_COUNT;
  return allAirports.slice(0, limit);
}

async function main() {
  const opts = parseArgs(process.argv);
  const today = todayIso();
  const requestedFrom = opts.dateFrom || DEFAULT_HISTORY_FROM;
  const requestedTo = opts.dateTo || yesterdayIso();
  const latestHistory = latestHistoryDateIso();

  let dateFrom = requestedFrom;
  let dateTo = requestedTo;

  if (!opts.includeRecent && dateTo > latestHistory) {
    console.warn(
      `Note: flightsHistory only covers through ${latestHistory} (${aviationEdge.historyMinDaysBehind}+ days ago).`,
    );
    console.warn(
      `Capping --to from ${dateTo} to ${latestHistory}. Use --include-recent for newer past dates (timetable, partial).`,
    );
    dateTo = latestHistory;
  }

  if (dateFrom > dateTo) {
    console.error(`Invalid range after history cap: ${dateFrom} … ${dateTo}`);
    process.exit(1);
  }

  if (!aviationEdge.apiKey) {
    console.error("AVIATION_EDGE_API_KEY is missing. Set it in .env");
    process.exit(1);
  }

  const airports = await resolveAirports(opts);
  if (airports.length === 0) {
    console.error("No airports matched.");
    process.exit(1);
  }

  const rangeEnd = opts.includeRecent ? requestedTo : dateTo;
  const dates = opts.includeRecent
    ? enumerateDates(dateFrom, rangeEnd).filter((d) => daysFromToday(d, today) < 0)
    : enumerateDates(dateFrom, dateTo).filter((d) => isHistoryApiDate(d));

  if (dates.length === 0) {
    console.error(
      `No loadable past dates in ${dateFrom}…${rangeEnd}. History API covers through ${latestHistory}.`,
    );
    process.exit(1);
  }

  const jobs = [];
  for (const date of dates) {
    for (const airport of airports) {
      jobs.push({ date, iata: airport.iata });
    }
  }

  let done = 0;
  let skipped = 0;
  let ok = 0;
  let empty = 0;
  let providerGaps = 0;
  let failed = 0;
  const errors = [];

  console.log("Flight Scheduler — historical prefetch");
  console.log(`Today: ${today} | history through: ${latestHistory}`);
  console.log(`Range: ${dates[0]} … ${dates[dates.length - 1]} (${dates.length} days)`);
  console.log(
    `Airports (${airports.length}): ${airports.map((a) => a.iata).join(", ")}`,
  );
  console.log(`Jobs: ${jobs.length} | delay: ${opts.delayMs}ms | force: ${opts.force}`);
  console.log("");

  const startedAt = new Date().toISOString();

  for (const job of jobs) {
    const { date, iata } = job;
    done += 1;
    const label = `[${done}/${jobs.length}] ${date} ${iata}`;

    if (!opts.force && (await hasRawCache(date, iata))) {
      skipped += 1;
      console.log(`${label} — skipped (cached)`);
      continue;
    }

    try {
      const result = await loadWithRetries(date, iata);
      ok += 1;
      const mode = scheduleModeForDate(date);
      console.log(
        `${label} — OK [${mode}] total=${result.totalIncoming} ru=${result.filteredCount} pax≈${result.paxTotal}`,
      );
    } catch (err) {
      if (isProviderGap(err)) {
        if (err.code === "NO_SCHEDULE_DATA") {
          empty += 1;
          console.log(`${label} — no data (cache cleared)`);
        } else {
          providerGaps += 1;
          console.log(`${label} — provider gap: ${err.message}`);
        }
      } else {
        failed += 1;
        errors.push({ date, iata, message: err.message });
        console.error(`${label} — FAIL: ${err.message}`);
      }
    }

    if (opts.delayMs > 0 && done < jobs.length) {
      await sleep(opts.delayMs);
    }
  }

  const manifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    today,
    dateFrom: dates[0],
    dateTo: dates[dates.length - 1],
    airports: airports.map((a) => a.iata),
    requestedFrom: dateFrom,
    requestedTo,
    latestHistoryDate: latestHistory,
    stats: { totalJobs: jobs.length, skipped, ok, empty, providerGaps, failed },
    errors: errors.slice(0, 50),
  };

  const manifestPath = path.join(paths.rawCache, "..", "prefetch-history-manifest.json");
  await writeJson(manifestPath, manifest);

  console.log("\n=== Historical prefetch complete ===");
  console.log(
    `OK: ${ok} | skipped: ${skipped} | empty: ${empty} | provider gaps: ${providerGaps} | failed: ${failed}`,
  );
  console.log(`Manifest: ${path.relative(ROOT, manifestPath)}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
