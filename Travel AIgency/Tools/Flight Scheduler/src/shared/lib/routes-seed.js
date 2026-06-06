import path from "node:path";
import { paths } from "../config/env.js";
import { readJson } from "./fs-json.js";

export async function loadEnabledRoutes() {
  const seed = await readJson(path.join(paths.seeds, "v2-routes.json"), []);
  return seed
    .filter((r) => r.enabled !== false)
    .map((r) => r.route)
    .sort();
}

export function batchRoutes(routes, size = 15) {
  const batches = [];
  for (let i = 0; i < routes.length; i += size) {
    batches.push(routes.slice(i, i + size));
  }
  return batches;
}
