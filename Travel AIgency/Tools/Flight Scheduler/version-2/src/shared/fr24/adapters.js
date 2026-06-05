/** @typedef {import('../contracts/flight.js').DataKind} DataKind */
/** @typedef {import('../contracts/flight.js').CanonicalFlight} CanonicalFlight */

/**
 * @param {Record<string, unknown>} row
 * @param {DataKind} dataKind
 * @returns {CanonicalFlight|null}
 */
export function fr24ToCanonical(row, dataKind) {
  if (!row?.fr24_id) return null;

  const originIata = (row.orig_iata || "").toString().toUpperCase();
  const destinationIata = (row.dest_iata || row.dest_iata_actual || "")
    .toString()
    .toUpperCase();
  const airlineIata = (row.operated_as || row.painted_as || "")
    .toString()
    .toUpperCase() || null;
  const flightNumber = (row.flight || row.callsign || "").toString();
  const route =
    originIata && destinationIata
      ? `${originIata}-${destinationIata}`
      : "";

  return {
    fr24Id: String(row.fr24_id),
    flightNumber,
    airlineIata,
    originIata,
    destinationIata,
    route,
    dataKind,
    scheduledDepartureAt: row.scheduled_departure || null,
    actualDepartureAt: row.datetime_takeoff || null,
    scheduledArrivalAt: row.scheduled_arrival || null,
    actualArrivalAt: row.datetime_landed || null,
    aircraftCode: (row.type || "").toString().toUpperCase() || null,
    aircraftRegistration: row.reg || null,
    paxEst: null,
  };
}

/**
 * Live flight-positions row → canonical. Flight is airborne now; `eta` is the
 * estimated arrival, mapped to scheduledArrivalAt. No completed times yet.
 * @param {Record<string, unknown>} row
 * @param {DataKind} dataKind
 * @returns {CanonicalFlight|null}
 */
export function livePositionToCanonical(row, dataKind = "upcoming") {
  if (!row?.fr24_id) return null;

  const originIata = (row.orig_iata || "").toString().toUpperCase();
  const destinationIata = (row.dest_iata || "").toString().toUpperCase();
  const airlineIata =
    (row.operating_as || row.painted_as || "").toString().toUpperCase() || null;
  const flightNumber = (row.flight || row.callsign || "").toString();
  const route =
    originIata && destinationIata ? `${originIata}-${destinationIata}` : "";

  return {
    fr24Id: String(row.fr24_id),
    flightNumber,
    airlineIata,
    originIata,
    destinationIata,
    route,
    dataKind,
    scheduledDepartureAt: null,
    actualDepartureAt: null,
    scheduledArrivalAt: row.eta || null,
    actualArrivalAt: null,
    aircraftCode: (row.type || "").toString().toUpperCase() || null,
    aircraftRegistration: row.reg || null,
    paxEst: null,
  };
}

/**
 * Vietnam arrival date (UTC slice of landed/takeoff) for partitioning.
 * @param {CanonicalFlight} flight
 */
export function flightDateFromCanonical(flight) {
  const landed = flight.actualArrivalAt || flight.scheduledArrivalAt;
  if (landed) return landed.slice(0, 10);
  const dep = flight.actualDepartureAt || flight.scheduledDepartureAt;
  if (dep) return dep.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {CanonicalFlight} flight
 */
export function canonicalToBigQueryRow(flight) {
  return {
    fr24_id: flight.fr24Id,
    flight_number: flight.flightNumber,
    airline_iata: flight.airlineIata,
    route: flight.route,
    origin_iata: flight.originIata,
    destination_iata: flight.destinationIata,
    flight_date: flightDateFromCanonical(flight),
    scheduled_dep_at: flight.scheduledDepartureAt,
    actual_dep_at: flight.actualDepartureAt,
    scheduled_arr_at: flight.scheduledArrivalAt,
    actual_arr_at: flight.actualArrivalAt,
    aircraft_code: flight.aircraftCode,
    aircraft_reg: flight.aircraftRegistration,
    pax_est: flight.paxEst,
    loaded_at: new Date().toISOString(),
  };
}
