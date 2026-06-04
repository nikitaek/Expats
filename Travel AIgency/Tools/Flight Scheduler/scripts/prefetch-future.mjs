#!/usr/bin/env node
/**
 * Prefetch Aviation Edge future schedules for all seed airports.
 * Uses flightsFuture from the earliest API-accepted date, then the next N days.
 *
 * Usage:
 *   node scripts/prefetch-future.mjs
 *   node scripts/prefetch-future.mjs --days 30 --delay 400
 *   node scripts/prefetch-future.mjs --force --airports SGN,CXR,HAN
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aviationEdge, paths } from "../server/config.js";
import { getAirports } from "../server/services/seeds.js";
import { hasRawCache } from "../server/services/raw-cache.js";
import { loadScopeFromApi } from "../server/services/scheduler.js";
import { scheduleModeForDate } from "../server/services/aviation-edge.js";
import { readJson, writeJson } from "../server/lib/fs-json.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const opts = {
    days: 30,
    delayMs: 400,
    force: false,
    retryFailed: false,
    airports: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") opts.force = true;
    else if (a === "--retry-failed") opts.retryFailed = true;
    else if (a === "--days" && argv[i + 1]) opts.days = Number(argv[++i]);
    else if (a === "--delay" && argv[i + 1]) opts.delayMs = Number(argv[++i]);
    else if (a === "--airports" && argv[i + 1]) {
      opts.airports = argv[++i]
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{3}$/.test(c));
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/prefetch-future.mjs [options]

Options:
  --days N          Calendar days to prefetch (default: 30)
  --delay MS        Pause between API loads (default: 400)
  --airports LIST   Comma-separated IATA codes (default: all seed airports)
  --force           Re-download even if cache exists
  --retry-failed    Only jobs listed in prefetch-future-manifest.json errors
  --help            Show this help

Starts at today + ${aviationEdge.futureMinDaysAhead} days (flightsFuture minimum).
Each airport+date uses 1 schedule API call (+ airport lookups on first normalize).
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

async function main() {
  const opts = parseArgs(process.argv);

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

  const today = todayIso();
  const startDate = addDays(today, aviationEdge.futureMinDaysAhead);
  const dates = Array.from({ length: opts.days }, (_, i) =>
    addDays(startDate, i),
  );

  let jobs;
  if (opts.retryFailed) {
    const retryListPath = path.join(
      paths.rawCache,
      "..",
      "prefetch-rate-limit-retry.json",
    );
    const manifestPath = path.join(
      paths.rawCache,
      "..",
      "prefetch-future-manifest.json",
    );
    try {
      jobs = await readJson(retryListPath);
      console.log(`Retrying ${jobs.length} jobs from prefetch-rate-limit-retry.json.`);
    } catch {
      try {
        const prev = await readJson(manifestPath);
        jobs = (prev.errors || [])
          .filter((e) => /limit requests|rate|429|503/i.test(e.message || ""))
          .map((e) => ({ date: e.date, iata: e.iata }));
        console.log(`Retrying ${jobs.length} rate-limited jobs from manifest.`);
      } catch {
        console.error("No retry list or manifest found.");
        process.exit(1);
      }
    }
  } else {
    jobs = [];
    for (const date of dates) {
      for (const airport of airports) {
        jobs.push({ date, iata: airport.iata });
      }
    }
  }

  const totalJobs = jobs.length;
  let done = 0;
  let skipped = 0;
  let ok = 0;
  let empty = 0;
  let failed = 0;
  const errors = [];

  console.log("Flight Scheduler — future prefetch");
  console.log(`Today: ${today}`);
  console.log(
    `Range: ${dates[0]} … ${dates[dates.length - 1]} (${opts.days} days, mode: future)`,
  );
  console.log(
    `Airports (${airports.length}): ${airports.map((a) => a.iata).join(", ")}`,
  );
  console.log(`Jobs: ${totalJobs} | delay: ${opts.delayMs}ms | force: ${opts.force}`);
  console.log("");

  const startedAt = new Date().toISOString();

  for (const job of jobs) {
    const { date, iata } = job;
    done += 1;
    const label = `[${done}/${totalJobs}] ${date} ${iata}`;

    if (scheduleModeForDate(date) !== "future") {
      console.warn(`${label} — skip (not future mode)`);
      continue;
    }

    if (!opts.force && (await hasRawCache(date, iata))) {
      skipped += 1;
      console.log(`${label} — skipped (cached)`);
      continue;
    }

    try {
      const result = await loadWithRetries(date, iata);
      ok += 1;
      console.log(
        `${label} — OK total=${result.totalIncoming} ru=${result.filteredCount} pax≈${result.paxTotal}`,
      );
    } catch (err) {
      if (err.code === "NO_SCHEDULE_DATA") {
        empty += 1;
        console.log(`${label} — no data (not cached)`);
      } else {
        failed += 1;
        errors.push({ date, iata, message: err.message });
        console.error(`${label} — FAIL: ${err.message}`);
      }
    }

    if (opts.delayMs > 0 && done < totalJobs) {
      await sleep(opts.delayMs);
    }
  }

  const manifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    today,
    startDate,
    endDate: dates[dates.length - 1],
    days: opts.days,
    futureMinDaysAhead: aviationEdge.futureMinDaysAhead,
    airports: airports.map((a) => a.iata),
    stats: { totalJobs, skipped, ok, empty, failed },
    errors: errors.slice(0, 50),
  };

  const manifestPath = path.join(paths.rawCache, "..", "prefetch-future-manifest.json");
  await writeJson(manifestPath, manifest);

  console.log("\n=== Prefetch complete ===");
  console.log(`OK: ${ok} | skipped: ${skipped} | empty: ${empty} | failed: ${failed}`);
  console.log(`Manifest: ${path.relative(ROOT, manifestPath)}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
