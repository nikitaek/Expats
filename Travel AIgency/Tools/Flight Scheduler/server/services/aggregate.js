import { getAirports } from "./seeds.js";
import { getScopeFetchStatus, loadRawCache } from "./raw-cache.js";
import { estimatePax } from "./pax-estimate.js";
import { loadScopeFromCache } from "./scheduler.js";
import { scheduleModeForDate, scheduleCoverageNote } from "./aviation-edge.js";

const MAX_RANGE_DAYS = 60;

export function enumerateDates(dateFrom, dateTo) {
  const dates = [];
  const cursor = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function validateDateRange(dateFrom, dateTo) {
  if (!dateFrom || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    return { error: "Query parameter date_from (YYYY-MM-DD) is required." };
  }
  if (!dateTo || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return { error: "Query parameter date_to (YYYY-MM-DD) is required." };
  }
  if (dateFrom > dateTo) {
    return { error: "date_from must be on or before date_to." };
  }
  const days = enumerateDates(dateFrom, dateTo).length;
  if (days > MAX_RANGE_DAYS) {
    return { error: `Date range cannot exceed ${MAX_RANGE_DAYS} days.` };
  }
  return { dateFrom, dateTo, days };
}

export async function resolveAirportList(arrIataParam) {
  if (!arrIataParam || arrIataParam.toUpperCase() === "ALL") {
    const airports = await getAirports();
    return airports.map((a) => a.iata.toUpperCase());
  }
  const list = [
    ...new Set(
      String(arrIataParam)
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{3}$/.test(c)),
    ),
  ];
  if (list.length === 0) {
    return { error: "Query arr_iata must be ALL or comma-separated IATA codes." };
  }
  return list;
}

async function sumCanonicalPax(canonical) {
  if (!canonical?.length) return 0;
  let sum = 0;
  for (const row of canonical) {
    const code = row.aircraft_icao || row.aircraftIcao || "";
    const modelText =
      row.aircraft_text ||
      row.aircraft_name ||
      row.aircraftName ||
      row.model ||
      "";
    sum += await estimatePax(code, modelText);
  }
  return sum;
}

async function scopeSummary(date, arrIata) {
  const status = await getScopeFetchStatus(date, arrIata);
  if (!status.hasRawCache) {
    return {
      date,
      arrIata: arrIata.toUpperCase(),
      hasRawCache: false,
      cacheState: status.state,
      scheduleMode: status.scheduleMode ?? scheduleModeForDate(date),
      coverageNote: status.coverageNote ?? scheduleCoverageNote(date),
      fetchStatus: status,
      totalIncoming: 0,
      totalIncomingPax: 0,
      filteredCount: 0,
      paxTotal: 0,
      flights: [],
    };
  }

  const raw = await loadRawCache(date, arrIata);
  const canonical = raw?.response?.canonical || [];
  const totalIncomingPax = await sumCanonicalPax(canonical);

  const data = await loadScopeFromCache(date, arrIata);
  const flights = (data.flights || []).map((f) => ({
    ...f,
    arrIata: arrIata.toUpperCase(),
  }));

  return {
    date,
    arrIata: arrIata.toUpperCase(),
    hasRawCache: true,
    cacheState: status.state,
    fetchStatus: status,
    scheduleMode: data.scheduleMode,
    coverageNote: data.coverageNote,
    fetchedAt: data.fetchedAt,
    totalIncoming: data.totalIncoming ?? 0,
    totalIncomingPax,
    filteredCount: data.filteredCount ?? flights.length,
    paxTotal: data.paxTotal ?? 0,
    flights,
  };
}

function bumpBucket(map, key, flights, pax) {
  const row = map.get(key) || { flights: 0, pax: 0 };
  row.flights += flights;
  row.pax += pax;
  map.set(key, row);
}

function scopeStateCounts(scopes) {
  const counts = {
    cached: 0,
    stale: 0,
    api_empty: 0,
    api_error: 0,
    missing: 0,
  };
  for (const s of scopes) {
    counts[s.cacheState] = (counts[s.cacheState] ?? 0) + 1;
  }
  return counts;
}

