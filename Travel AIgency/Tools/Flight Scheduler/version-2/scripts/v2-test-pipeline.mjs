#!/usr/bin/env node
/**
 * End-to-end local pipeline test with synthetic FR24 data (no API).
 */
import * as objectStore from "../src/shared/storage/object-store.js";
import { createRouteFetchJob } from "../src/shared/contracts/job.js";
import { rawRoutesPrefix, canonicalFlightsPrefix } from "../src/shared/contracts/job.js";
import { parseBatch } from "../src/services/parser/index.js";
import { enrichDateWindow } from "../src/services/enrichment/index.js";
import { saveJobManifest } from "../src/shared/lib/job-store.js";

const dateFrom = "2026-05-20";
const dateTo = "2026-05-27";
const routes = ["SVO-SGN", "ALA-CXR"];
const dataKind = "actual";

const job = createRouteFetchJob({ dataKind, dateFrom, dateTo, routes });
job.status = "completed";
job.rowCount = 1;
job.requestCount = 1;

const prefix = rawRoutesPrefix(dateFrom, dateTo, job.batchHash);
const sampleRow = {
  fr24_id: "test-fr24-001",
  flight: "VJ8924",
  callsign: "VJC8924",
  orig_iata: "SVO",
  dest_iata: "SGN",
  datetime_takeoff: "2026-05-22T14:00:00Z",
  datetime_landed: "2026-05-22T22:40:00Z",
  type: "A333",
  reg: "VN-A999",
  operated_as: "VJ",
  painted_as: "VJ",
  flight_ended: true,
};

await objectStore.putObject(`${prefix}/request.json`, {
  dateFrom,
  dateTo,
  routes,
  dataKind,
});
await objectStore.putObject(`${prefix}/response.json`, { data: [sampleRow] });
await objectStore.putObject(`${prefix}/manifest.json`, job);
await saveJobManifest(job);

const parsed = await parseBatch({
  dateFrom,
  dateTo,
  batchHash: job.batchHash,
  dataKind,
});

const enriched = await enrichDateWindow({ dateFrom, dateTo });
const canonicalKey = `${canonicalFlightsPrefix(dateFrom, dateTo, job.batchHash)}/flights.json`;
const canonical = await objectStore.getObject(canonicalKey);

console.log(
  JSON.stringify(
    {
      ok: true,
      parsed,
      enriched,
      flight: canonical.flights?.[0],
      paxEstSet: canonical.flights?.[0]?.paxEst != null,
    },
    null,
    2,
  ),
);
