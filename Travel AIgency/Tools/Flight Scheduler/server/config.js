import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const paths = {
  root: ROOT,
  seeds: path.join(ROOT, "data", "seeds"),
  rawCache: path.join(ROOT, "data", "cache", "raw"),
  scopeStatus: path.join(ROOT, "data", "cache", "status"),
  auditReports: path.join(ROOT, "data", "cache", "audits"),
  timetableCache: path.join(ROOT, "data", "cache", "timetable"),
  airportCache: path.join(ROOT, "data", "cache", "airports"),
  normalized: path.join(ROOT, "data", "normalized"),
  public: path.join(ROOT, "public"),
};

/** @see https://aviation-edge.com/developers/ */
export const aviationEdge = {
  baseUrl: "https://aviation-edge.com/v2/public",
  apiKey: process.env.AVIATION_EDGE_API_KEY || "",
  /**
   * flightsFuture accepts dates at least this many days ahead (Aviation Edge: 7+).
   * Override with FUTURE_MIN_DAYS_AHEAD if your plan differs.
   */
  futureMinDaysAhead: Number(process.env.FUTURE_MIN_DAYS_AHEAD) || 7,
  /** Reuse timetable responses across dates for this many ms (~API refresh). */
  timetableSnapshotTtlMs: 15 * 60 * 1000,
  /**
   * flightsHistory only accepts dates more than this many days before today.
   * @see Aviation Edge error: "date_to > 3 days from current date"
   */
  historyMinDaysBehind: Number(process.env.HISTORY_MIN_DAYS_BEHIND) || 4,
};

/** @see https://docs.apilayer.com/aviationstack/docs/aviationstack-api-v-1-0-0 */
/** @see https://fr24api.flightradar24.com/docs/endpoints/overview */
export const flightradar24 = {
  apiToken: process.env.FR24_API_TOKEN || "",
  requestDelayMs: Number(process.env.FR24_REQUEST_DELAY_MS) || 3000,
  /** Per-request cap on many plans (limit param may not raise above this). */
  pageSize: Number(process.env.FR24_PAGE_SIZE) || 20,
};

export const aviationstack = {
  baseUrl: "https://api.aviationstack.com/v1",
  accessKey: process.env.AVIATIONSTACK_ACCESS_KEY || "",
  /** Paid plans: 1 req / 10s — use ≥11000 to stay safe. */
  minDelayMs: Number(process.env.AVIATIONSTACK_DELAY_MS) || 11_000,
  pageLimit: 100,
};

export const port = Number(process.env.PORT) || 3847;
