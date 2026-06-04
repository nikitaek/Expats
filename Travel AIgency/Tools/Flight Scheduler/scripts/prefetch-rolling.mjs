#!/usr/bin/env node
/**
 * Daily rolling prefetch: extend the flightsFuture cache horizon.
 * Run once per day (cron) so each calendar day is captured while still
 * at least futureMinDaysAhead out — then it stays in cache as it enters
 * the near-term window (Aviation Edge recommended workflow).
 *
 * Same as prefetch-future.mjs but defaults to 37 days and prints cron hint.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, "prefetch-future.mjs");

const extra = process.argv.slice(2);
if (!extra.some((a) => a === "--days")) {
  extra.unshift("--days", "37");
}

const child = spawn(process.execPath, [script, ...extra], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 1));
