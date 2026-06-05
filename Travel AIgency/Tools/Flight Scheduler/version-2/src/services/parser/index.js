import {
  fr24ToCanonical,
  livePositionToCanonical,
} from "../../shared/fr24/adapters.js";
import {
  canonicalFlightsPrefix,
  canonicalLivePrefix,
  rawRoutesPrefix,
} from "../../shared/contracts/job.js";
import * as objectStore from "../../shared/storage/object-store.js";

/**
 * Parse all response.json under a raw prefix. Handles both
 * `raw/routes/<from>_<to>/<hash>/` (flight-summary) and
 * `raw/live/<captureDate>/<hash>/` (live positions).
 * @param {string} prefix
 */
export async function parsePrefix(prefix) {
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const keys = await objectStore.listPrefix(normalized);
  const responseKeys = keys.filter((k) => k.endsWith("/response.json"));

  const results = [];

  for (const responseKey of responseKeys) {
    const parts = responseKey.split("/");
    const batchHash = parts[parts.length - 2];
    const windowPart = parts[parts.length - 3];
    const isLive = parts.includes("live");

    const manifestKey = responseKey.replace("/response.json", "/manifest.json");
    let dataKind = isLive ? "upcoming" : "actual";
    if (await objectStore.headObject(manifestKey)) {
      const manifest = await objectStore.getObject(manifestKey);
      dataKind = manifest.dataKind || dataKind;
    }

    const body = await objectStore.getObject(responseKey);
    const rows = body?.data || [];
    const flights = rows
      .map((row) =>
        isLive
          ? livePositionToCanonical(row, dataKind)
          : fr24ToCanonical(row, dataKind),
      )
      .filter(Boolean);

    let outKey;
    let meta;
    if (isLive) {
      outKey = `${canonicalLivePrefix(windowPart, batchHash)}/flights.json`;
      meta = { captureDate: windowPart, dataKind, batchHash };
    } else {
      const [dateFrom, dateTo] = windowPart.split("_");
      outKey = `${canonicalFlightsPrefix(dateFrom, dateTo, batchHash)}/flights.json`;
      meta = { dateFrom, dateTo, dataKind, batchHash };
    }

    await objectStore.putObject(outKey, { flights, meta });
    results.push({ outKey, count: flights.length });
  }

  return results;
}

/**
 * Parse a single batch by window + hash.
 */
export async function parseBatch({ dateFrom, dateTo, batchHash, dataKind }) {
  const responseKey = `${rawRoutesPrefix(dateFrom, dateTo, batchHash)}/response.json`;
  if (!(await objectStore.headObject(responseKey))) {
    return { outKey: null, count: 0 };
  }

  const body = await objectStore.getObject(responseKey);
  const rows = body?.data || [];
  const flights = rows
    .map((row) => fr24ToCanonical(row, dataKind))
    .filter(Boolean);

  const outKey = `${canonicalFlightsPrefix(dateFrom, dateTo, batchHash)}/flights.json`;
  await objectStore.putObject(outKey, {
    flights,
    meta: { dateFrom, dateTo, dataKind, batchHash },
  });
  return { outKey, count: flights.length };
}
