#!/usr/bin/env node
/**
 * First-launch bootstrap: ±30d download → parse → enrich → load.
 * Optional: --prune-dry-run lists routes to disable in v2-routes.json.
 */
import { parseArgs } from "../src/shared/lib/cli-args.js";
import {
  runBootstrap,
  routesWithFlightsFromCanonical,
} from "../src/services/scheduler/index.js";
import { daysAgo, daysAhead } from "../src/shared/lib/dates.js";
import { loadEnabledRoutes } from "../src/shared/lib/routes-seed.js";
import { getSchedulerPolicy } from "../src/shared/config/limits.js";
import path from "node:path";
import { paths } from "../src/shared/config/env.js";
import { readJson, writeJson } from "../src/shared/lib/fs-json.js";

const args = parseArgs();
const policy = await getSchedulerPolicy();
const tz = policy.timezone || "Asia/Ho_Chi_Minh";
const daysBack = Number(args.days_back || 30);
const daysForward = Number(args.days_forward || 30);
const dataKind = args.data_kind || "actual";
const force = Boolean(args.force);

if (args.prune_dry_run || args.prune) {
  const withFlights = await routesWithFlightsFromCanonical();
  const allRoutes = await loadEnabledRoutes();
  const toDisable = allRoutes.filter((r) => !withFlights.has(r));

  if (args.prune) {
    const seedPath = path.join(paths.seeds, "v2-routes.json");
    const seed = await readJson(seedPath, []);
    const disableSet = new Set(toDisable);
    const updated = seed.map((entry) => {
      if (disableSet.has(entry.route)) {
        return { ...entry, enabled: false };
      }
      return entry;
    });
    await writeJson(seedPath, updated);
    console.log(`Disabled ${toDisable.length} routes in v2-routes.json`);
  } else {
    console.log(
      JSON.stringify(
        {
          ok: true,
          routesWithFlights: withFlights.size,
          routesToDisable: toDisable.length,
          sample: toDisable.slice(0, 20),
        },
        null,
        2,
      ),
    );
  }
  process.exit(0);
}

const result = await runBootstrap({
  daysBack,
  daysForward,
  dataKind,
  force,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      dateFrom: result.dateFrom,
      dateTo: result.dateTo,
      jobs: result.jobs.length,
      completed: result.jobs.filter((j) => j.status === "completed").length,
    },
    null,
    2,
  ),
);
