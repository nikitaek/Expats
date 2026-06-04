#!/usr/bin/env node
/**
 * One-time near-term fill (today + next 6 days) via Aviationstack timetable.
 *
 * Minimizes Aviationstack calls: one airport at a time, paginate only while
 * budget allows. Airport countries + any still-empty scopes use Aviation Edge
 * cache / historical projection (no extra Aviationstack calls).
 *
 * Usage:
 *   AVIATIONSTACK_ACCESS_KEY=xxx npm run fill:gap:stack
 *   node scripts/fill-gap-aviationstack.mjs --key xxx --max-requests 95
 *   node scripts/fill-gap-aviationstack.mjs --dry-run
 *   node scripts/fill-gap-aviationstack.mjs --no-edge-fallback
 */
import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aviationstack, paths } from "../server/config.js";
import { getAirports } from "../server/services/seeds.js";
import { hasRawCache, loadRawCache, saveRawCache } from "../server/services/raw-cache.js";
import { saveNormalized } from "../server/services/normalized-store.js";
import { normalizeSchedules } from "../server/services/normalize.js";
import {
  bucketCanonicalByDate,
  coverageNoteFor,
  fetchTimetablePage,
  projectCanonicalToDate,
  projectedCoverageNote,
  stackTimetableRowToCanonical,
} from "../server/services/aviationstack.js";
import { loadScopeFromProjection } from "../server/services/scheduler.js";
import { writeJson } from "../server/lib/fs-json.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function enumerateTargetDates() {
  const today = todayIso();
  return Array.from({ length: 7 }, (_, i) => addDays(today, i));
}

