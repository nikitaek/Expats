import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { readJson, writeJson } from "../lib/fs-json.js";
import { normalizedFilename } from "../lib/cache-keys.js";

export function normalizedPath(date, arrIata) {
  return path.join(paths.normalized, normalizedFilename(date, arrIata));
}

export async function loadNormalized(date, arrIata) {
  try {
    return await readJson(normalizedPath(date, arrIata));
  } catch (err) {
    if (err.code === "ENOENT") return { flights: [] };
    throw err;
  }
}

export async function saveNormalized(date, arrIata, flights) {
  const record = {
    updatedAt: new Date().toISOString(),
    date,
    arrIata: arrIata.toUpperCase(),
    flights,
  };
  await writeJson(normalizedPath(date, arrIata), record);
  return record;
}

export async function deleteNormalized(date, arrIata) {
  try {
    await fs.unlink(normalizedPath(date, arrIata));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
