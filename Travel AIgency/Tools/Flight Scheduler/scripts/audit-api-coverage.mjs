#!/usr/bin/env node
/**
 * Build an API-only coverage audit without changing dashboard totals.
 *
 * Default mode is read-only: it scans cache/status metadata and writes a
 * timestamped manifest. Add --load to fetch missing scopes from Aviation Edge.
 */
import "dotenv/config";
import path from "node:path";
import { aviationEdge, paths } from "../server/config.js";
import { enumerateDates, getRangeStatus } from "../server/services/aggregate.js";
import { resolveAirportList } from "../server/services/aggregate.js";
import { loadScopeFromApi } from "../server/services/scheduler.js";
import { writeJson } from "../server/lib/fs-json.js";

const DEFAULT_MONTHS = "2026-06:2027-05";

function parseArgs(argv) {
  const opts = {
    months: DEFAULT_MONTHS,
    airports: "ALL",
    load: false,
    delayMs: 400,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--load") opts.load = true;
    else if (a === "--months" && argv[i + 1]) opts.months = argv[++i];
    else if (a === "--airports" && argv[i + 1]) opts.airports = argv[++i];
    else if (a === "--delay" && argv[i + 1]) opts.delayMs = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/audit-api-coverage.mjs [options]

Options:
  --months A:B       Inclusive month range (default: ${DEFAULT_MONTHS})
  --airports LIST    ALL or comma-separated IATA codes (default: ALL)
  --load             Fetch missing scopes from Aviation Edge before reporting
  --delay MS         Pause between API loads when --load is used (default: 400)
  --help             Show this help

Examples:
  npm run audit:api -- --airports DAD,CXR,SGN,HAN,PQC
  npm run audit:api -- --months 2026-06:2026-06 --airports DAD --load
`);
      process.exit(0);
    }
  }
  return opts;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Invalid month "${month}". Use YYYY-MM.`);
  }
  return month;
}

function addMonths(month, count) {
  const d = new Date(`${month}-01T12:00:00`);
  d.setMonth(d.getMonth() + count);
  return d.toISOString().slice(0, 7);
}

function monthRange(range) {
  const [fromRaw, toRaw = fromRaw] = range.split(":");
  const from = parseMonth(fromRaw);
  const to = parseMonth(toRaw);
  if (from > to) throw new Error("--months start must be before end.");

  const months = [];
  for (let cursor = from; cursor <= to; cursor = addMonths(cursor, 1)) {
    months.push(cursor);
  }
  return months;
}

function monthBounds(month) {
  const first = `${month}-01`;
  const d = new Date(`${first}T12:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return { dateFrom: first, dateTo: d.toISOString().slice(0, 10) };
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function loadMissingScopes(status, delayMs) {
  const jobs = status.missingScopes.map((s) => ({
    date: s.date,
    arrIata: s.arrIata,
  }));
  const results = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const label = `[${i + 1}/${jobs.length}] ${job.date} ${job.arrIata}`;
    try {
      const data = await loadScopeFromApi(job.date, job.arrIata);
      results.push({
        ...job,
        ok: true,
        totalIncoming: data.totalIncoming,
        filteredCount: data.filteredCount,
        scheduleMode: data.scheduleMode,
      });
      console.log(`${label} OK total=${data.totalIncoming} ru=${data.filteredCount}`);
    } catch (err) {
      results.push({
        ...job,
        ok: false,
        code: err.code,
        error: err.message,
        details: err.details,
      });
      console.log(`${label} ${err.code || "ERROR"} ${err.message}`);
    }
    if (delayMs > 0 && i < jobs.length - 1) await sleep(delayMs);
  }

  return results;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.load && !aviationEdge.apiKey) {
    console.error("AVIATION_EDGE_API_KEY is missing. Set it in .env or omit --load.");
    process.exit(1);
  }

  const airports = await resolveAirportList(opts.airports);
  if (airports.error) {
    console.error(airports.error);
    process.exit(1);
  }

  const months = monthRange(opts.months);
  const startedAt = new Date().toISOString();
  const monthly = [];
  const loadResults = [];

  console.log("Flight Scheduler — API coverage audit");
  console.log(`Months: ${months[0]} … ${months[months.length - 1]}`);
  console.log(`Airports: ${airports.join(", ")}`);
  console.log(`Mode: ${opts.load ? "load missing scopes from API" : "read metadata only"}`);

  for (const month of months) {
    const { dateFrom, dateTo } = monthBounds(month);
    const statusBefore = await getRangeStatus(dateFrom, dateTo, airports);
    let loaded = [];

    if (opts.load && statusBefore.scopesMissing > 0) {
      loaded = await loadMissingScopes(statusBefore, opts.delayMs);
      loadResults.push({ month, results: loaded });
    }

    const status = opts.load
      ? await getRangeStatus(dateFrom, dateTo, airports)
      : statusBefore;
    monthly.push({
      month,
      dateFrom,
      dateTo,
      days: enumerateDates(dateFrom, dateTo).length,
      scopesTotal: status.scopesTotal,
      completeScopes: status.completeScopes,
      staleScopes: status.staleScopes,
      emptyApiScopes: status.emptyApiScopes,
      errorScopes: status.errorScopes,
      scopesMissing: status.scopesMissing,
      coveragePct: status.coveragePct,
      isComplete: status.isComplete,
      coverageByAirportMonth: status.coverageByAirportMonth,
    });

    console.log(
      `${month}: coverage=${status.coveragePct}% cached=${status.completeScopes}/${status.scopesTotal} empty=${status.emptyApiScopes} errors=${status.errorScopes} missing=${status.scopesMissing}`,
    );
  }

  const manifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    months,
    airports,
    loadedFromApi: opts.load,
    delayMs: opts.delayMs,
    monthly,
    loadResults,
  };

  const out = path.join(paths.auditReports, `api-coverage-${timestampForFile()}.json`);
  await writeJson(out, manifest);
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