function parseArgs(argv) {
  const opts = {
    maxRequests: 95,
    delayMs: aviationstack.minDelayMs,
    force: false,
    dryRun: false,
    edgeFallback: false,
    projectFromToday: true,
    fromCacheOnly: false,
    accessKey: process.env.AVIATIONSTACK_ACCESS_KEY || "",
    airports: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") opts.force = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--edge-fallback") opts.edgeFallback = true;
    else if (a === "--no-project-from-today") opts.projectFromToday = false;
    else if (a === "--from-cache-only") opts.fromCacheOnly = true;
    else if (a === "--key" && argv[i + 1]) opts.accessKey = argv[++i];
    else if (a === "--max-requests" && argv[i + 1]) {
      opts.maxRequests = Number(argv[++i]);
    } else if (a === "--delay" && argv[i + 1]) {
      opts.delayMs = Number(argv[++i]);
    } else if (a === "--airports" && argv[i + 1]) {
      opts.airports = argv[++i]
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{3}$/.test(c));
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/fill-gap-aviationstack.mjs [options]

Fills today + 6 days using Aviationstack /v1/timetable (1 IATA per request).
Uses Aviation Edge only for airport-country cache / gap fallback.

Options:
  --key KEY            Aviationstack access key (or AVIATIONSTACK_ACCESS_KEY)
  --max-requests N     Cap API calls (default: 95, plan limit often 100)
  --delay MS           Pause between calls (default: ${aviationstack.minDelayMs})
  --airports LIST      Comma-separated IATA (default: all 15 seed airports)
  --force              Overwrite existing cache
  --edge-fallback      Use Aviation Edge history for gaps (extra AE API calls)
  --no-project-from-today  Do not copy today's timetable to future dates
  --dry-run            Print planned requests only
`);
      process.exit(0);
    }
  }
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(arrIata, offset, delayMs, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchTimetablePage(arrIata, {
        offset,
        limit: aviationstack.pageLimit,
      });
    } catch (err) {
      lastErr = err;
      if (err.code !== "RATE_LIMIT" || attempt === maxAttempts) throw err;
      const wait = delayMs * attempt;
      console.warn(`  rate limit — wait ${wait}ms (attempt ${attempt})…`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function saveScope(date, arrIata, canonical, meta, { projected = false } = {}) {
  await saveRawCache(date, arrIata, {
    scheduleMode: projected ? "aviationstack-projected" : "aviationstack",
    coverageNote: projected
      ? meta.coverageNote
      : coverageNoteFor(date),
    provider: "aviationstack",
    ...meta,
    canonical,
  });
  const flights = await normalizeSchedules(canonical, date, arrIata);
  await saveNormalized(date, arrIata, flights);
  return flights.length;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.accessKey) {
    aviationstack.accessKey = opts.accessKey;
  }

  if (!opts.fromCacheOnly && !aviationstack.accessKey) {
    console.error("Set AVIATIONSTACK_ACCESS_KEY or pass --key");
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

  const targetDates = enumerateTargetDates();
  const today = targetDates[0];

  console.log("Flight Scheduler — fill gap via Aviationstack");
  console.log(`Dates: ${targetDates[0]} … ${targetDates[targetDates.length - 1]}`);
  console.log(`Airports: ${airports.length} | max requests: ${opts.maxRequests}`);
  console.log(
    `Delay: ${opts.delayMs}ms | project from today: ${opts.projectFromToday} | edge fallback: ${opts.edgeFallback}`,
  );
  console.log("");

  console.log(
    `Phase 1: ${airports.length} request(s) — page 0 per airport. Phase 2: pagination within budget.`,
  );

  function extractCanonical(cached) {
    const payload = cached?.response;
    if (Array.isArray(payload?.canonical)) return payload.canonical;
    return [];
  }

  if (opts.dryRun) {
    for (const a of airports) {
      console.log(`  GET timetable iataCode=${a.iata} offset=0`);
    }
    console.log("\nDry run — phase 2 adds offset=100,200,… where total > 100.");
    process.exit(0);
  }

  const startedAt = new Date().toISOString();
  let requestsUsed = 0;
  const airportState = new Map();
  const todayDate = targetDates[0];

  if (opts.fromCacheOnly) {
    console.log("Loading today's cached timetable rows (no Aviationstack API calls)…");
    for (const airport of airports) {
      const arrIata = airport.iata;
      let cached = null;
      try {
        cached = await loadRawCache(todayDate, arrIata);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      const canonical = cached ? extractCanonical(cached) : [];
      airportState.set(arrIata, {
        canonical,
        buckets: bucketCanonicalByDate(canonical, targetDates),
        rawPages: [],
        total: canonical.length,
      });
    }
  } else {
  async function fetchPage(arrIata, offset) {
    if (requestsUsed > 0) await sleep(opts.delayMs);
    const label = `${arrIata} offset=${offset}`;
    process.stdout.write(`[${requestsUsed + 1}/${opts.maxRequests}] ${label} … `);
    const page = await fetchWithRetry(arrIata, offset, opts.delayMs);
    requestsUsed += 1;
    console.log(`+${page.items.length} (total ${page.pagination?.total ?? "?"})`);
    return page;
  }

  /** @type {{ arrIata: string, total: number }[]} */
  const needsMorePages = [];

  for (const airport of airports) {
    if (requestsUsed >= opts.maxRequests) break;
    const arrIata = airport.iata;
    const page = await fetchPage(arrIata, 0);
    const canonical = page.items.map((row) =>
      stackTimetableRowToCanonical(row, arrIata),
    );
    const total = page.pagination?.total ?? canonical.length;
    const rawPages = [{ offset: 0, pagination: page.pagination }];

    airportState.set(arrIata, {
      canonical,
      buckets: bucketCanonicalByDate(canonical, targetDates),
      rawPages,
      total,
    });

    if (total > aviationstack.pageLimit) {
      needsMorePages.push({ arrIata, total });
    }
  }

  needsMorePages.sort((a, b) => b.total - a.total);

  for (const { arrIata, total } of needsMorePages) {
    let offset = aviationstack.pageLimit;
    while (requestsUsed < opts.maxRequests && offset < total) {
      const page = await fetchPage(arrIata, offset);
      const state = airportState.get(arrIata);
      for (const row of page.items) {
        state.canonical.push(stackTimetableRowToCanonical(row, arrIata));
      }
      state.rawPages.push({ offset, pagination: page.pagination });
      state.buckets = bucketCanonicalByDate(state.canonical, targetDates);
      offset += aviationstack.pageLimit;
      if (page.items.length === 0) break;
    }
    if (offset < total) {
      console.warn(`  ${arrIata}: stopped at offset ${offset}/${total} (budget).`);
    }
  }

  for (const [arrIata, state] of airportState) {
    state.dateCounts = Object.fromEntries(
      targetDates.map((d) => [d, state.buckets.get(d)?.length ?? 0]),
    );
  }
  }

  let saved = 0;
  let projected = 0;
  let skipped = 0;
  let empty = 0;
  let edgeFilled = 0;
  const errors = [];
  for (const date of targetDates) {
    for (const airport of airports) {
      const arrIata = airport.iata;
      const label = `${date} ${arrIata}`;

      if (!opts.force && (await hasRawCache(date, arrIata))) {
        skipped += 1;
        continue;
      }

      const state = airportState.get(arrIata);
      let rows = state?.buckets?.get(date) ?? [];
      let isProjected = false;
      let coverageNote = coverageNoteFor(date);

      if (
        rows.length === 0 &&
        opts.projectFromToday &&
        date !== todayDate &&
        state
      ) {
        const todayRows = state.buckets?.get(todayDate) ?? state.canonical ?? [];
        if (todayRows.length > 0) {
          rows = projectCanonicalToDate(todayRows, date);
          isProjected = true;
          coverageNote = projectedCoverageNote(todayDate, date);
        }
      }

      if (rows.length > 0) {
        try {
          const n = await saveScope(
            date,
            arrIata,
            rows,
            {
              raw: {
                provider: "aviationstack",
                endpoint: "timetable",
                fetchedAt: new Date().toISOString(),
                pages: state?.rawPages,
                projectedFrom: isProjected ? todayDate : undefined,
              },
              coverageNote,
            },
            { projected: isProjected },
          );
          if (isProjected) {
            projected += 1;
            console.log(`${label} — projected from ${todayDate} (${n} RU-speaking)`);
          } else {
            saved += 1;
            console.log(`${label} — saved ${n} RU-speaking flights`);
          }
        } catch (err) {
          errors.push({ date, arrIata, message: err.message });
          console.error(`${label} — save FAIL: ${err.message}`);
        }
        continue;
      }

      if (opts.edgeFallback) {
        try {
          const result = await loadScopeFromProjection(date, arrIata);
          edgeFilled += 1;
          console.log(
            `${label} — edge projection from ${result.projectedFrom} (ru=${result.filteredCount})`,
          );
        } catch (err) {
          empty += 1;
          errors.push({ date, arrIata, message: err.message });
          console.log(`${label} — empty: ${err.message}`);
        }
      } else {
        empty += 1;
        console.log(`${label} — no data`);
      }
    }
  }

  const manifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    today,
    targetDates,
    provider: "aviationstack",
    endpoint: "timetable",
    airports: airports.map((a) => a.iata),
    requestsUsed,
    maxRequests: opts.maxRequests,
    stats: { saved, projected, skipped, empty, edgeFilled, errors: errors.length },
    perAirport: [...airportState.entries()].map(([iata, s]) => ({
      iata,
      timetableRows: s.canonical.length,
      dateCounts: s.dateCounts,
      pagesFetched: s.rawPages.length,
    })),
    errors: errors.slice(0, 50),
  };

  const manifestPath = path.join(
    paths.rawCache,
    "..",
    "fill-gap-aviationstack-manifest.json",
  );
  await writeJson(manifestPath, manifest);

  console.log("\n=== Aviationstack fill complete ===");
  console.log(
    `API requests: ${requestsUsed} | saved: ${saved} | projected: ${projected} | skipped: ${skipped} | edge: ${edgeFilled} | empty: ${empty}`,
  );
  console.log(`Manifest: ${path.relative(ROOT, manifestPath)}`);
  if (empty > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
