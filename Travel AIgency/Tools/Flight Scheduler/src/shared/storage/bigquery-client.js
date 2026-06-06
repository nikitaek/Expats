import { BigQuery } from "@google-cloud/bigquery";
import { bigquery as bqConfig } from "../config/env.js";
import { tableForDataKind } from "../contracts/flight.js";
import { canonicalToBigQueryRow } from "../fr24/adapters.js";

let client;

function getClient() {
  if (!client) {
    if (!bqConfig.project) {
      throw new Error("BIGQUERY_PROJECT is not set in .env");
    }
    client = new BigQuery({ projectId: bqConfig.project });
  }
  return client;
}

function fqTable(tableId) {
  return `\`${bqConfig.project}.${bqConfig.dataset}.${tableId}\``;
}

/**
 * MERGE canonical flights into the table for dataKind.
 * @param {import('../contracts/flight.js').DataKind} dataKind
 * @param {import('../contracts/flight.js').CanonicalFlight[]} flights
 */
export async function mergeFlights(dataKind, flights) {
  if (!flights.length) return { merged: 0 };

  const tableId = tableForDataKind(dataKind);
  const rows = flights.map((f) => canonicalToBigQueryRow(f));
  const bq = getClient();

  const tempId = `_tmp_merge_${Date.now()}`;
  const dataset = bq.dataset(bqConfig.dataset);
  const tempTable = dataset.table(tempId);

  await tempTable.create({
    schema: await loadSchema(),
  });

  try {
    await tempTable.insert(rows);

    const mergeSql = `
      MERGE ${fqTable(tableId)} AS T
      USING ${fqTable(tempId)} AS S
      ON T.fr24_id = S.fr24_id
      WHEN MATCHED THEN UPDATE SET
        flight_number = S.flight_number,
        airline_iata = S.airline_iata,
        route = S.route,
        origin_iata = S.origin_iata,
        destination_iata = S.destination_iata,
        flight_date = S.flight_date,
        scheduled_dep_at = S.scheduled_dep_at,
        actual_dep_at = S.actual_dep_at,
        scheduled_arr_at = S.scheduled_arr_at,
        actual_arr_at = S.actual_arr_at,
        aircraft_code = S.aircraft_code,
        aircraft_reg = S.aircraft_reg,
        pax_est = S.pax_est,
        loaded_at = S.loaded_at
      WHEN NOT MATCHED THEN INSERT (
        fr24_id, flight_number, airline_iata, route, origin_iata, destination_iata,
        flight_date, scheduled_dep_at, actual_dep_at, scheduled_arr_at, actual_arr_at,
        aircraft_code, aircraft_reg, pax_est, loaded_at
      ) VALUES (
        S.fr24_id, S.flight_number, S.airline_iata, S.route, S.origin_iata, S.destination_iata,
        S.flight_date, S.scheduled_dep_at, S.actual_dep_at, S.scheduled_arr_at, S.actual_arr_at,
        S.aircraft_code, S.aircraft_reg, S.pax_est, S.loaded_at
      )
    `;

    await bq.query({ query: mergeSql });
    return { merged: rows.length };
  } finally {
    await tempTable.delete({ ignoreNotFound: true }).catch(() => {});
  }
}

async function loadSchema() {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { paths } = await import("../config/env.js");
  const schemaPath = path.join(paths.migrations, "bq-flights-schema.json");
  const raw = await fs.readFile(schemaPath, "utf8");
  return JSON.parse(raw);
}

/**
 * Query flights_current view with optional filters.
 */
export async function queryFlightsCurrent({
  dataKind,
  dateFrom,
  dateTo,
  destination,
  limit = 5000,
} = {}) {
  const bq = getClient();
  const conditions = ["1=1"];
  const params = {};

  if (dataKind) {
    conditions.push("data_kind = @dataKind");
    params.dataKind = dataKind;
  }
  if (dateFrom) {
    conditions.push("flight_date >= @dateFrom");
    params.dateFrom = dateFrom;
  }
  if (dateTo) {
    conditions.push("flight_date <= @dateTo");
    params.dateTo = dateTo;
  }
  if (destination) {
    conditions.push("destination_iata = @destination");
    params.destination = destination.toUpperCase();
  }

  const sql = `
    SELECT
      fr24_id AS fr24Id,
      flight_number AS flightNumber,
      airline_iata AS airlineIata,
      route,
      origin_iata AS originIata,
      destination_iata AS destinationIata,
      flight_date AS flightDate,
      actual_dep_at AS actualDepartureAt,
      actual_arr_at AS actualArrivalAt,
      aircraft_code AS aircraftCode,
      aircraft_reg AS aircraftRegistration,
      pax_est AS paxEst,
      data_kind AS dataKind
    FROM ${fqTable("flights_current")}
    WHERE ${conditions.join(" AND ")}
    ORDER BY flight_date DESC, actual_arr_at DESC
    LIMIT ${Number(limit)}
  `;

  const [rows] = await bq.query({ query: sql, params });
  return rows;
}

/**
 * Create dataset, tables, and flights_current view.
 */
export async function setupBigQuery({ upcomingExpiryDays = 7 } = {}) {
  const bq = getClient();
  const schema = await loadSchema();

  const dataset = bq.dataset(bqConfig.dataset);
  const [exists] = await dataset.exists();
  if (!exists) {
    await dataset.create({ location: "US" });
  }

  for (const tableId of ["flights_actual", "flights_upcoming"]) {
    const table = dataset.table(tableId);
    const [tableExists] = await table.exists();
    if (!tableExists) {
      const expiry =
        tableId === "flights_upcoming" ? upcomingExpiryDays : null;

      await table.create({
        schema,
        timePartitioning: {
          type: "DAY",
          field: "flight_date",
          ...(expiry ? { expirationMs: expiry * 24 * 60 * 60 * 1000 } : {}),
        },
        clustering: { fields: ["destination_iata", "origin_iata"] },
      });
    }
  }

  const viewSql = `
    CREATE OR REPLACE VIEW ${fqTable("flights_current")} AS
    SELECT * EXCEPT(trust),
      CASE trust
        WHEN 1 THEN 'actual'
        ELSE 'upcoming'
      END AS data_kind
    FROM (
      SELECT *, 1 AS trust FROM ${fqTable("flights_actual")}
      UNION ALL
      SELECT *, 2 AS trust FROM ${fqTable("flights_upcoming")}
    )
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY fr24_id
      ORDER BY trust ASC, loaded_at DESC
    ) = 1
  `;

  await bq.query({ query: viewSql });
  return { dataset: bqConfig.dataset, tables: 2, view: "flights_current" };
}
