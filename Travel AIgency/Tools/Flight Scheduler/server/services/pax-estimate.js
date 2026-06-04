import path from "node:path";
import { paths } from "../config.js";
import { readJson } from "../lib/fs-json.js";

let configPromise;

async function getConfig() {
  if (!configPromise) {
    configPromise = readJson(path.join(paths.seeds, "aircraft-pax.json"));
  }
  return configPromise;
}

export function normalizeAircraftCode(modelCode) {
  if (!modelCode) return "";
  return modelCode
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function textMatches(modelText, patterns) {
  if (!modelText || !patterns?.length) return false;
  const hay = modelText.toLowerCase();
  return patterns.some((p) => hay.includes(p.toLowerCase()));
}

function findByText(cfg, modelText) {
  if (!modelText) return null;
  for (const entry of Object.values(cfg.types || {})) {
    if (textMatches(modelText, entry.textPatterns)) return entry;
  }
  return null;
}

function findByCode(cfg, code) {
  if (!code) return null;
  const key = code.toUpperCase();
  return cfg.types?.[key] ?? null;
}

function findByPrefix(cfg, code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  for (const rule of cfg.prefixRules || []) {
    if (upper.startsWith(rule.prefix.toUpperCase())) return rule;
  }
  return null;
}

/** @returns {{ pax: number, label?: string, source: string } | null} */
export async function lookupAircraft(code, modelText = "") {
  const cfg = await getConfig();
  const normalized = normalizeAircraftCode(code);

  const byCode = findByCode(cfg, normalized);
  if (byCode) {
    return { pax: byCode.pax, label: byCode.label, source: "code" };
  }

  const byText = findByText(cfg, modelText);
  if (byText) {
    return { pax: byText.pax, label: byText.label, source: "text" };
  }

  const byPrefix = findByPrefix(cfg, normalized);
  if (byPrefix) {
    return {
      pax: byPrefix.pax,
      label: byPrefix.label,
      source: "prefix",
    };
  }

  if (normalized) {
    return { pax: cfg.defaultPax, label: normalized, source: "default" };
  }

  if (modelText) {
    return {
      pax: cfg.defaultPax,
      label: modelText.trim(),
      source: "default",
    };
  }

  return null;
}

export async function estimatePax(code, modelText = "") {
  const hit = await lookupAircraft(code, modelText);
  return hit?.pax ?? (await getConfig()).defaultPax;
}

export async function aircraftLabel(code, modelText = "") {
  const hit = await lookupAircraft(code, modelText);
  if (hit?.label) return hit.label;
  const normalized = normalizeAircraftCode(code);
  if (normalized) return normalized;
  if (modelText) return modelText.trim();
  return "";
}

export async function enrichFlight(flight) {
  const code = flight.aircraft || "";
  const modelText = flight.aircraftText || "";
  const label = await aircraftLabel(code, modelText);
  return {
    ...flight,
    aircraftLabel: label || code || "",
    paxEst: await estimatePax(code, modelText),
  };
}

export async function enrichFlights(flights) {
  if (!flights?.length) return flights ?? [];
  return Promise.all(flights.map((f) => enrichFlight(f)));
}
