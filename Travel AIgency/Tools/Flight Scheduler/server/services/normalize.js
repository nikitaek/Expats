import { estimatePax, aircraftLabel } from "./pax-estimate.js";
import { resolveDepartureAirport } from "./aviation-edge.js";
import { getRussianSpeakingIso2Set, findAirportByIata } from "./seeds.js";

function arrivalDateOnRecord(record, selectedDate) {
  const time =
    record.arr_estimated || record.arr_actual || record.arr_time || "";
  if (!time) return false;
  const day = time.slice(0, 10);
  return day === selectedDate;
}

function formatEta(record) {
  const time =
    record.arr_estimated || record.arr_actual || record.arr_time || "";
  if (!time) return "";
  const part = time.includes("T") ? time.split("T")[1] : time.split(" ")[1];
  return part ? part.slice(0, 5) : "";
}

function flightNumber(record) {
  if (record.flight_iata) return record.flight_iata;
  if (record.airline_iata && record.flight_number) {
    return `${record.airline_iata}${record.flight_number}`;
  }
  return record.flight_number || "";
}

export async function normalizeSchedules(rawFlights, selectedDate, arrIata) {
  const ruCountries = await getRussianSpeakingIso2Set();
  const destination = await findAirportByIata(arrIata);
  const depCache = new Map();
  const normalized = [];

  for (const row of rawFlights) {
    if (!arrivalDateOnRecord(row, selectedDate)) continue;
    if (row.arr_iata?.toUpperCase() !== arrIata.toUpperCase()) continue;

    const depIata = row.dep_iata?.toUpperCase();
    if (!depIata) continue;

    let depAirport = depCache.get(depIata);
    if (!depAirport) {
      depAirport = await resolveDepartureAirport(depIata);
      depCache.set(depIata, depAirport);
    }

    const countryCode = depAirport?.country_code?.toUpperCase();
    if (!countryCode || !ruCountries.has(countryCode)) continue;

    const aircraft = row.aircraft_icao || "";
    const aircraftText = row.aircraft_text || "";

    normalized.push({
      date: selectedDate,
      eta: formatEta(row),
      fromCountry: countryCode,
      fromCity: depAirport.city || depIata,
      fromAirport: depAirport.name || depIata,
      toCity: destination?.city || arrIata,
      toAirport: destination?.airportName || arrIata,
      airline: row.airline_iata || "",
      flightNo: flightNumber(row),
      aircraft,
      aircraftText,
      aircraftLabel: await aircraftLabel(aircraft, aircraftText),
      paxEst: await estimatePax(aircraft, aircraftText),
    });
  }

  normalized.sort((a, b) => a.eta.localeCompare(b.eta));
  return normalized;
}

export async function summarizeScope(allRawFlights, selectedDate, arrIata) {
  const ruCountries = await getRussianSpeakingIso2Set();
  let totalIncoming = 0;

  for (const row of allRawFlights) {
    if (!arrivalDateOnRecord(row, selectedDate)) continue;
    if (row.arr_iata?.toUpperCase() !== arrIata.toUpperCase()) continue;
    totalIncoming += 1;
  }

  const normalized = await normalizeSchedules(allRawFlights, selectedDate, arrIata);
  const paxTotal = normalized.reduce((sum, f) => sum + (f.paxEst || 0), 0);

  return {
    totalIncoming,
    filteredCount: normalized.length,
    paxTotal,
    flights: normalized,
    russianSpeakingCountries: [...ruCountries],
  };
}
