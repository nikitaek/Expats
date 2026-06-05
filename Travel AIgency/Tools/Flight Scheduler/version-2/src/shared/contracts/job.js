import crypto from "node:crypto";

/** @typedef {'pending' | 'running' | 'completed' | 'skipped' | 'failed' | 'failed_permanent'} JobStatus */

/**
 * @typedef {Object} RouteFetchJob
 * @property {string} jobId
 * @property {string} jobType
 * @property {import('./flight.js').DataKind} dataKind
 * @property {string} dateFrom
 * @property {string} dateTo
 * @property {string[]} routes
 * @property {JobStatus} status
 * @property {number} requestCount
 * @property {number} rowCount
 * @property {string} startedAt
 * @property {string|null} finishedAt
 * @property {string[]} rawRefs
 * @property {string} batchHash
 * @property {string} windowKey
 */

export function routeBatchHash(routes) {
  const sorted = [...routes].sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex").slice(0, 6);
}

export function windowKey(dateFrom, dateTo) {
  return `${dateFrom}_${dateTo}`;
}

export function rawRoutesPrefix(dateFrom, dateTo, batchHash) {
  return `raw/routes/${windowKey(dateFrom, dateTo)}/${batchHash}`;
}

export function canonicalFlightsPrefix(dateFrom, dateTo, batchHash) {
  return `canonical/flights/${windowKey(dateFrom, dateTo)}/${batchHash}`;
}

/** Raw live-positions snapshot, keyed by capture date (UTC). */
export function rawLivePrefix(captureDate, batchHash) {
  return `raw/live/${captureDate}/${batchHash}`;
}

/** Canonical output for a live snapshot, reuses the flights/ tree. */
export function canonicalLivePrefix(captureDate, batchHash) {
  return `canonical/flights/live_${captureDate}/${batchHash}`;
}

export function createLiveFetchJob({ routes, captureDate, status = "pending" }) {
  const batchHash = routeBatchHash(routes);
  const jobId = `fr24-live-upcoming-${captureDate}-${batchHash}`;
  const now = new Date().toISOString();
  return {
    jobId,
    jobType: "fr24.live.fetch",
    dataKind: "upcoming",
    captureDate,
    routes: [...routes].sort(),
    status,
    requestCount: 0,
    rowCount: 0,
    startedAt: now,
    finishedAt: null,
    rawRefs: [],
    batchHash,
    query: { routes: [...routes].sort() },
  };
}

export function buildJobId({ dataKind, dateFrom, dateTo, routes }) {
  const hash = routeBatchHash(routes);
  return `fr24-routes-${dataKind}-${dateFrom}-${dateTo}-${hash}`;
}

export function createRouteFetchJob({
  dataKind,
  dateFrom,
  dateTo,
  routes,
  status = "pending",
}) {
  const batchHash = routeBatchHash(routes);
  const jobId = buildJobId({ dataKind, dateFrom, dateTo, routes });
  const now = new Date().toISOString();
  return {
    jobId,
    jobType: "fr24.routes.fetch",
    dataKind,
    dateFrom,
    dateTo,
    routes: [...routes].sort(),
    status,
    requestCount: 0,
    rowCount: 0,
    startedAt: now,
    finishedAt: null,
    rawRefs: [],
    batchHash,
    windowKey: windowKey(dateFrom, dateTo),
    query: { routes: [...routes].sort() },
  };
}