function coveragePct(complete, total) {
  if (!total) return 0;
  return Math.round((complete / total) * 1000) / 10;
}

function monthKey(date) {
  return date.slice(0, 7);
}

function buildCoverageBreakdown(scopeResults, airportByIata) {
  const byAirportMonthMap = new Map();
  const byAirportMap = new Map();

  for (const s of scopeResults) {
    const keys = [
      [byAirportMonthMap, `${s.arrIata}|${monthKey(s.date)}`, monthKey(s.date)],
      [byAirportMap, s.arrIata, null],
    ];

    for (const [map, key, month] of keys) {
      const row =
        map.get(key) ||
        {
          arrIata: s.arrIata,
          city: airportByIata.get(s.arrIata)?.city || s.arrIata,
          month,
          scopesTotal: 0,
          cached: 0,
          stale: 0,
          apiEmpty: 0,
          apiError: 0,
          missing: 0,
          totalIncoming: 0,
          filteredCount: 0,
          paxTotal: 0,
        };

      row.scopesTotal += 1;
      if (s.cacheState === "cached") row.cached += 1;
      else if (s.cacheState === "stale") row.stale += 1;
      else if (s.cacheState === "api_empty") row.apiEmpty += 1;
      else if (s.cacheState === "api_error") row.apiError += 1;
      else row.missing += 1;

      row.totalIncoming += s.totalIncoming ?? 0;
      row.filteredCount += s.filteredCount ?? 0;
      row.paxTotal += s.paxTotal ?? 0;
      map.set(key, row);
    }
  }

  const finalize = (row) => ({
    ...row,
    completeScopes: row.cached,
    dataScopes: row.cached + row.stale,
    incompleteScopes: row.stale + row.apiEmpty + row.apiError + row.missing,
    coveragePct: coveragePct(row.cached, row.scopesTotal),
    hasProviderGaps: row.apiEmpty + row.apiError + row.missing > 0,
  });

  return {
    byAirportMonth: [...byAirportMonthMap.values()]
      .map(finalize)
      .sort(
        (a, b) =>
          a.month.localeCompare(b.month) ||
          a.arrIata.localeCompare(b.arrIata),
      ),
    byAirport: [...byAirportMap.values()]
      .map(finalize)
      .sort((a, b) => a.arrIata.localeCompare(b.arrIata)),
  };
}

export async function getRangeStatus(dateFrom, dateTo, arrIataList) {
  const dates = enumerateDates(dateFrom, dateTo);
  const airportMeta = await getAirports();
  const airportByIata = new Map(airportMeta.map((a) => [a.iata, a]));
  const scopes = [];

  for (const date of dates) {
    for (const arrIata of arrIataList) {
      const status = await getScopeFetchStatus(date, arrIata);
      scopes.push({
        date,
        arrIata: arrIata.toUpperCase(),
        hasRawCache: status.hasRawCache,
        cacheState: status.state,
        scheduleMode: status.scheduleMode ?? scheduleModeForDate(date),
        coverageNote: status.coverageNote ?? scheduleCoverageNote(date),
      });
    }
  }

  const counts = scopeStateCounts(scopes);
  const missingScopes = scopes.filter((s) => s.cacheState === "missing");
  const emptyApiScopes = scopes.filter((s) => s.cacheState === "api_empty");
  const errorScopes = scopes.filter((s) => s.cacheState === "api_error");
  const staleScopes = scopes.filter((s) => s.cacheState === "stale");
  const coverage = buildCoverageBreakdown(scopes, airportByIata);

  return {
    dateFrom,
    dateTo,
    days: dates.length,
    airports: arrIataList,
    scopesTotal: scopes.length,
    scopesCached: counts.cached + counts.stale,
    completeScopes: counts.cached,
    incompleteScopes: scopes.length - counts.cached,
    staleScopes: staleScopes.length,
    emptyApiScopes: emptyApiScopes.length,
    errorScopes: errorScopes.length,
    scopesMissing: missingScopes.length,
    coveragePct: coveragePct(counts.cached, scopes.length),
    isComplete: counts.cached === scopes.length,
    scopeStateCounts: counts,
    missingScopes,
    emptyApiScopeDetails: emptyApiScopes,
    errorScopeDetails: errorScopes,
    staleScopeDetails: staleScopes,
    coverageByAirport: coverage.byAirport,
    coverageByAirportMonth: coverage.byAirportMonth,
    scheduleModes: [...new Set(scopes.map((s) => s.scheduleMode))],
  };
}

