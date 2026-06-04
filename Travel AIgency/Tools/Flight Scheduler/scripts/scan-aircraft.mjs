/**
 * Scan raw/timetable caches for aircraft types; report coverage vs aircraft-pax.json.
 * Run: npm run scan:aircraft
 * Merge missing codes with suggested defaults: npm run scan:aircraft -- --merge
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAircraftCode } from "../server/services/pax-estimate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAX_FILE = path.join(ROOT, "data", "seeds", "aircraft-pax.json");
const SCAN_DIRS = [
  path.join(ROOT, "data", "cache", "raw"),
  path.join(ROOT, "data", "cache", "timetable"),
];

/** Suggested defaults when --merge adds unknown codes. */
const SUGGESTED = {
  A319: { pax: 124, label: "Airbus A319" },
  A320: { pax: 180, label: "Airbus A320" },
  A20N: { pax: 180, label: "Airbus A320neo" },
  A321: { pax: 220, label: "Airbus A321" },
  A21N: { pax: 220, label: "Airbus A321neo" },
  A332: { pax: 250, label: "Airbus A330-200" },
  A333: { pax: 300, label: "Airbus A330-300" },
  A359: { pax: 325, label: "Airbus A350-900" },
  A35K: { pax: 410, label: "Airbus A350-1000" },
  AT75: { pax: 72, label: "ATR 72-500" },
  AT76: { pax: 78, label: "ATR 72-600" },
  B737: { pax: 160, label: "Boeing 737" },
  B738: { pax: 189, label: "Boeing 737-800" },
  B38M: { pax: 189, label: "Boeing 737 MAX 8" },
  B763: { pax: 260, label: "Boeing 767-300" },
  B772: { pax: 350, label: "Boeing 777-200" },
  B773: { pax: 400, label: "Boeing 777-300" },
  B77W: { pax: 400, label: "Boeing 777-300ER" },
  B77L: { pax: 12, label: "Boeing 777 Freighter" },
  B744: { pax: 350, label: "Boeing 747-400" },
  B748: { pax: 12, label: "Boeing 747-8 Freighter" },
  B788: { pax: 250, label: "Boeing 787-8" },
  B789: { pax: 290, label: "Boeing 787-9" },
  B78X: { pax: 330, label: "Boeing 787-10" },
  E290: { pax: 100, label: "Embraer E190-E2" },
};

const found = new Map();

function record(code, text) {
  const key = normalizeAircraftCode(code);
  if (!key) return;
  if (!found.has(key)) {
    found.set(key, { count: 0, texts: new Set() });
  }
  const row = found.get(key);
  row.count += 1;
  if (text) row.texts.add(text.trim());
}

function walkRows(items) {
  if (!Array.isArray(items)) return;
  for (const row of items) {
    const ac = row.aircraft;
    if (!ac) continue;
    record(ac.modelCode, ac.modelText);
  }
}

function scanFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (data.response?.raw) walkRows(data.response.raw);
    if (data.response?.canonical) {
      for (const row of data.response.canonical) {
        record(row.aircraft_icao, row.aircraft_text);
      }
    }
    if (Array.isArray(data.items)) walkRows(data.items);
  } catch {
    /* skip invalid */
  }
}

for (const dir of SCAN_DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".json")) scanFile(path.join(dir, name));
  }
}

const config = JSON.parse(fs.readFileSync(PAX_FILE, "utf8"));
const known = new Set(Object.keys(config.types || {}));
const merge = process.argv.includes("--merge");

const missing = [];
const sorted = [...found.entries()].sort((a, b) => b[1].count - a[1].count);

console.log(`Scanned aircraft types: ${sorted.length}\n`);
console.log("Code     Count  Mapped  Sample modelText");
console.log("─".repeat(72));

for (const [code, info] of sorted) {
  const mapped = known.has(code);
  const sample = [...info.texts][0] || "—";
  console.log(
    `${code.padEnd(8)} ${String(info.count).padStart(6)}  ${mapped ? "yes" : "NO "}   ${sample.slice(0, 40)}`,
  );
  if (!mapped) missing.push(code);
}

if (missing.length === 0) {
  console.log("\nAll scanned types exist in aircraft-pax.json.");
} else {
  console.log(`\nMissing from mapping (${missing.length}): ${missing.join(", ")}`);
}

if (merge && missing.length > 0) {
  for (const code of missing) {
    const sample = [...found.get(code).texts][0] || "";
    const base = SUGGESTED[code] || {
      pax: config.defaultPax,
      label: code,
    };
    config.types[code] = {
      pax: base.pax,
      label: base.label,
      textPatterns: sample
        ? [sample.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0]]
        : [code.toLowerCase()],
    };
  }
  fs.writeFileSync(PAX_FILE, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`\nMerged ${missing.length} type(s) into ${PAX_FILE}`);
}
