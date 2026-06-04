# Flight Scheduler Version 2

Self-contained under this folder. Seed data lives in `**data/seeds/**` (paths below are relative to `version-2/`).

Route discovery, scoring, and inbound/outbound scans are in **[README-future.md](./README-future.md)** (v2.1+).

## Goal

Version 2 rebuilds Flight Scheduler as a small FR24-only data pipeline for CIS-origin traffic to **all Vietnam airports** in `data/seeds/airports.json` (equal priority — no single “primary” destination).

We use the data for three operational reasons:


| Use                     | Time horizon                                | Question                                                                         |
| ----------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| **1. Past arrivals**    | Completed flights (historical FR24)         | How many people already arrived, by date, airport, route, flight, and `pax_est`? |
| **2. Airport outreach** | Next ~72 hours (live + near-term scheduled) | Who is landing soon and when should we be at the airport to offer services?      |
| **3. Traffic outlook**  | Next ~2 weeks (scheduled / provisional)     | What incoming volume should we expect by destination and day?                    |


Each stored flight row includes: **flight number**, **route**, **date**, **departure/arrival times**, `**pax_est`**, and `**data_kind**` (`actual` | `upcoming` | `forecast`).

Do not classify routes as seasonal/charter or reconcile multi-source disagreements in v2 — see [README-future.md](./README-future.md).

The main design rule is that each step communicates through stored data, not public HTTP endpoints:

```text
cron/debug command -> scheduler -> job manifest -> raw FR24 object (R2) -> canonical object (R2) -> enriched row -> BigQuery flights tables -> reports/export
```

Target runtime:

- Node.js services now.
- Cloudflare Workers later.
- Cloudflare R2 for immutable raw and canonical JSON objects.
- BigQuery for **normalized flight facts** (`flights_actual`, `flights_upcoming`, `flights_forecast`) with view `flights_current`.
- Job state, route lists, and airport metadata in **versioned seed JSON** and R2 job manifests — not BigQuery.
- Cloudflare Cron Triggers later for scheduled pipeline execution.
- No public API and no frontend listeners in v2. Manual control is by debug scripts only.

## FR24-Only Source Strategy

FR24 gives several useful ways to ask for flight data. The method should depend on the question.

### 1. Specific Routes

Example:

```text
routes=SVO-SGN,ALA-CXR,VVO-PQC
```

Use this as the primary method.

Best for:

- Known or suspected CIS to Vietnam routes (every origin × every Vietnam airport in seeds).
- Cheap checks over fixed date windows (historical, upcoming, or forecast).
- Rechecking route quality over time.
- Filling known gaps for a specific origin and destination.

Why:

- Few requests.
- Low noise.
- Finds charters that airport schedule APIs missed.
- Better than scanning all SVO/DME/VKO outbound traffic.

Weakness:

- It only finds routes we already include in the route vocabulary.
- New unknown origins will not be discovered unless another process suggests them.

### 2. Other FR24 Modes (v2.1+)

Inbound/outbound airport scans and flight-number-only discovery: [README-future.md](./README-future.md).

### 3. Time Modes (v2)

All v2 fetches use the same `routes=` batch endpoint; the **date window** and resulting `**data_kind`** differ:


| `data_kind` | FR24 window                          | Business use                   |
| ----------- | ------------------------------------ | ------------------------------ |
| `actual`    | Past completed days (e.g. yesterday) | Past arrival analysis (1.1)    |
| `upcoming`  | Today through next ~72 hours         | Airport outreach timing (1.2)  |
| `forecast`  | Next ~14 days                        | Two-week traffic outlook (1.3) |


```text
GET /api/flight-summary/full
flight_datetime_from=...
flight_datetime_to=...
routes=SVO-SGN,ALA-CXR,VVO-PQC
```

Parser sets `data_kind` from the job’s declared window (not from extra metadata fields). Charter rows may appear late in `forecast` and move to `upcoming` then `actual` — treat `forecast` as provisional.

Empty FR24 responses (zero flights in the batch) are not written to R2 — only the job manifest records `rowCount: 0`.

### Refresh Cadence (v2)

- `actual`: daily backfill for yesterday and recent completed days.
- `upcoming`: every 6 hours for the next 72 hours.
- `forecast`: daily for the next 14 days.
- Parse, enrich, load to BigQuery: after each download batch.

## FR24 API Call Examples

These examples are based on the current FR24 client in `server/services/flightradar24.js`.

Base URL:

```text
https://fr24api.flightradar24.com/api
```

Required headers:

```text
Authorization: Bearer <FR24_API_TOKEN>
Accept: application/json
Accept-Version: v1
```

The current code calls:

```text
GET /api/flight-summary/full
```

### Route Batch Request

Use for the main historical fetch.

```bash
curl "https://fr24api.flightradar24.com/api/flight-summary/full?flight_datetime_from=2026-05-20%2000:00:00&flight_datetime_to=2026-05-27%2023:59:59&routes=SVO-SGN,ALA-CXR,VVO-HAN&limit=2000&sort=asc" \
  -H "Authorization: Bearer $FR24_API_TOKEN" \
  -H "Accept: application/json" \
  -H "Accept-Version: v1"
```

Observed result from our sample:

