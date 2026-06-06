#!/usr/bin/env node
import { parseArgs } from "../src/shared/lib/cli-args.js";
import { loadPrefix, loadDateWindow } from "../src/services/loader/index.js";

const args = parseArgs();

let results;
if (args.prefix) {
  results = await loadPrefix(args.prefix);
} else if (args.date_from && args.date_to) {
  results = await loadDateWindow({
    dateFrom: args.date_from,
    dateTo: args.date_to,
  });
} else {
  console.error("Usage: npm run load-bigquery -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD");
  console.error("   or: npm run load-bigquery -- --prefix canonical/flights/...");
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, results }, null, 2));
