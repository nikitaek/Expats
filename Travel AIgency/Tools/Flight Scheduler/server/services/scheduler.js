import {
  hasRawCache,
  loadRawCache,
  saveRawCache,
  saveScopeFetchStatus,
  getScopeFetchStatus,
  deleteRawCache,
} from "./raw-cache.js";
import {
  loadNormalized,
  saveNormalized,
  deleteNormalized,
} from "./normalized-store.js";
import {
  fetchIncomingSchedules,
  scheduleModeForDate,
  scheduleCoverageNote,
} from "./aviation-edge.js";
import { normalizeSchedules, summarizeScope } from "./normalize.js";
import { enrichFlights } from "./pax-estimate.js";
import {
  fetchProjectedRows,
  isNearTermGapDate,
  projectionCoverageNote,
} from "./project-history.js";

function extractRawFlights(cached) {
  const payload = cached?.response;
  if (Array.isArray(payload?.canonical)) return payload.canonical;
  if (Array.isArray(cached?.canonical)) return cached.canonical;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

export async function getScopeStatus(date, arrIata) {
  const fetchStatus = await getScopeFetchStatus(date, arrIata);
  const normalized = await loadNormalized(date, arrIata);
  return {
    date,
    arrIata: arrIata.toUpperCase(),
    hasRawCache: fetchStatus.hasRawCache,
    cacheState: fetchStatus.state,
    fetchStatus,
    scheduleMode: fetchStatus.scheduleMode ?? scheduleModeForDate(date),
    coverageNote: fetchStatus.coverageNote ?? scheduleCoverageNote(date),
    normalizedCount: normalized.flights?.length ?? 0,
    normalizedUpdatedAt: normalized.updatedAt ?? null,
  };
}

export async function loadScopeFromCache(date, arrIata) {
  const cached = await loadRawCache(date, arrIata);
  const rawFlights = extractRawFlights(cached);
  const summary = await summarizeScope(rawFlights, date, arrIata);
  summary.flights = await enrichFlights(summary.flights);
  summary.paxTotal = summary.flights.reduce(
    (sum, f) => sum + (f.paxEst || 0),
    0,
  );
  return {
    source: "cache",
    scheduleMode: cached.response?.scheduleMode ?? scheduleModeForDate(date),
    coverageNote: cached.response?.coverageNote ?? scheduleCoverageNote(date),
    fetchedAt: cached.fetchedAt,
    ...summary,
  };
}

export async function loadScopeFromApi(date, arrIata) {
  let fetched;
  try {
    fetched = await fetchIncomingSchedules(date, arrIata);
  } catch (err) {
    await saveScopeFetchStatus(date, arrIata, {
      state: "api_error",
      scheduleMode: scheduleModeForDate(date),
      coverageNote: scheduleCoverageNote(date),
      error: err.message,
    });
    throw err;
  }

  const { mode, rows, raw, coverageNote, timetableFromSnapshot } = fetched;

  if (rows.length === 0) {
    await deleteRawCache(date, arrIata);
    await deleteNormalized(date, arrIata);
    await saveScopeFetchStatus(date, arrIata, {
      state: "api_empty",
      fetchedAt: new Date().toISOString(),
      scheduleMode: mode,
      coverageNote,
      totalIncoming: 0,
    });
    const err = new Error(
      `No flights returned for ${arrIata} on ${date}. Nothing was cached. ${coverageNote}`,
    );
    err.code = "NO_SCHEDULE_DATA";
    err.details = { date, arrIata, scheduleMode: mode, coverageNote };
    throw err;
  }

  await saveRawCache(date, arrIata, {
    scheduleMode: mode,
    coverageNote,
    timetableFromSnapshot: timetableFromSnapshot ?? false,
    raw,
    canonical: rows,
  });

  const flights = await normalizeSchedules(rows, date, arrIata);
  await saveNormalized(date, arrIata, flights);

  const summary = await summarizeScope(rows, date, arrIata);
  summary.flights = await enrichFlights(summary.flights);
  summary.paxTotal = summary.flights.reduce(
    (sum, f) => sum + (f.paxEst || 0),
    0,
  );
  return {
    source: "api",
    scheduleMode: mode,
    coverageNote,
    timetableFromSnapshot: timetableFromSnapshot ?? false,
    fetchedAt: new Date().toISOString(),
    ...summary,
  };
}

export async function loadScopeFromApiBatch(date, arrIataList) {
  const results = [];
  for (const arrIata of arrIataList) {
    try {
      const data = await loadScopeFromApi(date, arrIata);
      results.push({
        arrIata: arrIata.toUpperCase(),
        ok: true,
        filteredCount: data.filteredCount,
        totalIncoming: data.totalIncoming,
        scheduleMode: data.scheduleMode,
      });
    } catch (err) {
      results.push({
        arrIata: arrIata.toUpperCase(),
        ok: false,
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }
  }
  return {
    date,
    airportCount: arrIataList.length,
    multiAirportPerRequestSupported: false,
    results,
  };
}

export async function loadScopeFromProjection(date, arrIata, options = {}) {
  if (!isNearTermGapDate(date)) {
    const err = new Error(
      `${date} is not in the near-term gap (tomorrow … day before flightsFuture). Use API load or prefetch instead.`,
    );
    err.code = "NOT_GAP_DATE";
    err.details = { date, arrIata };
    throw err;
  }

  const { sourceDate, rows } = await fetchProjectedRows(
    date,
    arrIata,
    options.weekOffsets,
  );

  if (rows.length === 0) {
    const err = new Error(`No flights to project for ${arrIata} on ${date}.`);
    err.code = "NO_SCHEDULE_DATA";
    throw err;
  }

  const coverageNote = projectionCoverageNote(date, sourceDate);
  await saveRawCache(date, arrIata, {
    scheduleMode: "projected",
    coverageNote,
    projectedFrom: sourceDate,
    raw: { projected: true, sourceDate },
    canonical: rows,
  });

  const flights = await normalizeSchedules(rows, date, arrIata);
  await saveNormalized(date, arrIata, flights);

  const summary = await summarizeScope(rows, date, arrIata);
  summary.flights = await enrichFlights(summary.flights);
  summary.paxTotal = summary.flights.reduce(
    (sum, f) => sum + (f.paxEst || 0),
    0,
  );

  return {
    source: "projected",
    scheduleMode: "projected",
    coverageNote,
    projectedFrom: sourceDate,
    fetchedAt: new Date().toISOString(),
    ...summary,
  };
}

export async function loadScopeFromProjectionBatch(date, arrIataList, options = {}) {
  const results = [];
  for (const arrIata of arrIataList) {
    try {
      const data = await loadScopeFromProjection(date, arrIata, options);
      results.push({
        arrIata: arrIata.toUpperCase(),
        ok: true,
        filteredCount: data.filteredCount,
        totalIncoming: data.totalIncoming,
        projectedFrom: data.projectedFrom,
      });
    } catch (err) {
      results.push({
        arrIata: arrIata.toUpperCase(),
        ok: false,
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }
  }
  return { date, airportCount: arrIataList.length, results };
}

export async function getOrLoadScope(date, arrIata, { forceApi = false } = {}) {
  if (!forceApi && (await hasRawCache(date, arrIata))) {
    return loadScopeFromCache(date, arrIata);
  }
  return loadScopeFromApi(date, arrIata);
}