```json
{
  "data": [
    {
      "fr24_id": "example-fr24-id",
      "flight": "VJ8924",
      "callsign": "VJC8924",
      "orig_iata": "SVO",
      "dest_iata": "SGN",
      "datetime_takeoff": "2026-05-22T14:00:00Z",
      "datetime_landed": "2026-05-22T22:40:00Z",
      "first_seen": "2026-05-22T13:48:00Z",
      "type": "A333",
      "reg": "VN-A...",
      "operated_as": "VJ",
      "painted_as": "VJ",
      "flight_ended": true
    }
  ]
}
```

Sample outcome (test window; destinations vary by route batch):

- `routes=SVO-SGN,ALA-CXR,VVO-HAN`, 2026-05-20 to 2026-05-27: multiple legs across Vietnam airports.
- Example numbers seen in earlier tests: `VJ8924` / `VJ8932` (Moscow–Da Nang), `VJ52` / `DV5328` (Almaty–Da Nang), `SU292` (Moscow–Ho Chi Minh).

### Debug Command Examples

The pipeline is not controlled by HTTP. Cron runs the normal schedule; debug commands are for manual one-off runs.

Run the full daily pipeline for the scheduler-chosen windows:

```bash
npm run v2:daily
```

Manually fetch a fixed route/date window:

```bash
npm run v2:download-routes -- \
  --data-kind actual \
  --date-from 2026-05-20 \
  --date-to 2026-05-27 \
  --routes SVO-SGN,ALA-CXR
```

Parse, index, and enrich a raw prefix:

```bash
npm run v2:parse-prefix -- --prefix raw/fr24/routes/date_from=2026-05-20/date_to=2026-05-27/
npm run v2:index-prefix -- --prefix normalized/flights/date_from=2026-05-20/date_to=2026-05-27/
npm run v2:enrich-flights -- --date-from 2026-05-20 --date-to 2026-05-27
```

Export a small report from BigQuery for inspection:

```bash
npm run v2:report -- --data-kind actual --date-from 2026-05-20 --date-to 2026-05-27 --destination SGN
```

Example report rows:

```json
[
  {
    "id": "fr24:example-fr24-id",
    "flightNumber": "VJ8924",
    "airlineIata": "VJ",
    "route": "SVO-SGN",
    "originIata": "SVO",
    "destinationIata": "SGN",
    "actualDepartureAt": "2026-05-22T14:00:00Z",
    "actualArrivalAt": "2026-05-22T22:40:00Z",
    "aircraftCode": "A333",
    "aircraftRegistration": "VN-A...",
    "paxEst": 300,
    "dataKind": "actual"
  }
]
```

## Recommended v2 Method

1. Scheduler reads enabled routes from `data/seeds/v2-routes.json` (full matrix ~240 routes until bootstrap prune).
2. Route batch fetch for `actual`, `upcoming`, and `forecast` windows.
3. Parse → enrich (`pax_est` only) → load to BigQuery (`flights_actual/upcoming/forecast`), one row per `fr24_id` per table (no duplicates).
4. Reports/exports: flights list + summaries filtered by `dataKind`.

Hybrid discovery: [README-future.md](./README-future.md).

## First launch (route bootstrap)

The full origin × destination matrix in `v2-routes.json` is a **candidate** list. Many pairs never have CIS–Vietnam service. The first run discovers which routes are real; steady-state cron only fetches **enabled** routes.

### 1. Initial download (all candidates)

On first launch, download **every route** where `enabled` is not `false` (omit `enabled` or set `"enabled": true`).

Date window (single bootstrap pass, split into FR24 14-day chunks if needed):

```text
date_from = today − 30 days
date_to   = today + 30 days
```

Run manually (example):

```bash
npm run v2:download-routes -- \
  --date-from <today-30d> \
  --date-to <today+30d> \
  --routes <all enabled routes, batched 15 per request>
```

Then parse → enrich → load to BigQuery for that window. Expect many zero-flight route batches; that is normal.

### 2. Prune routes with no data

After the bootstrap load, analyze which routes **never appear** in stored flight facts (canonical JSON or BigQuery `route` column) across the bootstrap window.

For each route with **no flights** in that 60-day window, edit `data/seeds/v2-routes.json` and set:

```json
{ "route": "IKT-BMV", "enabled": false }
```

Routes that returned at least one flight stay enabled (or omit `enabled`).

Re-run this check after major seed expansions (new origin or new Vietnam airport). Optional: a future script can propose `enabled: false` from BigQuery; v2 does this manually in the seed file.

### 3. Steady state

