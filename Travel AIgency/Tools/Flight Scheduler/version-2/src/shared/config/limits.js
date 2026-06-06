import { readJson } from "../lib/fs-json.js";
import { paths } from "./env.js";

let policyPromise;

export async function getSchedulerPolicy() {
  if (!policyPromise) {
    policyPromise = readJson(
      `${paths.config}/scheduler-policy.json`,
      defaultPolicy(),
    );
  }
  return policyPromise;
}

export function defaultPolicy() {
  return {
    timezone: "Asia/Ho_Chi_Minh",
    routesPerRequest: 15,
    maxRequestsPerCronRun: 20,
    maxRequestsPerDay: 80,
    minRequestDelayMs: 3500,
    actual: { enabled: true, yesterday: true, repairDays: 7 },
    upcoming: { enabled: true, hoursAhead: 72, cron: "0 */6 * * *" },
    priorityOrder: ["upcoming", "actual_yesterday", "actual_repair"],
    retry: { maxAttempts: 3, forceRequiresDebugFlag: true },
  };
}
