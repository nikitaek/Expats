import { dedupeByFr24Id } from "../../shared/enrichment/dedupe.js";
import { mergeFlights } from "../../shared/storage/bigquery-client.js";
import * as objectStore from "../../shared/storage/object-store.js";

/**
 * Load enriched canonical flights from prefix into BigQuery.
 * @param {string} prefix
 */
export async function loadPrefix(prefix) {
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const keys = await objectStore.listPrefix(normalized);
  const flightKeys = keys.filter((k) => k.endsWith("/flights.json"));

  const byKind = new Map();

  for (const key of flightKeys) {
    const body = await objectStore.getObject(key);
    const dataKind = body.meta?.dataKind || "actual";
    if (!byKind.has(dataKind)) byKind.set(dataKind, []);
    byKind.get(dataKind).push(...(body.flights || []));
  }

  const results = [];
  for (const [dataKind, flights] of byKind) {
    const deduped = dedupeByFr24Id(flights);
    const res = await mergeFlights(dataKind, deduped);
    results.push({ dataKind, merged: res.merged });
  }

  return results;
}

/**
 * Load canonical flights for explicit date window.
 */
export async function loadDateWindow({ dateFrom, dateTo }) {
  return loadPrefix(`canonical/flights/${dateFrom}_${dateTo}/`);
}
