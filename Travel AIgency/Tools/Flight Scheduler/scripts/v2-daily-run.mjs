#!/usr/bin/env node
import { parseArgs } from "../src/shared/lib/cli-args.js";
import { runSchedulerTick } from "../src/services/scheduler/index.js";

const args = parseArgs();
const result = await runSchedulerTick({
  force: Boolean(args.force),
  skipLoad: Boolean(args.skip_load),
  skipReport: Boolean(args.skip_report),
});
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
