import path from "node:path";
import { paths } from "../config.js";
import { readJson } from "../lib/fs-json.js";

let airportsCache;
let countriesCache;

export async function getAirports() {
  if (!airportsCache) {
    airportsCache = await readJson(path.join(paths.seeds, "airports.json"));
    airportsCache.sort((a, b) => a.priority - b.priority);
  }
  return airportsCache;
}

export async function getRussianSpeakingCountries() {
  if (!countriesCache) {
    countriesCache = await readJson(
      path.join(paths.seeds, "russian-speaking-countries.json"),
    );
  }
  return countriesCache;
}

export async function getRussianSpeakingIso2Set() {
  const countries = await getRussianSpeakingCountries();
  return new Set(countries.map((c) => c.iso2.toUpperCase()));
}

export async function findAirportByIata(iata) {
  const airports = await getAirports();
  return airports.find((a) => a.iata.toUpperCase() === iata.toUpperCase()) ?? null;
}
