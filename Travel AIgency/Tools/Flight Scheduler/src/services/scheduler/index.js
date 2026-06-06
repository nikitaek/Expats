import { splitDateRange } from "../../shared/fr24/client.js";
import { createRouteFetchJob } from "../../shared/contracts/job.js";
import { getSchedulerPolicy } from "../../shared/config/limits.js";
import { loadEnabledRoutes, batchRoutes } from "../../shared/lib/routes-seed.js";
import { listJobManifests } from "../../shared/lib/job-store.js";
import { daysAgo, daysAhead, formatDateInTz } from "../../shared/lib/dates.js";
import { runFr24RoutesJob } from "../downloader/jobs/fr24-routes.js";
import { parseBatch } from "../parser/index.js";
import { enrichDateWindow } from "../enrichment/index.js";
import { loadDateWindow } from "../loader/index.js";
import { writeReport } from "../reporter/index.js";
import * as objectStore from "../../shared/storage/object-store.js";

/**
 * Build due fetch windows from policy.
 */
export function buildDueWindows(policy, now = new Date()) {
  const tz = policy.timezone || "Asia/Ho_Chi_Minh";
  const today = formatDateInTz(now, tz);
  const windows = [];

  if (policy.upcoming?.enabled !== false) {
    windows.push({
      kind: "upcoming",
      dataKind: "upcoming",
      dateFrom: today,
      dateTo: daysAhead(policy.upcoming?.hoursAhead ? Math.ceil(policy.upcoming.hoursAhead / 24) : 3, tz),
      priority: policy.priorityOrder?.indexOf("upcoming") ?? 0,
    });
  }

  if (policy.actual?.enabled !== false && policy.actual?.yesterday !== false) {
    const yesterday = daysAgo(1, tz);
    windows.push({
      kind: "actual_yesterday",
      dataKind: "actual",
      dateFrom: yesterday,
      dateTo: yesterday,
      priority: policy.priorityOrder?.indexOf("actual_yesterday") ?? 1,
    });
  }

  if (policy.actual?.enabled !== false && (policy.actual?.repairDays || 0) > 0) {
    const repairDays = policy.actual.repairDays;
    windows.push({
      kind: "actual_repair",
      dataKind: "actual",
      dateFrom: daysAgo(repairDays, tz),
      dateTo: daysAgo(2, tz),
      priority: policy.priorityOrder?.indexOf("actual_repair") ?? 2,
    });
  }

  return windows.sort((a, b) => a.priority - b.priority);
}

function jobAlreadyDone(existingJobs, jobId) {
  return existingJobs.some(
    (j) =>
      j.jobId === jobId &&
      (j.status === "completed" || j.status === "skipped"),
  );
}

function countRequestsToday(jobs, today) {
  return jobs.filter(
    (j) =>
      j.startedAt?.startsWith(today) &&
      j.status === "completed" &&
      j.requestCount > 0,
  ).length;
}

/**
 * Run one scheduler tick: create jobs, download, parse, enrich, load, report.
 */
