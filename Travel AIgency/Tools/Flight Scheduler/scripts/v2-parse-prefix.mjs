#!/usr/bin/env node
import { parseArgs } from "../src/shared/lib/cli-args.js";
import { parsePrefix } from "../src/services/parser/index.js";

const args = parseArgs();
if (!args.prefix) {
  console.error("Usage: npm run parse-prefix -- --prefix raw/routes/2026-05-20_2026-05-27/");
  process.exit(1);
}

const results = await parsePrefix(args.prefix);
console.log(JSON.stringify({ ok: true, results }, null, 2));
