import { enrichFlights } from "../../shared/enrichment/pax-estimate.js";
import * as objectStore from "../../shared/storage/object-store.js";

/**
 * Enrich all canonical/flights.json under prefix.
 * @param {string} prefix
 */
export async function enrichPrefix(prefix) {
  const normalized = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const keys = await objectStore.listPrefix(normalized);
  const flightKeys = keys.filter((k) => k.endsWith("/flights.json"));
  const results = [];

  for (const key of flightKeys) {
    const body = await objectStore.getObject(key);
    const enriched = await enrichFlights(body.flights || []);
    await objectStore.putObject(key, { ...body, flights: enriched });
    results.push({ key, count: enriched.length });
  }

  return results;
}

/**
 * Enrich canonical files for a date window.
 */
export async function enrichDateWindow({ dateFrom, dateTo }) {
  const prefix = `canonical/flights/${dateFrom}_${dateTo}/`;
  return enrichPrefix(prefix);
}