export async function aggregateRange(dateFrom, dateTo, arrIataList) {
  const dates = enumerateDates(dateFrom, dateTo);
  const airportMeta = await getAirports();
  const airportByIata = new Map(airportMeta.map((a) => [a.iata, a]));

  const scopeJobs = [];
  for (const date of dates) {
    for (const arrIata of arrIataList) {
      scopeJobs.push(scopeSummary(date, arrIata));
    }
  }
  const scopeResults = await Promise.all(scopeJobs);

  const missingScopes = scopeResults
    .filter((s) => s.cacheState === "missing")
    .map(({ date, arrIata }) => ({ date, arrIata }));
  const counts = scopeStateCounts(scopeResults);
  const emptyApiScopes = scopeResults
    .filter((s) => s.cacheState === "api_empty")
    .map(({ date, arrIata, scheduleMode, coverageNote }) => ({
      date,
      arrIata,
      scheduleMode,
      coverageNote,
    }));
  const errorScopes = scopeResults
    .filter((s) => s.cacheState === "api_error")
    .map(({ date, arrIata, fetchStatus }) => ({
      date,
      arrIata,
      error: fetchStatus?.error || "API error",
    }));
  const staleScopes = scopeResults
    .filter((s) => s.cacheState === "stale")
    .map(({ date, arrIata, fetchedAt }) => ({ date, arrIata, fetchedAt }));
  const coverage = buildCoverageBreakdown(scopeResults, airportByIata);

  const allFlights = scopeResults.flatMap((s) => s.flights);
  allFlights.sort((a, b) => {
    const da = `${a.date}T${a.eta || "00:00"}`;
    const db = `${b.date}T${b.eta || "00:00"}`;
    return da.localeCompare(db);
  });

  let totalIncoming = 0;
  let totalIncomingPax = 0;
  let filteredCount = 0;
  let paxTotal = 0;
  for (const s of scopeResults) {
    totalIncoming += s.totalIncoming;
    totalIncomingPax += s.totalIncomingPax ?? 0;
    filteredCount += s.filteredCount;
    paxTotal += s.paxTotal;
  }

  const pctFlightsRu =
    totalIncoming > 0
      ? Math.round((filteredCount / totalIncoming) * 1000) / 10
      : 0;
  const pctPaxRu =
    totalIncomingPax > 0
      ? Math.round((paxTotal / totalIncomingPax) * 1000) / 10
      : 0;

  const byDateIncomingMap = new Map();
  const byDateRuMap = new Map();
  const byAirportIncomingMap = new Map();
  const byAirportRuMap = new Map();
  const byCountryMap = new Map();

  for (const s of scopeResults) {
    if (!s.hasRawCache) continue;
    bumpBucket(byDateIncomingMap, s.date, s.totalIncoming, 0);
    bumpBucket(byAirportIncomingMap, s.arrIata, s.totalIncoming, 0);
  }

  const byOriginMap = new Map();

  for (const f of allFlights) {
    bumpBucket(byDateRuMap, f.date, 1, f.paxEst || 0);
    bumpBucket(byAirportRuMap, f.arrIata || "?", 1, f.paxEst || 0);
    bumpBucket(byCountryMap, f.fromCountry || "?", 1, f.paxEst || 0);

    const originKey = `${f.fromCountry || "?"}|${f.fromCity || "?"}`;
    const originRow = byOriginMap.get(originKey) || {
      iso2: f.fromCountry || "?",
      city: f.fromCity || "—",
      flights: 0,
      pax: 0,
    };
    originRow.flights += 1;
    originRow.pax += f.paxEst || 0;
    byOriginMap.set(originKey, originRow);
  }

  const byDate = dates.map((date) => ({
    date,
    incoming: byDateIncomingMap.get(date)?.flights ?? 0,
    flights: byDateRuMap.get(date)?.flights ?? 0,
    pax: byDateRuMap.get(date)?.pax ?? 0,
  }));

  const airportIatas = new Set([
    ...byAirportIncomingMap.keys(),
    ...byAirportRuMap.keys(),
  ]);

  const byAirport = [...airportIatas]
    .map((iata) => ({
      iata,
      city: airportByIata.get(iata)?.city || iata,
      incoming: byAirportIncomingMap.get(iata)?.flights ?? 0,
      flights: byAirportRuMap.get(iata)?.flights ?? 0,
      pax: byAirportRuMap.get(iata)?.pax ?? 0,
    }))
    .sort((a, b) => b.incoming - a.incoming);

  const byCountry = [...byCountryMap.entries()]
    .map(([iso2, stats]) => ({
      iso2,
      flights: stats.flights,
      pax: stats.pax,
    }))
    .sort((a, b) => b.flights - a.flights);

  const byInbound = [...byAirportRuMap.entries()]
    .map(([iata, stats]) => ({
      iata,
      city: airportByIata.get(iata)?.city || iata,
      flights: stats.flights,
      pax: stats.pax,
    }))
    .sort((a, b) => b.pax - a.pax || b.flights - a.flights);

  const byOrigin = [...byOriginMap.values()].sort(
    (a, b) => b.pax - a.pax || b.flights - a.flights,
  );

  const latestFetch = scopeResults
    .filter((s) => s.fetchedAt)
    .map((s) => s.fetchedAt)
    .sort()
    .pop();

  return {
    source: "cache",
    dateFrom,
    dateTo,
    days: dates.length,
    airports: arrIataList,
    scopesTotal: scopeResults.length,
    scopesCached: counts.cached + counts.stale,
    completeScopes: counts.cached,
    incompleteScopes: scopeResults.length - counts.cached,
    staleScopes: staleScopes.length,
    emptyApiScopes: emptyApiScopes.length,
    errorScopes: errorScopes.length,
    scopesMissing: missingScopes.length,
    coveragePct: coveragePct(counts.cached, scopeResults.length),
    isComplete: counts.cached === scopeResults.length,
    scopeStateCounts: counts,
    missingScopes,
    emptyApiScopeDetails: emptyApiScopes,
    errorScopeDetails: errorScopes,
    staleScopeDetails: staleScopes,
    coverageByAirport: coverage.byAirport,
    coverageByAirportMonth: coverage.byAirportMonth,
    totalIncoming,
    totalIncomingPax,
    filteredCount,
    paxTotal,
    pctFlightsRu,
    pctPaxRu,
    flights: allFlights,
    byDate,
    byAirport,
    byInbound,
    byOrigin,
    byCountry,
    fetchedAt: latestFetch ?? null,
    coverageNote:
      dates.length === 1
        ? scheduleCoverageNote(dates[0])
        : `Aggregated ${dates.length} days across ${arrIataList.length} airport(s). Near-term dates use live timetable (partial day).`,
  };
}

export async function loadRangeFromApi(dateFrom, dateTo, arrIataList) {
  const dates = enumerateDates(dateFrom, dateTo);
  const { loadScopeFromApiBatch } = await import("./scheduler.js");

  const dayResults = [];
  for (const date of dates) {
    const batch = await loadScopeFromApiBatch(date, arrIataList);
    dayResults.push(batch);
  }

  const aggregate = await aggregateRange(dateFrom, dateTo, arrIataList);
  return {
    source: "api",
    loadResults: dayResults,
    ...aggregate,
  };
}
