#!/usr/bin/env node
import { parseArgs } from "../src/shared/lib/cli-args.js";
import { enrichPrefix, enrichDateWindow } from "../src/services/enrichment/index.js";

const args = parseArgs();

let results;
if (args.prefix) {
  results = await enrichPrefix(args.prefix);
} else if (args.date_from && args.date_to) {
  results = await enrichDateWindow({
    dateFrom: args.date_from,
    dateTo: args.date_to,
  });
} else {
  console.error("Usage: npm run enrich-flights -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD");
  console.error("   or: npm run enrich-flights -- --prefix canonical/flights/...");
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, results }, null, 2));
