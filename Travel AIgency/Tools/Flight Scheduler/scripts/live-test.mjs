import "dotenv/config";
import { fetchIncomingSchedules, scheduleModeForDate } from "../server/services/aviation-edge.js";
import { summarizeScope } from "../server/services/normalize.js";
import { loadScopeFromApi, loadScopeFromCache, getScopeStatus } from "../server/services/scheduler.js";

const today = new Date().toISOString().slice(0, 10);
const future = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
}

async function testAirport(date, iata, label) {
  const mode = scheduleModeForDate(date);
  console.log(`\n--- ${label}: ${iata} on ${date} (mode: ${mode}) ---`);
  const t0 = Date.now();
  try {
    const { mode: apiMode, rows } = await fetchIncomingSchedules(date, iata);
    const summary = await summarizeScope(rows, date, iata);
    const ms = Date.now() - t0;
    console.log(`API OK in ${ms}ms | raw rows: ${rows.length}`);
    console.log(
      `Incoming: ${summary.totalIncoming} | RU-speaking: ${summary.filteredCount} | est. pax: ${summary.paxTotal}`,
    );
    for (const f of summary.flights.slice(0, 5)) {
      console.log(
        `  ${f.eta} ${f.fromCountry} ${f.fromCity} → ${f.toCity} ${f.flightNo} (~${f.paxEst})`,
      );
    }
    if (summary.flights.length > 5) {
      console.log(`  … +${summary.flights.length - 5} more`);
    }
    return { ok: true, apiMode, summary };
  } catch (err) {
    console.error(`FAILED in ${Date.now() - t0}ms:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function testFullPipeline(date, iata) {
  console.log(`\n--- Pipeline: cache + load for ${iata} ${date} ---`);
  const statusBefore = await getScopeStatus(date, iata);
  console.log("Before:", statusBefore);

  const loaded = await loadScopeFromApi(date, iata);
  console.log(
    `Loaded: mode=${loaded.scheduleMode} total=${loaded.totalIncoming} filtered=${loaded.filteredCount}`,
  );

  const fromCache = await loadScopeFromCache(date, iata);
  console.log(`From cache: source=${fromCache.source} filtered=${fromCache.filteredCount}`);

  const statusAfter = await getScopeStatus(date, iata);
  console.log("After:", statusAfter);
}

console.log("Flight Scheduler live test");
console.log("API key set:", Boolean(process.env.AVIATION_EDGE_API_KEY));

const results = {
  health: { hasApiKey: Boolean(process.env.AVIATION_EDGE_API_KEY) },
  today: await testAirport(today, "SGN", "Tan Son Nhat today"),
  dad: await testAirport(today, "DAD", "Da Nang today"),
  future: await testAirport(future, "SGN", `SGN +14 days (${future})`),
};

await testFullPipeline(today, "CXR");

console.log("\n=== Done ===");
console.log(
  "Summary:",
  Object.entries({ SGN: results.today, DAD: results.dad, future: results.future })
    .map(([k, r]) => `${k}: ${r.ok ? "OK" : "FAIL"}`)
    .join(", "),
);
