import { fetchRoutes, fetchLivePositions } from "../../../shared/fr24/client.js";
import {
  rawRoutesPrefix,
  rawLivePrefix,
  createRouteFetchJob,
} from "../../../shared/contracts/job.js";
import * as objectStore from "../../../shared/storage/object-store.js";
import { saveJobManifest } from "../../../shared/lib/job-store.js";
import { getSchedulerPolicy } from "../../../shared/config/limits.js";
import { isFetchableStart, todayUTC } from "../../../shared/lib/dates.js";

function logProgress(message) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${message}`);
}

/**
 * @param {import('../../../shared/contracts/job.js').RouteFetchJob} job
 * @param {{ force?: boolean; onProgress?: (msg: string) => void }} opts
 */
export async function runFr24RoutesJob(job, { force = false, onProgress } = {}) {
  const progress = onProgress || logProgress;
  const prefix = rawRoutesPrefix(job.dateFrom, job.dateTo, job.batchHash);
  const responseKey = `${prefix}/response.json`;
  const manifestKey = `${prefix}/manifest.json`;

  // FR24 flight-summary rejects a future date_from ("must be a date before
  // tomorrow"). Skip without spending an API request.
  if (!isFetchableStart(job.dateFrom)) {
    progress(
      `skip ${job.jobId} (date_from ${job.dateFrom} is after today ${todayUTC()} — FR24 flight-summary is past-only)`,
    );
    job.status = "skipped_future";
    job.requestCount = 0;
    job.rowCount = 0;
    job.rawRefs = [];
    job.finishedAt = new Date().toISOString();
    return job;
  }

  if (!force && (await objectStore.headObject(responseKey))) {
    progress(`skip ${job.jobId} (response already exists)`);
    job.status = "skipped";
    job.finishedAt = new Date().toISOString();
    await saveJobManifest(job);
    await objectStore.putObject(manifestKey, job);
    return job;
  }

  if (!force && (await objectStore.headObject(manifestKey))) {
    const existing = await objectStore.getObject(manifestKey);
    if (existing?.status === "completed" || existing?.status === "skipped") {
      progress(`skip ${job.jobId} (manifest ${existing.status})`);
      return existing;
    }
  }

  const policy = await getSchedulerPolicy();
  const delayMs = policy.minRequestDelayMs || 3500;

  job.status = "running";
  job.startedAt = new Date().toISOString();

  const requestPayload = {
    dateFrom: job.dateFrom,
    dateTo: job.dateTo,
    routes: job.routes,
    dataKind: job.dataKind,
  };

  await objectStore.putObject(`${prefix}/request.json`, requestPayload);
  progress(
    `fetch ${job.dataKind} ${job.dateFrom}..${job.dateTo} routes=${job.routes.join(",")} → ${prefix}/`,
  );

  if (delayMs > 0) {
    progress(`rate-limit wait ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  let rows = [];
  try {
    progress(`calling FR24 flight-summary/full…`);
    rows = await fetchRoutes({
      dateFrom: job.dateFrom,
      dateTo: job.dateTo,
      routes: job.routes,
    });
    job.requestCount = 1;
    job.rowCount = rows.length;
    job.status = "completed";
    job.finishedAt = new Date().toISOString();

    if (rows.length > 0) {
      await objectStore.putObject(responseKey, { data: rows });
      job.rawRefs = [responseKey];
      progress(`saved ${responseKey} (${rows.length} flights)`);
    } else {
      job.rawRefs = [];
      progress(`no flights — manifest only (no response.json)`);
    }

    await objectStore.putObject(manifestKey, job);
    await saveJobManifest(job);
    progress(`done ${job.jobId} status=${job.status} rows=${job.rowCount}`);
    return job;
  } catch (err) {
    progress(`failed ${job.jobId}: ${err.message}`);
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = err.message;
    await objectStore.putObject(manifestKey, job);
    await saveJobManifest(job);
    throw err;
  }
}

/**
 * Live flight-positions fetch (data_kind=upcoming). FR24 has no timetable
 * endpoint; this captures flights airborne now on the given routes with ETAs.
 * @param {import('../../../shared/contracts/job.js').RouteFetchJob} job
 * @param {{ force?: boolean; onProgress?: (msg: string) => void; limit?: number }} opts
 */
export async function runFr24LiveJob(
  job,
  { force = false, onProgress, limit = 2000 } = {},
) {
  const progress = onProgress || logProgress;
  const prefix = rawLivePrefix(job.captureDate, job.batchHash);
  const responseKey = `${prefix}/response.json`;
  const manifestKey = `${prefix}/manifest.json`;

  if (!force && (await objectStore.headObject(responseKey))) {
    progress(`skip ${job.jobId} (live snapshot already captured today)`);
    job.status = "skipped";
    job.finishedAt = new Date().toISOString();
    await saveJobManifest(job);
    await objectStore.putObject(manifestKey, job);
    return job;
  }

  const policy = await getSchedulerPolicy();
  const delayMs = policy.minRequestDelayMs || 3500;

  job.status = "running";
  job.startedAt = new Date().toISOString();

  await objectStore.putObject(`${prefix}/request.json`, {
    routes: job.routes,
    dataKind: job.dataKind,
    capturedAt: job.startedAt,
  });
  progress(
    `fetch upcoming (live positions) routes=${job.routes.join(",")} → ${prefix}/`,
  );

  if (delayMs > 0) {
    progress(`rate-limit wait ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  try {
    progress(`calling FR24 live/flight-positions/full…`);
    const rows = await fetchLivePositions({ routes: job.routes, limit });
    job.requestCount = 1;
    job.rowCount = rows.length;
    job.status = "completed";
    job.finishedAt = new Date().toISOString();

    if (rows.length > 0) {
      await objectStore.putObject(responseKey, {
        data: rows,
        capturedAt: job.finishedAt,
      });
      job.rawRefs = [responseKey];
      progress(`saved ${responseKey} (${rows.length} airborne flights)`);
    } else {
      job.rawRefs = [];
      progress(`no airborne flights on these routes — manifest only`);
    }

    await objectStore.putObject(manifestKey, job);
    await saveJobManifest(job);
    progress(`done ${job.jobId} status=${job.status} rows=${job.rowCount}`);
    return job;
  } catch (err) {
    progress(`failed ${job.jobId}: ${err.message}`);
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = err.message;
    await objectStore.putObject(manifestKey, job);
    await saveJobManifest(job);
    throw err;
  }
}