export async function runSchedulerTick({
  force = false,
  maxBatches,
  skipLoad = false,
  skipReport = false,
} = {}) {
  const policy = await getSchedulerPolicy();
  const routes = await loadEnabledRoutes();
  const routeBatches = batchRoutes(routes, policy.routesPerRequest || 15);
  const windows = buildDueWindows(policy);
  const tz = policy.timezone || "Asia/Ho_Chi_Minh";
  const today = formatDateInTz(new Date(), tz);

  const existingJobs = await listJobManifests({ sinceDay: daysAgo(14, tz) });
  let requestsUsed = countRequestsToday(existingJobs, today);
  const maxPerRun = policy.maxRequestsPerCronRun || 20;
  const maxPerDay = policy.maxRequestsPerDay || 80;

  const completed = [];
  let batchesRun = 0;

  for (const window of windows) {
    const chunks = splitDateRange(window.dateFrom, window.dateTo, 14);

    for (const chunk of chunks) {
      for (const routeBatch of routeBatches) {
        if (maxBatches != null && batchesRun >= maxBatches) break;
        if (requestsUsed >= maxPerDay) break;
        if (batchesRun >= maxPerRun) break;

        const job = createRouteFetchJob({
          dataKind: window.dataKind,
          dateFrom: chunk.dateFrom,
          dateTo: chunk.dateTo,
          routes: routeBatch,
        });

        if (!force && jobAlreadyDone(existingJobs, job.jobId)) {
          continue;
        }

        const result = await runFr24RoutesJob(job, { force });
        batchesRun++;
        if (result.status === "completed" && result.requestCount > 0) {
          requestsUsed++;
        }

        if (result.rowCount > 0) {
          await parseBatch({
            dateFrom: chunk.dateFrom,
            dateTo: chunk.dateTo,
            batchHash: job.batchHash,
            dataKind: window.dataKind,
          });
        }

        completed.push(result);
        existingJobs.push(result);
      }
    }

    if (!skipLoad) {
      for (const chunk of splitDateRange(window.dateFrom, window.dateTo, 14)) {
        await enrichDateWindow({
          dateFrom: chunk.dateFrom,
          dateTo: chunk.dateTo,
        });
        try {
          await loadDateWindow({
            dateFrom: chunk.dateFrom,
            dateTo: chunk.dateTo,
          });
        } catch (err) {
          if (!err.message?.includes("BIGQUERY_PROJECT")) throw err;
          console.warn("[scheduler] BigQuery load skipped:", err.message);
        }
      }
    }

    if (!skipReport) {
      try {
        await writeReport({
          dataKind: window.dataKind,
          dateFrom: window.dateFrom,
          dateTo: window.dateTo,
        });
      } catch (err) {
        if (!err.message?.includes("BIGQUERY_PROJECT")) throw err;
        console.warn("[scheduler] Report skipped:", err.message);
      }
    }
  }

  return { batchesRun, jobs: completed };
}

/**
 * Bootstrap: download all enabled routes for ±30d in 14-day chunks.
 */
export async function runBootstrap({
  daysBack = 30,
  daysForward = 30,
  dataKind = "actual",
  force = false,
} = {}) {
  const policy = await getSchedulerPolicy();
  const routes = await loadEnabledRoutes();
  const routeBatches = batchRoutes(routes, policy.routesPerRequest || 15);
  const tz = policy.timezone || "Asia/Ho_Chi_Minh";
  const dateFrom = daysAgo(daysBack, tz);
  const dateTo = daysAhead(daysForward, tz);
  const chunks = splitDateRange(dateFrom, dateTo, 14);
  const jobs = [];

  for (const chunk of chunks) {
    for (const routeBatch of routeBatches) {
      const job = createRouteFetchJob({
        dataKind,
        dateFrom: chunk.dateFrom,
        dateTo: chunk.dateTo,
        routes: routeBatch,
      });
      const result = await runFr24RoutesJob(job, { force });
      if (result.rowCount > 0) {
        await parseBatch({
          dateFrom: chunk.dateFrom,
          dateTo: chunk.dateTo,
          batchHash: job.batchHash,
          dataKind,
        });
      }
      jobs.push(result);
    }
  }

  for (const chunk of chunks) {
    await enrichDateWindow({ dateFrom: chunk.dateFrom, dateTo: chunk.dateTo });
    try {
      await loadDateWindow({ dateFrom: chunk.dateFrom, dateTo: chunk.dateTo });
    } catch (err) {
      console.warn("[bootstrap] BigQuery load skipped:", err.message);
    }
  }

  return { dateFrom, dateTo, jobs };
}

/**
 * List routes that appear in any canonical/flights/ object (bootstrap prune).
 */
export async function routesWithFlightsFromCanonical() {
  const keys = await objectStore.listPrefix("canonical/flights/");
  const routes = new Set();

  for (const key of keys.filter((k) => k.endsWith("/flights.json"))) {
    const body = await objectStore.getObject(key);
    for (const f of body.flights || []) {
      if (f.route) routes.add(f.route);
    }
  }

  return routes;
}
