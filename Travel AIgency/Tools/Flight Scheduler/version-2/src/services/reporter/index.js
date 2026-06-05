import { queryFlightsCurrent } from "../../shared/storage/bigquery-client.js";
import * as objectStore from "../../shared/storage/object-store.js";
import { windowKey } from "../../shared/contracts/job.js";

function summarizeFlights(flights) {
  const byDestination = {};
  const byRoute = {};
  let totalPax = 0;

  for (const f of flights) {
    const dest = f.destinationIata || f.destination_iata;
    const route = f.route;
    const pax = Number(f.paxEst ?? f.pax_est ?? 0);
    totalPax += pax;
    byDestination[dest] = (byDestination[dest] || 0) + 1;
    byRoute[route] = (byRoute[route] || 0) + 1;
  }

  return {
    flightCount: flights.length,
    totalPaxEst: totalPax,
    byDestination,
    byRoute,
    flights,
  };
}

export async function writeReport({
  dataKind,
  dateFrom,
  dateTo,
  destination,
}) {
  const flights = await queryFlightsCurrent({
    dataKind,
    dateFrom,
    dateTo,
    destination,
  });

  const summary = summarizeFlights(flights);
  const wk = dateFrom && dateTo ? windowKey(dateFrom, dateTo) : dateFrom;

  let reportKey;
  if (dateFrom === dateTo || !dateTo) {
    reportKey = `reports/${dataKind}/${dateFrom}/daily.json`;
  } else {
    reportKey = `reports/${dataKind}/${wk}/routes.json`;
  }

  await objectStore.putObject(reportKey, {
    generatedAt: new Date().toISOString(),
    dataKind,
    dateFrom,
    dateTo,
    destination: destination || null,
    ...summary,
  });

  return { reportKey, ...summary };
}
