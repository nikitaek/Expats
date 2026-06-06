#!/usr/bin/env node
import { parseArgs } from "../src/shared/lib/cli-args.js";
import { splitDateRange } from "../src/shared/fr24/client.js";
import { loadEnabledRoutes, batchRoutes } from "../src/shared/lib/routes-seed.js";
import { getSchedulerPolicy } from "../src/shared/config/limits.js";
import {
  runFr24RoutesJob,
  runFr24LiveJob,
} from "../src/services/downloader/jobs/fr24-routes.js";
import {
  createRouteFetchJob,
  createLiveFetchJob,
} from "../src/shared/contracts/job.js";
import {
  isFetchableStart,
  todayUTC,
  clampDateFrom,
  fr24PlanDataFrom,
  isWithinPlanRange,
} from "../src/shared/lib/dates.js";

const args = parseArgs();

const dataKind = args.data_kind || "actual";
const force = Boolean(args.force);
const policy = await getSchedulerPolicy();

let routeBatches;
if (args.routes) {
  const routes = args.routes.split(",").map((r) => r.trim());
  routeBatches = [routes];
} else {
  const routes = await loadEnabledRoutes();
  routeBatches = batchRoutes(routes, policy.routesPerRequest || 15);
}

if (!["actual", "upcoming"].includes(dataKind)) {
  console.error(
    `Unknown --data-kind ${dataKind}. Use actual (history) or upcoming (live in-air snapshot).`,
  );
  process.exit(1);
}

if (dataKind === "upcoming") {
  const captureDate = todayUTC();
  const liveLimit = Number(args.limit) || 2000;
  const totalJobs = routeBatches.length;
  console.log(
    `download: upcoming (live positions) ${captureDate} | ${routeBatches.length} batch(es) = ${totalJobs} job(s)`,
  );

  const results = [];
  const failures = [];
  let jobIndex = 0;
  for (const routes of routeBatches) {
    jobIndex++;
    console.log(`\n--- job ${jobIndex}/${totalJobs} ---`);
    const job = createLiveFetchJob({ routes, captureDate });
    try {
      results.push(await runFr24LiveJob(job, { force, limit: liveLimit }));
    } catch (err) {
      failures.push({ jobId: job.jobId, error: err.message });
      results.push({ ...job, status: "failed", error: err.message });
      console.error(`[error] ${job.jobId}: ${err.message}`);
    }
  }

  const summary = {
    ok: failures.length === 0,
    jobs: results.length,
    completed: results.filter((r) => r.status === "completed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    totalRows: results.reduce((n, r) => n + (r.rowCount || 0), 0),
    failures,
  };
  console.log("\n" + JSON.stringify(summary, null, 2));
  process.exit(failures.length > 0 ? 1 : 0);
}

if (!args.date_from || !args.date_to) {
  console.error(
    "Usage: npm run download -- --data-kind actual --date-from YYYY-MM-DD --date-to YYYY-MM-DD [--routes A-B,C-D] [--force]\n" +
      "       npm run download -- --data-kind upcoming [--routes A-B,C-D] [--limit N] [--force]",
  );
  process.exit(1);
}

const planMin = fr24PlanDataFrom();
const clampedFrom = clampDateFrom(args.date_from, planMin);
if (clampedFrom !== args.date_from) {
  console.log(
    `note: clamping date_from ${args.date_from} → ${clampedFrom} ` +
      `(FR24 plan data starts ${planMin}; Jan–Apr not available on this subscription)`,
  );
}
if (clampedFrom > args.date_to) {
  console.error(
    `Nothing to download: requested range ends ${args.date_to} but plan data starts ${planMin}.`,
  );
  process.exit(1);
}

const allChunks = splitDateRange(clampedFrom, args.date_to, 14);

// FR24 flight-summary is past-only: date_from must be <= today (UTC).
// Drop future-start chunks up front so we never spend API requests on 400s.
const today = todayUTC();
const fetchableChunks = allChunks.filter(
  (c) => isFetchableStart(c.dateFrom, today) && isWithinPlanRange(c.dateFrom, planMin),
);
const futureChunks = allChunks.filter((c) => !isFetchableStart(c.dateFrom, today));
const beforePlanChunks = allChunks.filter((c) => !isWithinPlanRange(c.dateFrom, planMin));

if (beforePlanChunks.length > 0) {
  console.log(
    `note: skipping ${beforePlanChunks.length} chunk(s) before plan minimum ${planMin}`,
  );
}
if (futureChunks.length > 0) {
  console.log(
    `note: skipping ${futureChunks.length} future chunk(s) (date_from after today ${today}); ` +
      `FR24 flight-summary only returns flights with a start date today or earlier:`,
  );
  for (const c of futureChunks) {
    console.log(`  - ${c.dateFrom}..${c.dateTo}`);
  }
}

if (fetchableChunks.length === 0) {
  console.error(
    `\nNothing to download: every chunk in ${args.date_from}..${args.date_to} starts after today (${today}).`,
  );
  process.exit(1);
}

const totalJobs = fetchableChunks.length * routeBatches.length;
const results = [];

console.log(
  `download: ${dataKind} ${args.date_from}..${args.date_to} | ${routeBatches.length} batch(es) × ${fetchableChunks.length} fetchable chunk(s) = ${totalJobs} job(s)`,
);

let jobIndex = 0;
const failures = [];

for (const chunk of fetchableChunks) {
  for (const routes of routeBatches) {
    jobIndex++;
    console.log(`\n--- job ${jobIndex}/${totalJobs} ---`);
    const job = createRouteFetchJob({
      dataKind,
      dateFrom: chunk.dateFrom,
      dateTo: chunk.dateTo,
      routes,
    });
    try {
      const result = await runFr24RoutesJob(job, { force });
      results.push(result);
    } catch (err) {
      failures.push({ jobId: job.jobId, error: err.message });
      results.push({ ...job, status: "failed", error: err.message });
      console.error(`[error] ${job.jobId}: ${err.message}`);
    }
  }
}

const summary = {
  ok: failures.length === 0,
  jobs: results.length,
  completed: results.filter((r) => r.status === "completed").length,
  skipped: results.filter((r) => r.status === "skipped").length,
  skippedFuture: futureChunks.length * routeBatches.length,
  failed: results.filter((r) => r.status === "failed").length,
  totalRows: results.reduce((n, r) => n + (r.rowCount || 0), 0),
  failures,
};
console.log("\n" + JSON.stringify(summary, null, 2));
if (failures.length > 0) process.exit(1);