Scheduler and downloader **skip** routes with `"enabled": false`. Cron uses the normal `actual` / `upcoming` / `forecast` windows from [Autonomous Scheduler Plan](#autonomous-scheduler-plan), not the ±30-day bootstrap range.

## Seed files (not BigQuery)


| File                                         | Purpose                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `data/seeds/airports.json`                   | All Vietnam destination airports (equal importance)                            |
| `data/seeds/v2-origin-airports.json`         | CIS / RU-speaking origin airports                                              |
| `data/seeds/v2-routes.json`                  | Routes to fetch; `enabled: false` after bootstrap if no flights in ±30d window |
| `data/seeds/v2-flight-numbers.json`          | Optional flight numbers for v2.1+ monitoring                                   |
| `data/seeds/aircraft-pax.json`               | Aircraft → `pax_est` mapping                                                   |
| `data/seeds/russian-speaking-countries.json` | Country reference                                                              |


### Destination airports

`data/seeds/airports.json` — all entries are treated equally for scheduling and reporting.

### Origin airports

`data/seeds/v2-origin-airports.json` — fields: `iata`, `icao`, `city`, `country`, `countryIso2`, `scanOutbound` (Moscow hubs `false`; use route queries only).

### Routes

`data/seeds/v2-routes.json` — matrix: each origin in `v2-origin-airports.json` × each `iata` in `airports.json`.

```json
{ "route": "ALA-SGN" }
{ "route": "IKT-BMV", "enabled": false }
```


| Field     | Default    | Meaning                                                                             |
| --------- | ---------- | ----------------------------------------------------------------------------------- |
| `route`   | (required) | `ORIGIN-DEST` for FR24 `routes=`                                                    |
| `enabled` | `true`     | If `false`, scheduler and downloader skip this route (set after first-launch prune) |


All rows start enabled for the [first launch](#first-launch-route-bootstrap). Disable routes that had no flights in the bootstrap window.

### Flight numbers

`data/seeds/v2-flight-numbers.json` — for future monitoring jobs; not used by the v2 downloader.

```json
{
  "flightNumber": "VJ8924",
  "airlineIata": "VJ",
  "knownRoutes": ["SVO-DAD"],
  "monitor": true
}
```

### Airlines (reference)

Known airline codes from samples:

```text
VJ, DV, VN, SU, N4
```

Interpretation:

- `VJ`: VietJet Air.
- `DV`: SCAT Airlines.
- `VN`: Vietnam Airlines.
- `SU`: Aeroflot.
- `N4`: Nordwind Airlines / charter-like Russia leisure traffic.

Use airline as an analysis dimension first, not a primary fetch dimension.

Scanning by airline may help later if FR24 supports a narrow airline filter that can be combined with date and region. It should not replace route analysis because an airline-wide scan can be as noisy as airport-wide scanning. Route queries already return the airline for each found flight, so they are enough for known routes. Add airline-based jobs only as an audit process for airlines that repeatedly appear in our route and inbound data.

### Aircraft And Pax Vocabulary

Current passenger estimates from `data/seeds/aircraft-pax.json`:

```text
A319 124 Airbus A319
A320 180 Airbus A320
A20N 180 Airbus A320neo
A321 220 Airbus A321
A21N 220 Airbus A321neo
A332 250 Airbus A330-200
A333 300 Airbus A330-300
A359 325 Airbus A350-900
A35K 410 Airbus A350-1000
AT75 72 ATR 72-500
AT76 78 ATR 72-600
B737 160 Boeing 737
B738 189 Boeing 737-800
B38M 189 Boeing 737 MAX 8
B763 260 Boeing 767-300
B772 350 Boeing 777-200
B773 400 Boeing 777-300
B77W 400 Boeing 777-300ER
B77L 12 Boeing 777 Freighter
B744 350 Boeing 747-400
B748 12 Boeing 747-8 Freighter
B788 250 Boeing 787-8
B789 290 Boeing 787-9
B78X 330 Boeing 787-10
E290 100 Embraer E190-E2
```

Prefix fallback rules:

```text
A32 190 Airbus A320 family
A33 280 Airbus A330
A35 340 Airbus A350
AT7 75 ATR 72
B73 175 Boeing 737
B38 189 Boeing 737 MAX
B76 260 Boeing 767
B77 370 Boeing 777
B78 290 Boeing 787
B74 350 Boeing 747
E19 100 Embraer E-Jet
```

## Storage Layout


| Layer                      | Where                            | What                                                                              |
| -------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| Raw FR24 responses         | R2 (`vn-flights` bucket)         | Immutable JSON per fetch; key schema below                                        |
| Canonical (parsed) records | R2 (`vn-flights` bucket)         | Parsed, pre-BigQuery; audit/replay                                                |
| Normalized flight facts    | **BigQuery**                     | `flights_actual`, `flights_upcoming`, `flights_forecast` + view `flights_current` |
| Jobs                       | R2 `jobs/` or local `data/jobs/` | Manifests; never BigQuery                                                         |
| Seeds & config             | `data/seeds/`, `data/config/`    | Route list, policy; human-edited files                                            |
| Reports                    | R2 `reports/`                    | Summary JSONs written by reporter                                                 |


### R2 Buckets

One bucket is enough. Use top-level prefixes to separate concerns. Suggested name:

```text
vn-flights
```

### R2 Key Convention

All keys follow this pattern:

```text
<category>/<subcategory>/<date-or-window>/<identifier>/<file>
```

Rules:

- Dates are plain ISO values: `2026-05-20`, never `date_from=2026-05-20`
- Windows are `<from>_<to>`: `2026-05-20_2026-05-27`
- Batch identifier is a short deterministic hash of the sorted route list, not the route names themselves (routes can be up to 15 entries and make keys unreadable)
- Separator is always `/`
- Files are lowercase with dashes: `response.json`, `manifest.json`

#### Raw FR24 route fetch

```text
raw/routes/<from>_<to>/<batch-hash>/request.json
raw/routes/<from>_<to>/<batch-hash>/response.json
raw/routes/<from>_<to>/<batch-hash>/manifest.json
```

Example:

```text
raw/routes/2026-05-20_2026-05-27/a3f9c1/request.json
raw/routes/2026-05-20_2026-05-27/a3f9c1/response.json
raw/routes/2026-05-20_2026-05-27/a3f9c1/manifest.json
```

The manifest records which routes were in the batch, so the hash alone is enough in the path. If FR24 returns no flights, **do not** create `response.json` under that prefix (manifest only).

#### Raw inbound airport fetch (v2.1+)

```text
raw/inbound/<airport>/<from>_<to>/p<page>/response.json
```

Example:

```text
raw/inbound/SGN/2026-05-23_2026-05-23/p001/response.json
```

#### Canonical (parsed) records

```text
canonical/flights/<from>_<to>/<batch-hash>/flights.json
```

#### Job manifests

```text
jobs/<YYYY-MM-DD>/<job-id>.json
```

Example:

```text
jobs/2026-06-04/fr24-routes-actual-2026-06-03-a3f9c1.json
```

#### Reports

```text
reports/<data-kind>/<YYYY-MM-DD>/daily.json
reports/<data-kind>/<from>_<to>/routes.json
```

Example:

```text
reports/actual/2026-06-03/daily.json
reports/upcoming/2026-06-04_2026-06-07/routes.json
```

### BigQuery Storage

BigQuery holds normalized flight facts. Each table stores **at most one row per `fr24_id`**; re-downloads refresh that row instead of inserting duplicates.

A flight moves through trust levels over its lifetime:

```text
forecast  →  upcoming  →  actual (completed)
```

`actual` rows are ground truth. `upcoming` rows are operational but may change. `forecast` rows are provisional. All three are loaded into separate tables so partition expiry can differ and so queries can skip irrelevant data.

#### Query pattern: reliability overwrite

Every query reads all three tables, unions them, and keeps the most-trusted version of each flight:

```sql
SELECT * EXCEPT(trust)
FROM (
  SELECT *, 1 AS trust FROM `vn_flights.flights_actual`
  UNION ALL
  SELECT *, 2 AS trust FROM `vn_flights.flights_upcoming`
  UNION ALL
  SELECT *, 3 AS trust FROM `vn_flights.flights_forecast`
)
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY fr24_id
  ORDER BY trust ASC, loaded_at DESC
) = 1
```

`actual` beats `upcoming` beats `forecast` when the same `fr24_id` appears in more than one table during a lifecycle transition. Volumes are small (hundreds of rows per query) so reading all three tables on every query is not a cost concern.

This query is wrapped in a BigQuery **view** (`flights_current`) so reports do not need to union tables manually. Per-table uniqueness is enforced at load time (see ingest rules).

#### Table design

All three tables share the same schema. Only the name differs.

```sql
-- vn_flights.flights_actual
-- vn_flights.flights_upcoming
-- vn_flights.flights_forecast

fr24_id             STRING    NOT NULL   -- primary dedup key
flight_number       STRING    NOT NULL
airline_iata        STRING
route               STRING    NOT NULL   -- e.g. SVO-SGN
origin_iata         STRING    NOT NULL
destination_iata    STRING    NOT NULL
flight_date         DATE      NOT NULL   -- partition column; arrival date Vietnam time
scheduled_dep_at    TIMESTAMP
actual_dep_at       TIMESTAMP
scheduled_arr_at    TIMESTAMP
actual_arr_at       TIMESTAMP
aircraft_code       STRING
aircraft_reg        STRING
pax_est             INT64
loaded_at           TIMESTAMP NOT NULL   -- ingest time; used on cross-table merge in flights_current
```

Partition by `flight_date`. Cluster by `destination_iata`, `origin_iata`.

#### `flights_current` view

```sql
CREATE OR REPLACE VIEW `vn_flights.flights_current` AS
SELECT * EXCEPT(trust)
FROM (
  SELECT *, 1 AS trust FROM `vn_flights.flights_actual`
  UNION ALL
  SELECT *, 2 AS trust FROM `vn_flights.flights_upcoming`
  UNION ALL
  SELECT *, 3 AS trust FROM `vn_flights.flights_forecast`
)
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY fr24_id
  ORDER BY trust ASC, loaded_at DESC
) = 1
```

All reports and debug exports query `flights_current`. Direct table queries are only for debugging or partition-scoped operations.

#### Ingest rules

- Load to the table matching the job's `data_kind`: `actual` → `flights_actual`, etc.
- **No duplicate `fr24_id` rows** in a table: collapse each batch to one row per `fr24_id` before load; then `MERGE` on `fr24_id` (insert new, update when the incoming row is newer). Re-running download → parse → load for the same window must not multiply rows.
- Set `loaded_at = CURRENT_TIMESTAMP()` at ingest time, not the flight's departure time.
- Scheduler refreshes `upcoming` every 6 hours; `forecast` and `actual` daily.

#### Partition expiry (suggested)


| Table              | Expiry    |
| ------------------ | --------- |
| `flights_forecast` | 21 days   |
| `flights_upcoming` | 7 days    |
| `flights_actual`   | no expiry |


#### Not in BigQuery

Jobs, seeds, and airport/aircraft lookup data stay as R2/local JSON files.

## Pipeline Modules

Each module should be small enough to become a Cloudflare Worker later.

### Module Ownership Rules

Keep responsibilities strict:

- Scheduler creates route-fetch jobs from enabled routes in seed JSON only. It does not call FR24 or parse rows.
- Downloader calls FR24 (`routes=` only in v2). It writes raw request, response, and manifest objects only.
- Parser reads raw objects and writes canonical JSON to R2.
- Loader merges enriched canonical rows into the correct BigQuery table (`flights_actual`, `flights_upcoming`, or `flights_forecast`), keyed on `fr24_id` so re-downloads do not create duplicates.
- Enrichment sets `pax_est` on canonical rows before loading.
- Reporter queries BigQuery via the `flights_current` view and writes report files. It never calls FR24.

The pipeline boundary is always stored data:

```text
cron/debug command -> scheduler -> job manifest -> raw object -> canonical object (R2) -> BigQuery flights tables -> report files (R2)
```

No module should import another service's job implementation. Shared code belongs in `src/shared`, especially:

- FR24 HTTP client and pagination.
- R2/S3 object store.
- BigQuery streaming insert / load job client.
- Canonical flight contracts and dedupe keys.
- Aircraft passenger estimate rules from `data/seeds/aircraft-pax.json`.

### Pipeline Orchestration (v2)

```text
Scheduler
  -> reads data/seeds/v2-routes.json
  -> creates fr24.routes.fetch jobs (manifest under jobs/ or R2)

Downloader
  -> saves raw FR24 objects to R2
  -> updates job manifest

Parser
  -> reads raw prefix
  -> writes canonical JSON to R2

Enrichment
  -> reads canonical prefix
  -> sets pax_est on each row

Loader
  -> MERGE enriched rows into flights_actual / flights_upcoming / flights_forecast (dedupe key: fr24_id)

Reporter
  -> writes reports/daily, reports/upcoming, reports/forecast
```

Future orchestration (inbound, analyzer, vocabulary updates): [README-future.md](./README-future.md).

### 1. Route seeds (not a service)

Scheduler loads enabled routes from `data/seeds/v2-routes.json` and batches them (15 per FR24 request). Supporting seeds: `airports.json`, `v2-origin-airports.json`, `aircraft-pax.json`.

### 2. Scheduler / Orchestrator Service

Purpose:

- Read enabled routes from `v2-routes.json`, recent job manifests, and runtime limits.
- Decide which date windows and route batches must run.
- Create `fr24.routes.fetch`, parse, index, enrich, and report jobs.
- Enforce API-credit budgets.
- Avoid repeating raw FR24 requests when the exact object exists.

Inputs:

- Route seed file.
- Job manifest files (completed / failed).
- Runtime policy (`data/config/scheduler-policy.json` or env defaults).
- Current date/time.

Outputs:

- Job manifest files only.

It should not expose HTTP listeners. It may either create manifests for workers or run the local pipeline directly in debug mode.

## Autonomous Scheduler Plan

The system must know what to scan without a user clicking anything. Scheduler input is:

- `data/seeds/v2-routes.json`: enabled route strings only (`enabled` not `false`).
- `data/jobs/**`: previous completed/skipped/failed manifests.
- Existing R2 raw objects: used as an idempotency check.
- Daily request budget and per-run request budget.
- Current time in Vietnam timezone.

### Route Batching

- Read route seeds where `enabled` is not `false`.
- Sort routes alphabetically for stable batches.
- Split into batches of 15 routes (FR24 route limit).
- Each batch gets a deterministic ID:

```text
routes_YYYY-MM-DD_<data_kind>_<date_from>_<date_to>_<hash(routes)>
```

### Automatic Date Windows

The scheduler creates these windows automatically:


| `data_kind` | Window                      | Frequency            | Purpose                                   |
| ----------- | --------------------------- | -------------------- | ----------------------------------------- |
| `actual`    | yesterday                   | daily                | past arrival truth                        |
| `actual`    | today - 2 through today - 7 | daily rolling repair | catch late FR24 completion or missed jobs |
| `actual`    | configurable backfill range | debug/manual only    | historical rebuild                        |
| `upcoming`  | now through +72 hours       | every 6 hours        | airport outreach                          |
| `forecast`  | +4 through +14 days         | daily                | traffic outlook                           |


Why `forecast` starts at +4: the next 72 hours are already covered by `upcoming`, and charter schedules can be volatile. Overlap is allowed only when `data_kind` differs.

### Idempotency Rules

Before a FR24 call, downloader checks the expected R2 key:

```text
raw/fr24/routes/data_kind=<data_kind>/date_from=<YYYY-MM-DD>/date_to=<YYYY-MM-DD>/batch=<hash>/response.json
```

If `response.json` exists for that batch/window and the job is not forced, skip the FR24 call and write a skipped manifest.

If a completed manifest already exists for the same batch/window (including `rowCount: 0` with no `response.json`), skip the FR24 call unless `--force`.

### Failure Retry Rules

- Failed FR24 jobs are retried on the next cron run.
- Retry up to 3 times per deterministic job ID.
- After 3 failures, write `status=failed_permanent` and continue with the next batch.
- Debug command can run with `--force` to re-fetch a raw object.

### Request Budget Policy

Default policy:

```json
{
  "routesPerRequest": 15,
  "maxRequestsPerCronRun": 20,
  "maxRequestsPerDay": 80,
  "minRequestDelayMs": 3500,
  "actualRepairDays": 7,
  "upcomingHours": 72,
  "forecastStartDays": 4,
  "forecastEndDays": 14
}
```

With 240 route seeds and 15 routes per request, one full window is 16 FR24 requests. That means:

- `actual yesterday`: 16 requests.
- one `upcoming 72h` run: 16 requests.
- one `forecast +4..+14` run: 16 requests.

If the daily budget is too small, scheduler prioritizes:

1. `upcoming` (airport outreach).
2. `actual yesterday`.
3. `actual repair`.
4. `forecast`.

### Debug Modes

Debug commands do not start listeners. They run a bounded pipeline action and exit:

```bash
npm run v2:daily
npm run v2:download-routes -- --data-kind upcoming --date-from 2026-06-04 --date-to 2026-06-07
npm run v2:parse-prefix -- --prefix raw/fr24/routes/...
npm run v2:index-prefix -- --prefix normalized/flights/...
npm run v2:enrich-flights -- --date-from 2026-06-04 --date-to 2026-06-07
npm run v2:report -- --data-kind upcoming --date-from 2026-06-04 --date-to 2026-06-07
```

Debug commands always require explicit date windows unless the command is `v2:daily` (scheduler picks windows from policy).

### 3. Download Service

Purpose:

- Execute FR24 API calls.
- Save `request.json` and `manifest.json` for every job; save `response.json` only when FR24 returns at least one flight.
- Never parse business meaning.
- Do not write `response.json` when FR24 returns an empty `data` array (`rowCount: 0` on the manifest only).

Job type (v2):

- `fr24.routes.fetch`

Rules:

- Check R2 object existence before calling FR24.
- Use 14-day maximum date windows for historical range calls.
- Respect FR24 rate limits with per-job delay.
- Use route batches as the default.
- Do not run full Moscow outbound scans by default.
- Do not filter, normalize, score, or deduplicate rows.

Manifest shape:

```json
{
  "jobType": "fr24.routes.fetch",
  "dataKind": "actual",
  "dateFrom": "2026-05-20",
  "dateTo": "2026-05-27",
  "query": {
    "routes": ["SVO-SGN", "ALA-CXR"]
  },
  "requestCount": 1,
  "rowCount": 11,
  "startedAt": "2026-06-04T00:00:00Z",
  "finishedAt": "2026-06-04T00:00:05Z",
  "rawRefs": ["raw/fr24/routes/.../response.json"]
}
```

When `rowCount` is `0`, omit `rawRefs` (no `response.json` in R2). Idempotency uses the job manifest, not a zero-result object.

### 4. Parse Service

Purpose:

- Read raw FR24 objects.
- Convert FR24 records to canonical flight records.
- Write canonical records to object storage.

It should not update route seed files or BigQuery directly.

Canonical flight shape (R2 — minimal fields, loaded as-is into BigQuery):

```json
{
  "id": "c65539",
  "fr24Id": "c65539",
  "flightNumber": "VJ8924",
  "airlineIata": "VJ",
  "originIata": "SVO",
  "destinationIata": "SGN",
  "route": "SVO-SGN",
  "dataKind": "actual",
  "scheduledDepartureAt": null,
  "actualDepartureAt": "2026-05-22T14:00:00Z",
  "scheduledArrivalAt": null,
  "actualArrivalAt": "2026-05-22T22:40:00Z",
  "aircraftCode": "A333",
  "aircraftRegistration": "VN-A...",
  "paxEst": null
}
```

`paxEst` is filled by enrichment before the loader runs.

### 5. Enrichment Service

Purpose:

- Set `pax_est` from `aircraft-pax.json` rules only.

Passenger estimate priority:

1. Exact aircraft code match.
2. Aircraft family prefix rule.
3. Aircraft model text pattern.
4. System default.

It should not load to BigQuery or modify route seeds.

### 6. Loader Service

Purpose:

- Read enriched canonical records from R2.
- Merge rows into the BigQuery table matching the job's `data_kind`.
- Set `loaded_at` to current timestamp on every row.
- Enforce **one row per `fr24_id`** in the target table (no duplicates from re-downloads).

Load steps:

1. Collapse the canonical batch to one row per `fr24_id` (if the same flight appears in multiple raw objects).
2. `MERGE` into `flights_actual`, `flights_upcoming`, or `flights_forecast` on `fr24_id` — insert when missing, update when the new row has a newer `loaded_at` or changed fields.
3. Use `src/shared/enrichment/dedupe.js` (or equivalent) for batch collapse; use BigQuery `MERGE` for cross-load idempotency.

Cross-table overlap (`forecast` vs `upcoming` vs `actual`) is still resolved by the `flights_current` view, not by deleting rows from other tables.

### Future modules

Analysis, inbound discovery, flight-number monitoring, aircraft audit, and periodic audit: [README-future.md](./README-future.md).

## FR24 Credit Usage Policy

FR24 credits are limited. In v2 the scheduler uses `**routes=` batch queries only**.

### Credit Rules

- Batch up to 15 routes per FR24 request.
- Split date ranges into 14-day chunks.
- Skip if the exact raw object already exists in R2.
- Do not persist empty FR24 `data` arrays to R2.

### Credit Budget Guards

```json
{
  "dailyRouteRequests": 20,
  "minRequestDelayMs": 3500
}
```

No job without `dateFrom`, `dateTo`, and `routes`. Discovery modes and extra budgets: [README-future.md](./README-future.md).

## Job Scheduling

Production has one kind of entry point: **scheduler cron**. It starts the scheduler, and the scheduler decides what to do from `scheduler-policy.json`, seed files, manifests, and existing R2 objects.

Cron should not call downloader/parser/indexer scripts directly.

### Cron Frequency Plan (v2)

```text
*/30 * * * *      v2-scheduler-cron
```

On each run:

1. Load `data/config/scheduler-policy.json`.
2. Load route seeds and calculate deterministic route batches.
3. Check pending/failed manifests first.
4. Create or run missing jobs for due windows, respecting request budget.
5. Parse/index/enrich any raw/canonical objects that are ready.
6. Write report files for changed `data_kind` windows.

Due windows:


| Window           | Due rule                     | `data_kind` | Purpose                              |
| ---------------- | ---------------------------- | ----------- | ------------------------------------ |
| upcoming         | every 6 hours                | `upcoming`  | Airport outreach (1.2)               |
| actual yesterday | daily after local midnight   | `actual`    | Past arrivals (1.1)                  |
| actual repair    | daily, last 7 completed days | `actual`    | Catch late completions / failed jobs |
| forecast         | daily                        | `forecast`  | Two-week outlook (1.3)               |


Summaries are written as report files and can also be exported by debug command:

```text
reports/daily/data_kind=<kind>/date=<YYYY-MM-DD>/summary.json
reports/routes/data_kind=<kind>/date_from=<YYYY-MM-DD>/date_to=<YYYY-MM-DD>/summary.json
```

Discovery crons: [README-future.md](./README-future.md).

### Backfill Jobs

Manual jobs with `dateFrom`, `dateTo`, `routes`, and `dataKind`. Use `routes=` only. The [first launch](#first-launch-route-bootstrap) ±30-day window is a one-time bootstrap, not the daily cron schedule.

## Runtime Configuration

There are no HTTP listeners and no public API keys in v2. Runtime is cron/debug only.

Environment variables:

```text
FR24_API_TOKEN=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_RAW=flight-scheduler-raw
R2_BUCKET_NORMALIZED=flight-scheduler-normalized
BIGQUERY_PROJECT=...
BIGQUERY_DATASET=vn_flights
```

Later on Cloudflare Workers:

- Store keys as Worker secrets.
- Bind R2 bucket as `BUCKET`.
- BigQuery is accessed over HTTP from Node.js or Workers (use service account JSON or Workload Identity).
- Cron-triggered Worker is the only production entry point.

### Optional Scheduler Policy File

If env defaults are not enough, store policy in:

```text
data/config/scheduler-policy.json
```

Example:

```json
{
  "timezone": "Asia/Ho_Chi_Minh",
  "routesPerRequest": 15,
  "maxRequestsPerCronRun": 20,
  "maxRequestsPerDay": 80,
  "minRequestDelayMs": 3500,
  "actual": {
    "enabled": true,
    "yesterday": true,
    "repairDays": 7
  },
  "upcoming": {
    "enabled": true,
    "hoursAhead": 72,
    "cron": "0 */6 * * *"
  },
  "forecast": {
    "enabled": true,
    "startDaysAhead": 4,
    "endDaysAhead": 14,
    "cron": "0 5 * * *"
  },
  "priorityOrder": ["upcoming", "actual_yesterday", "actual_repair", "forecast"],
  "retry": {
    "maxAttempts": 3,
    "forceRequiresDebugFlag": true
  }
}
```

## Debug And Report Contract

Debug commands are the only manual control interface. They run and exit; they do not listen on a port.

### Debug commands

```text
npm run v2:cron
npm run v2:daily
npm run v2:download-routes -- --data-kind actual --date-from YYYY-MM-DD --date-to YYYY-MM-DD --routes SVO-SGN,ALA-CXR
npm run v2:parse-prefix -- --prefix raw/fr24/routes/...
npm run v2:index-prefix -- --prefix normalized/flights/...
npm run v2:enrich-flights -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD
npm run v2:report -- --data-kind upcoming --date-from YYYY-MM-DD --date-to YYYY-MM-DD
```

### Report outputs

Reports are files, not HTTP responses:

```text
reports/daily/data_kind=actual/date=2026-06-03/summary.json
reports/daily/data_kind=upcoming/date=2026-06-04/summary.json
reports/daily/data_kind=forecast/date=2026-06-08/summary.json
reports/routes/data_kind=actual/date_from=2026-05-20/date_to=2026-05-27/summary.json
```

Report flight row shape:


| Field                                   | Description                         |
| --------------------------------------- | ----------------------------------- |
| `flightNumber`                          | e.g. `VJ8924`                       |
| `route`                                 | e.g. `SVO-SGN`                      |
| `dataKind`                              | `actual`, `upcoming`, or `forecast` |
| `flightDate`                            | calendar date for grouping          |
| `actualDepartureAt` / `actualArrivalAt` | ISO timestamps                      |
| `paxEst`                                | estimated passengers                |


Analysis and discovery debug commands: [README-future.md](./README-future.md).

## Folder Architecture

Keep the local Node.js version close to the future Cloudflare Worker split.

```text
Flight Scheduler/version-2/
  README.md
  README-future.md
  package.json
  .env.example

  src/
    shared/
      config/
        env.js
        limits.js
      contracts/
        flight.js
        job.js
      storage/
        object-store.js        # R2/S3/local
        bigquery-client.js     # BigQuery insert / query
      fr24/
        client.js
        pagination.js
        adapters.js
      enrichment/
        pax-estimate.js
        dedupe.js

    services/
      downloader/
        jobs/fr24-routes.js
      parser/
      indexer/
      enrichment/
      loader/
      reporter/
      scheduler/

  data/
    config/
      scheduler-policy.json
    seeds/
      airports.json
      aircraft-pax.json
      russian-speaking-countries.json
      v2-routes.json
      v2-origin-airports.json
      v2-flight-numbers.json
    jobs/                      # job manifests, not BigQuery
    local-r2/
      raw/
      normalized/

  migrations/
    bq-flights-schema.json     # BigQuery table schema (JSON Schema format)

  scripts/
    v2-cron.mjs
    v2-daily-run.mjs
    v2-download-routes.mjs
    v2-parse-prefix.mjs
    v2-enrich-flights.mjs
    v2-load-bigquery.mjs
    v2-report.mjs
```

Future Cloudflare workers: scheduler, downloader, parser, indexer, enrichment, reporter. Analyzer worker: see [README-future.md](./README-future.md).

The shared modules should avoid Node-only APIs where possible so they can move into Workers with minimal changes.

## Implementation Phases

### Phase 1: Local Node.js Pipeline (v2)

- Seeds in `data/seeds/` (routes matrix, origins, airports).
- R2-compatible storage (local folder in dev).
- BigQuery dataset `vn_flights` with tables `flights_actual`, `flights_upcoming`, `flights_forecast` and view `flights_current`.
- Route downloader → parser → enrichment → loader (BigQuery MERGE on `fr24_id`, no duplicate rows).
- Report files written to R2 `reports/`.

### Phase 2: Discovery And Scoring

See [README-future.md](./README-future.md).

### Phase 3: Cloudflare Deployment

- Workers per service; Cron for v2 jobs.
- Raw and canonical JSON in R2 bucket `vn-flights`.
- BigQuery for normalized flight facts.
- Seeds and job manifests outside BigQuery.

## Key Decisions

- Three business uses: past arrivals, upcoming outreach, ~2-week forecast — via `data_kind`.
- All Vietnam airports in `airports.json` are equal; route matrix is in `v2-routes.json`; routes with no flights after ±30d bootstrap get `enabled: false`.
- FR24 `routes=` batches only; `data_kind` comes from the job time window.
- Flight rows are minimal: no provider, sourceMethods, rawRefs, confidence, or paxEstimateMethod in storage.
- BigQuery stores normalized flights only, across 3 tables (one row per `fr24_id` each) + `flights_current` view for cross-table trust.
- Jobs, routes, and airport metadata live in JSON files / R2, not BigQuery.
- Raw data immutable in R2; canonical JSON is the pre-load audit record.
- Pipeline steps communicate through stored objects; BigQuery is the terminal deduped load target.
- No public API, no frontend listener, no OpenAPI contract in v2.
- Cron is the production entry point; debug scripts are the manual entry point.
- Discovery and analyzers deferred to [README-future.md](./README-future.md).

## Migrating from v1 (parent `Flight Scheduler/`)

### Copy into v2 (done)

All seed JSON is in `version-2/data/seeds/` — you can delete the parent `data/seeds/` when you remove v1.

### Keep from v1 when building v2 code


| Item                                                    | Why                                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `**server/services/flightradar24.js**`                  | FR24 HTTP client: `splitDateRange`, `fetchRoutes`, pagination, rate-limit handling |
| `**server/services/pax-estimate.js**`                   | `pax_est` from `aircraft-pax.json` (move under `src/shared/enrichment/`)           |
| `**server/lib/fs-json.js**`                             | Small read/write JSON helper                                                       |
| `**.env` → `FR24_API_TOKEN**`                           | Required for downloads                                                             |
| `**data/cache/fr24/cis-vn_*.json**` (optional, ~124 KB) | One prior FR24 sample export; useful to test parser adapters, not v2 R2 layout     |


### Do not need from v1


| Item                                                           | Why                                                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `**data/cache/raw/**` (~98 MB)                                 | Aviation Edge / Aviationstack **arrival-timetable** cache (`{date}_{IATA}.json`). Different API and schema than v2 FR24 route batches. |
| `**data/normalized/`**                                         | v1 normalized shape (`dep_iata`, `arr_iata`, …), not v2 BigQuery schema                                                                |
| `**data/cache/airports/**`                                     | Aviation Edge departure-country lookups; v2 uses `v2-origin-airports.json` + `russian-speaking-countries.json`                         |
| `**data/cache/status/`, audits, manifests**                    | v1 scheduler/cache bookkeeping only                                                                                                    |
| `**server/services/aviation-edge.js`**, `**aviationstack.js**` | v2 is FR24-only per spec                                                                                                               |
| `**public/**` (v1 dashboard)                                   | v2 has no frontend listener; use report files / exports                                                                                |
| **Prefetch / fill-gap scripts**                                | v1 near-term gap workarounds; v2 uses FR24 `actual` / `upcoming` / `forecast` route jobs                                               |


### Reference only (optional)

- `**scripts/fetch-fr24-cis-vn.mjs`** — shows route vs outbound patterns; v2 should use **routes-only** from `v2-routes.json`, not Moscow outbound pagination.
- **Parent `README.md`, `task.md`** — v1 operational notes, not implementation spec for v2.

