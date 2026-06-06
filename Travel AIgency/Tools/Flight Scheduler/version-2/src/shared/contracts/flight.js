/** @typedef {'actual' | 'upcoming'} DataKind */

/**
 * @typedef {Object} CanonicalFlight
 * @property {string} fr24Id
 * @property {string} flightNumber
 * @property {string|null} airlineIata
 * @property {string} originIata
 * @property {string} destinationIata
 * @property {string} route
 * @property {DataKind} dataKind
 * @property {string|null} scheduledDepartureAt
 * @property {string|null} actualDepartureAt
 * @property {string|null} scheduledArrivalAt
 * @property {string|null} actualArrivalAt
 * @property {string|null} aircraftCode
 * @property {string|null} aircraftRegistration
 * @property {number|null} paxEst
 */

export const DATA_KINDS = ["actual", "upcoming"];

export function tableForDataKind(dataKind) {
  const map = {
    actual: "flights_actual",
    upcoming: "flights_upcoming",
  };
  const table = map[dataKind];
  if (!table) throw new Error(`Unknown dataKind: ${dataKind}`);
  return table;
}
