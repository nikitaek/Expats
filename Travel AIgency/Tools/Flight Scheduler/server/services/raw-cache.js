import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { readJson, writeJson } from "../lib/fs-json.js";
import { rawCacheFilename } from "../lib/cache-keys.js";
import { aviationEdge } from "../config.js";

export function rawCachePath(date, arrIata) {
  return path.join(paths.rawCache, rawCacheFilename(date, arrIata));
}

export function scopeStatusPath(date, arrIata) {
  return path.join(paths.scopeStatus, rawCacheFilename(date, arrIata));
}

export function countCachedFlights(cached) {
  const payload = cached?.response;
  if (Array.isArray(payload?.canonical)) return payload.canonical.length;
  return 0;
}

export async function hasRawCache(date, arrIata) {
  try {
    const cached = await readJson(rawCachePath(date, arrIata));
    return countCachedFlights(cached) > 0;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

export async function loadRawCache(date, arrIata) {
  return readJson(rawCachePath(date, arrIata));
}

export async function loadScopeFetchStatus(date, arrIata) {
  try {
    return await readJson(scopeStatusPath(date, arrIata));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function isTimetableCacheStale(cached) {
  const mode = cached?.response?.scheduleMode;
  const fetchedAt = cached?.fetchedAt;
  if (mode !== "timetable" || !fetchedAt) return false;
  return Date.now() - new Date(fetchedAt).getTime() > aviationEdge.timetableSnapshotTtlMs;
}

export async function getScopeFetchStatus(date, arrIata) {
  try {
    const cached = await readJson(rawCachePath(date, arrIata));
    if (countCachedFlights(cached) > 0) {
      return {
        date,
        arrIata: arrIata.toUpperCase(),
        state: isTimetableCacheStale(cached) ? "stale" : "cached",
        hasRawCache: true,
        fetchedAt: cached.fetchedAt ?? null,
        scheduleMode: cached.response?.scheduleMode ?? null,
        coverageNote: cached.response?.coverageNote ?? null,
        totalIncoming: countCachedFlights(cached),
      };
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }

  const status = await loadScopeFetchStatus(date, arrIata);
  if (status) {
    return {
      ...status,
      date,
      arrIata: arrIata.toUpperCase(),
      hasRawCache: false,
    };
  }

  return {
    date,
    arrIata: arrIata.toUpperCase(),
    state: "missing",
    hasRawCache: false,
    fetchedAt: null,
    scheduleMode: null,
    coverageNote: null,
  };
}

export async function saveScopeFetchStatus(date, arrIata, status) {
  const record = {
    date,
    arrIata: arrIata.toUpperCase(),
    checkedAt: new Date().toISOString(),
    ...status,
  };
  await writeJson(scopeStatusPath(date, arrIata), record);
  return record;
}

export async function saveRawCache(date, arrIata, payload) {
  const record = {
    fetchedAt: new Date().toISOString(),
    date,
    arrIata: arrIata.toUpperCase(),
    response: payload,
  };
  await writeJson(rawCachePath(date, arrIata), record);
  await saveScopeFetchStatus(date, arrIata, {
    state: "cached",
    fetchedAt: record.fetchedAt,
    scheduleMode: payload?.scheduleMode ?? null,
    coverageNote: payload?.coverageNote ?? null,
    totalIncoming: countCachedFlights(record),
  });
  return record;
}

export async function deleteRawCache(date, arrIata) {
  try {
    await fs.unlink(rawCachePath(date, arrIata));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
