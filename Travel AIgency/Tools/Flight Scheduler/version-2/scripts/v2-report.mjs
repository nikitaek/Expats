#!/usr/bin/env node
import { parseArgs } from "../src/shared/lib/cli-args.js";
import { writeReport } from "../src/services/reporter/index.js";

const args = parseArgs();

if (!args.data_kind || !args.date_from) {
  console.error(
    "Usage: v2:report --data-kind actual --date-from YYYY-MM-DD [--date-to YYYY-MM-DD] [--destination SGN]",
  );
  process.exit(1);
}

const result = await writeReport({
  dataKind: args.data_kind,
  dateFrom: args.date_from,
  dateTo: args.date_to || args.date_from,
  destination: args.destination,
});

console.log(JSON.stringify({ ok: true, reportKey: result.reportKey, flightCount: result.flightCount }, null, 2));
