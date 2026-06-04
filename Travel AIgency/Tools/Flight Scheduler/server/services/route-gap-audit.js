import { enumerateDates } from "./aggregate.js";
import { getScopeFetchStatus, loadRawCache } from "./raw-cache.js";

const DAD_JUNE_EXPECTED_ROUTES = [
  { depIata: "NQZ", city: "Astana", country: "KZ", source: "DAD June CSV evidence" },
  { depIata: "ALA", city: "Almaty", country: "KZ", source: "DAD June CSV evidence" },
  { depIata: "TAS", city: "Tashkent", country: "UZ", source: "DAD June CSV evidence" },
  { depIata: "VVO", city: "Vladivostok", country: "RU", source: "DAD June CSV evidence" },
  { depIata: "DME", city: "Moscow", country: "RU", source: "DAD June CSV evidence" },
  { depIata: "OVB", city: "Novosibirsk", country: "RU", source: "DAD June CSV evidence" },
  { depIata: "KJA", city: "Krasnoyarsk", country: "RU", source: "DAD June CSV evidence" },
  { depIata: "KZN", city: "Kazan", country: "RU", source: "DAD June CSV evidence" },
  { depIata: "KHV", city: "Khabarovsk", country: "RU", source: "DAD June CSV evidence" },
  { depIata: "MSQ", city: "Minsk", country: "BY", source: "DAD June CSV evidence" },
  { depIata: "BAX", city: "Barnaul", country: "RU", source: "DAD June CSV evidence" },
  { depIata: "NOZ", city: "Novokuznetsk", country: "RU", source: "DAD June CSV evidence" },
  { depIata: "BQS", city: "Blagoveshchensk", country: "RU", source: "DAD June CSV evidence" },
];

function rawRows(cached) {
  const payload = cached?.response;
  if (Array.isArray(payload?.canonical)) return payload.canonical;
  if (Array.isArray(cached?.canonical)) return cached.canonical;
  return [];
}

async function loadRowsIfCached(date, arrIata) {
  try {
    return rawRows(await loadRawCache(date, arrIata));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function dadJuneRouteGapAudit(year = "2026") {
  const dateFrom = `${year}-06-01`;
  const dateTo = `${year}-06-30`;
  const dates = enumerateDates(dateFrom, dateTo);
  const actualRoutes = new Map();
  const scopes = [];

  for (const date of dates) {
    const status = await getScopeFetchStatus(date, "DAD");
    scopes.push({
      date,
      cacheState: status.state,
      scheduleMode: status.scheduleMode,
      hasRawCache: status.hasRawCache,
    });

    const rows = await loadRowsIfCached(date, "DAD");
    for (const row of rows) {
      const depIata = row.dep_iata?.toUpperCase();
      if (!depIata) continue;
      const route = actualRoutes.get(depIata) || {
        depIata,
        observedFlights: 0,
        flightNos: new Set(),
        dates: new Set(),
      };
      route.observedFlights += 1;
      if (row.flight_iata) route.flightNos.add(row.flight_iata);
      route.dates.add(date);
      actualRoutes.set(depIata, route);
    }
  }

  const expectedRoutes = DAD_JUNE_EXPECTED_ROUTES.map((expected) => {
    const actual = actualRoutes.get(expected.depIata);
    return {
      ...expected,
      presentInApiCache: Boolean(actual),
      observedFlights: actual?.observedFlights ?? 0,
      observedFlightNos: actual ? [...actual.flightNos].sort() : [],
      observedDates: actual ? [...actual.dates].sort() : [],
    };
  });

  const stateCounts = scopes.reduce((acc, s) => {
    acc[s.cacheState] = (acc[s.cacheState] ?? 0) + 1;
    return acc;
  }, {});
  const cachedScopes = scopes.filter((s) => s.hasRawCache).length;

  return {
    source: "api-cache-with-csv-route-comparison",
    officialTotalsSource: "Aviation Edge API cache only",
    comparisonSource:
      "User-provided DAD June CSV route list; comparison labels only, not used in totals",
    dateFrom,
    dateTo,
    arrIata: "DAD",
    scopesTotal: scopes.length,
    cachedScopes,
    coveragePct: Math.round((cachedScopes / scopes.length) * 1000) / 10,
    stateCounts,
    scopes,
    expectedRoutes,
    missingExpectedRoutes: expectedRoutes.filter((r) => !r.presentInApiCache),
    actualOriginIatas: [...actualRoutes.keys()].sort(),
  };
}
