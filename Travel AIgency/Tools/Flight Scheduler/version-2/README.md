# Flight Scheduler Version 2

## Goal

Version 2 should rebuild Flight Scheduler as a small FR24-only data pipeline for Vietnam inbound tourism analysis.

The system should answer:

- Which flights actually flew from Russian-speaking / CIS origin markets to Vietnam?
- Which routes are regular, seasonal, charter-like, or no longer useful?
- Which new origin airports appear in Vietnam inbound traffic and should be added to our vocabulary?
- How many likely passengers arrived, grouped by date, airport, route, airline, and flight number?
- Which routes or flight numbers need more monitoring because route data, inbound data, or flight-number data disagree?

The main design rule is that each step communicates through stored data, not direct function calls. A downloader saves raw FR24 output. A parser reads raw output and writes normalized records. An analyzer reads normalized records and writes reports, route scores, and suggested vocabulary updates.

Target runtime:

- Node.js services now.
- Cloudflare Workers later.
- Cloudflare R2 as S3-compatible object storage.
- Cloudflare D1 for small relational indexes, job state, route priority, and API metadata.
- Cloudflare Queues or Cron Triggers later for scheduled pipeline execution.

## FR24-Only Source Strategy

FR24 gives several useful ways to ask for flight data. The method should depend on the question.

### 1. Specific Routes

Example:

```text
routes=SVO-DAD,ALA-DAD,TAS-DAD
```

Use this as the primary method.

Best for:

- Known or suspected CIS to Vietnam routes.
- DAD charter discovery.
- Cheap historical checks over fixed date windows.
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

### 2. Origin Airport Outbound

Example:

```text
outbound=ALA
outbound=TAS
outbound=VVO
```

Use as a supplement, not as the default.

Best for:

- Smaller CIS origin airports.
- Discovering new Vietnam destinations from one known origin.
- Checking whether a hub has Vietnam flights not represented in the route matrix.

Use carefully for:

- `SVO`, `DME`, `VKO`.

Large Moscow airports produce many pages of unrelated flights. Outbound pagination finds scheduled Vietnam flights, but it is expensive and can still miss DAD charters unless we paginate deeply.

### 3. Vietnam Airport Inbound

Example:

```text
inbound=DAD
inbound=SGN
inbound=HAN
```

Use for discovery and monitoring, not for the main CIS route fetch.

Best for:

- Finding new origin airports that land at Vietnam destinations.
- Checking if our route vocabulary is missing something.
- Creating a raw list of all source airports for an LLM or analyst to review.
- Monitoring important destination airports like DAD, SGN, HAN, CXR, PQC.

Weakness:

- Very noisy.
- Most arrivals are irrelevant regional flights.
- Bad primary method for CIS charters.

### 4. Flight Number Monitoring

Example:

```text
flight=VJ8924
flight=SU292
flight=VN62
```

Use after a flight number is discovered.

Best for:

- Checking repeat patterns.
- Finding route changes for the same flight number.
- Detecting data gaps when route queries and inbound queries disagree.
- Monitoring charter numbers that move between routes or dates.

Weakness:

- Not a discovery method unless we already know the flight number.

### 5. Time Modes

Use FR24 historical data for the main dataset.

Use FR24 future/scheduled data only for forecasting and planning dashboards. Charter and tour flights can appear late, so future data should be treated as provisional.

Use FR24 realtime data for today monitoring and operational alerts, not for building historical truth.

## Charter Flights And Future Data

Charter flights should not be expected to appear reliably in future/scheduled data early.

FR24 may show a charter in future data if the flight plan or schedule is already known, but tour charters often appear late, change flight numbers, change times, or only become reliable when the aircraft is close to operating. Because of that, future data should be treated as a forecast, not as proof that the flight will or will not happen.

The system should solve this with progressive confirmation:

1. Historical FR24 route data is the source of truth for what actually flew.
2. Future/scheduled FR24 data is stored as provisional forecast data.
3. Live/realtime FR24 data upgrades a provisional or expected flight into a confirmed active flight.
4. Completed historical data upgrades the flight into final actual data.
5. Route and flight-number monitoring keep checking known charter patterns even when future data is empty.

### Method By Time Window

Historical data:

```text
GET /api/flight-summary/full
flight_datetime_from=YYYY-MM-DD 00:00:00
flight_datetime_to=YYYY-MM-DD 23:59:59
routes=SVO-DAD,ALA-DAD,TAS-DAD
```

Use historical route batches as the main dataset. Supplement with `airports=inbound:DAD` for discovery and `airports=outbound:ALA` for smaller origin hubs.

Live / today data:

```text
GET /api/flight-summary/full
flight_datetime_from=<now or start of day>
flight_datetime_to=<near future or end of day>
routes=SVO-DAD,ALA-DAD,TAS-DAD
```

Also check:

```text
airports=inbound:DAD
airports=inbound:SGN
airports=inbound:HAN
airports=inbound:CXR
```

Live data is used to catch charters as they become visible and to confirm same-day operations.

Future data:

```text
GET /api/flight-summary/full
flight_datetime_from=<future date>
flight_datetime_to=<future date>
routes=SVO-DAD,ALA-DAD,TAS-DAD
```

If FR24 returns future/scheduled rows through the same summary endpoint or another documented future endpoint on the active plan, store those rows with:

```json
{
  "scheduleMode": "future",
  "confidence": "provisional",
  "needsRefresh": true
}
```

Do not mark an empty future route response as proof that no charter will operate. Store it as a zero-result forecast check, then refresh later.

### Is The Route Endpoint Enough?

Route queries are enough for known routes:

```text
SVO-DAD, ALA-DAD, TAS-DAD, SVO-SGN, SVO-HAN, SVO-CXR
```

Route queries are not enough for unknown new charter origins because they only query routes already in the vocabulary.

The full method should be:

```text
Primary: route checks
Discovery: inbound airport checks
Supplement: small-origin outbound checks
Monitor: flight numbers
```

### Refresh Cadence

Recommended refresh plan:

- Historical backfill: daily, for yesterday and recent completed days.
- Future route forecast: daily for the next 7 to 30 days.
- Near-term refresh: every 6 to 12 hours for the next 72 hours.
- Live/today refresh: every 30 to 60 minutes for high-priority routes and top inbound airports.
- Inbound discovery: weekly, or on selected sample days.
- Route priority recalculation: weekly.

The dashboard should show different confidence states:

- `historical_actual`: completed flight, highest confidence.
- `live_confirmed`: active or same-day observed flight.
- `future_provisional`: scheduled or forecast row from FR24.
- `expected_from_pattern`: no future row yet, but route/flight number has repeated historically.
- `zero_forecast_check`: future check returned no rows, but this does not cancel the route.

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
curl "https://fr24api.flightradar24.com/api/flight-summary/full?flight_datetime_from=2026-05-20%2000:00:00&flight_datetime_to=2026-05-27%2023:59:59&routes=SVO-DAD,ALA-DAD,TAS-DAD&limit=2000&sort=asc" \
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
      "dest_iata": "DAD",
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

Sample outcome:

- `routes=SVO-DAD,VVO-DAD,ALA-DAD`, 2026-05-20 to 2026-05-27: 11 DAD legs.
- Included `SVO-DAD` flights `VJ8924`, `VJ8932`.
- Included `ALA-DAD` flights `VJ52`, `DV5328`, `DV5340`.

### Inbound Airport Request

Use for discovery, not as the main source.

```bash
curl "https://fr24api.flightradar24.com/api/flight-summary/full?flight_datetime_from=2026-05-23%2000:00:00&flight_datetime_to=2026-05-23%2023:59:59&airports=inbound:DAD&limit=20&sort=asc" \
  -H "Authorization: Bearer $FR24_API_TOKEN" \
  -H "Accept: application/json" \
  -H "Accept-Version: v1"
```

The plan can cap responses around 20 rows even when a larger `limit` is requested. Pagination should advance `flight_datetime_from` to the last row's `first_seen` plus one second.

Observed result from our sample:

- `inbound:DAD`, 2026-05-23: 131 total arrivals after pagination.
- Only 2 were CIS-origin, so this is noisy but useful for discovering unknown origins.

### Outbound Airport Request

Use for smaller CIS origin airports.

```bash
curl "https://fr24api.flightradar24.com/api/flight-summary/full?flight_datetime_from=2026-05-20%2000:00:00&flight_datetime_to=2026-05-27%2023:59:59&airports=outbound:ALA&limit=20&sort=asc" \
  -H "Authorization: Bearer $FR24_API_TOKEN" \
  -H "Accept: application/json" \
  -H "Accept-Version: v1"
```

Do not use this as the default for `SVO`, `DME`, or `VKO`. Moscow airports create too many unrelated pages.

### Flight Number Request

Use only after the system discovers a flight number worth monitoring.

The exact FR24 filter name for flight-number lookup should be confirmed against the active FR24 docs before implementation. In v2, keep this behind the `fr24.flight-number.fetch` job type and implement it only after route and inbound pipelines are stable.

Expected use:

```text
flight number: VJ8924
date range: 2026-05-14 to 2026-05-30
purpose: check repeat pattern and possible route changes
```

### Internal Pipeline API Examples

Create a route fetch job:

```bash
curl -X POST "https://api.example.com/v1/download/fr24/routes" \
  -H "X-API-Key: $FLIGHT_SCHEDULER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "dateFrom": "2026-05-20",
    "dateTo": "2026-05-27",
    "routes": ["SVO-DAD", "ALA-DAD", "TAS-DAD"]
  }'
```

Reply:

```json
{
  "jobId": "job_20260604_routes_001",
  "status": "queued",
  "type": "fr24.routes.fetch",
  "dateFrom": "2026-05-20",
  "dateTo": "2026-05-27",
  "input": {
    "routes": ["SVO-DAD", "ALA-DAD", "TAS-DAD"]
  },
  "outputPrefix": "raw/fr24/routes/date_from=2026-05-20/date_to=2026-05-27/batch=SVO-DAD__ALA-DAD__TAS-DAD/"
}
```

Parse a raw prefix:

```bash
curl -X POST "https://api.example.com/v1/parse/prefix" \
  -H "X-API-Key: $FLIGHT_SCHEDULER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prefix": "raw/fr24/routes/date_from=2026-05-20/date_to=2026-05-27/"
  }'
```

Reply:

```json
{
  "jobId": "job_20260604_parse_001",
  "status": "queued",
  "type": "parse.prefix"
}
```

Query normalized flights:

```bash
curl "https://api.example.com/v1/flights?dateFrom=2026-05-20&dateTo=2026-05-27&destinationIata=DAD" \
  -H "X-API-Key: $FLIGHT_SCHEDULER_API_KEY"
```

Reply:

```json
[
  {
    "id": "fr24:example-fr24-id",
    "flightNumber": "VJ8924",
    "airlineIata": "VJ",
    "route": "SVO-DAD",
    "originIata": "SVO",
    "destinationIata": "DAD",
    "actualDepartureAt": "2026-05-22T14:00:00Z",
    "actualArrivalAt": "2026-05-22T22:40:00Z",
    "aircraftCode": "A333",
    "aircraftRegistration": "VN-A...",
    "paxEst": 300,
    "sourceMethods": ["routes"],
    "confidence": 90
  }
]
```

## Recommended Full-Picture Method

The best approach is a hybrid FR24 strategy:

1. Primary historical route matrix fetch.
2. Periodic inbound airport discovery.
3. Selective outbound checks for smaller CIS hubs.
4. Flight-number monitoring for discovered important flights.
5. Route scoring so no-result routes are kept but gradually lowered in priority.

Do not use full inbound Vietnam airport scans or full Moscow outbound scans as the main source.

## Vocabulary

The system needs a versioned vocabulary. This is the source of truth for what we care about and why.

### Destination Airports

Keep the existing Vietnam airport seed:

```text
data/seeds/airports.json
```

Initial priority:

- Tier 1: `DAD`, `SGN`, `HAN`, `CXR`, `PQC`
- Tier 2: `VDO`, `HPH`, `VCA`, `HUI`
- Tier 3: `DLI`, `BMV`, `VII`, `THD`, `VDH`, `PXU`

### Origin Airports

Create a v2 origin vocabulary with fields:

```json
{
  "iata": "ALA",
  "icao": "UAAA",
  "city": "Almaty",
  "country": "Kazakhstan",
  "countryIso2": "KZ",
  "market": "russian-speaking",
  "tier": 1,
  "scanOutbound": true,
  "notes": "Known DAD charter source"
}
```

Suggested initial tiers:

- Tier 1: `SVO`, `DME`, `VKO`, `ALA`, `TAS`, `NQZ`, `VVO`, `OVB`
- Tier 2: `LED`, `KJA`, `IKT`, `KHV`, `FRU`, `GYD`, `EVN`, `MSQ`
- Tier 3: any airport discovered from inbound scans or flight-number monitoring.

Known initial origin airport list:

```text
SVO, DME, VKO, ALA, TAS, NQZ, VVO, OVB, LED, KJA, IKT, KHV, FRU, GYD, EVN, MSQ
```

### Route Vocabulary

Create route entries from origin x destination pairs, but give every route its own priority.

```json
{
  "route": "ALA-DAD",
  "originIata": "ALA",
  "destinationIata": "DAD",
  "priority": 1,
  "status": "active",
  "method": "routes",
  "lastSeenAt": "2026-05-28T04:08:00Z",
  "zeroResultCount": 0,
  "positiveResultCount": 8,
  "notes": "Known charter/tourism route"
}
```

Important: store zero-result route fetches. A zero result is useful data because it tells the scheduler to lower priority later instead of repeating expensive calls blindly.

### Flight Number Vocabulary

Create tracked flight-number entries:

```json
{
  "flightNumber": "VJ8924",
  "airlineIata": "VJ",
  "priority": 1,
  "knownRoutes": ["SVO-DAD"],
  "monitor": true,
  "reason": "DAD charter found by route scan"
}
```

Known observed or candidate flight numbers:

```text
VJ8924, VJ8932, VJ52, DV5328, DV5340, VN62, SU292, SU294, SU298, N43545, VJ7989
```

Notes:

- `VJ8924`, `VJ8932`: observed `SVO-DAD`.
- `VJ52`, `DV5328`, `DV5340`: observed `ALA-DAD`.
- `VN62`: observed `SVO-HAN`.
- `SU292`: observed `SVO-SGN`.
- `SU294`, `SU298`, `N43545`: observed `SVO-CXR`.
- `VJ7989`: observed `VVO-HAN`, not `VVO-DAD`, in the previous FR24 result.

### Airline Vocabulary

Known airline codes from the observed sample:

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

Use R2/S3 for raw and derived data objects. Use D1 for indexes, job state, and small queryable tables.

### R2 Buckets

Recommended buckets:

- `flight-scheduler-raw`
- `flight-scheduler-normalized`
- `flight-scheduler-reports`

If fewer buckets are easier, use one bucket with top-level prefixes.

### R2 Object Keys

Raw FR24 route fetch:

```text
raw/fr24/routes/date_from=2026-05-20/date_to=2026-05-27/batch=SVO-DAD__ALA-DAD__TAS-DAD/request.json
raw/fr24/routes/date_from=2026-05-20/date_to=2026-05-27/batch=SVO-DAD__ALA-DAD__TAS-DAD/response.json
raw/fr24/routes/date_from=2026-05-20/date_to=2026-05-27/batch=SVO-DAD__ALA-DAD__TAS-DAD/manifest.json
```

Raw inbound airport fetch:

```text
raw/fr24/inbound/airport=DAD/date_from=2026-05-23/date_to=2026-05-23/page=001/response.json
raw/fr24/inbound/airport=DAD/date_from=2026-05-23/date_to=2026-05-23/manifest.json
```

Raw outbound airport fetch:

```text
raw/fr24/outbound/airport=ALA/date_from=2026-05-20/date_to=2026-05-27/page=001/response.json
raw/fr24/outbound/airport=ALA/date_from=2026-05-20/date_to=2026-05-27/manifest.json
```

Zero-result route fetch:

```text
raw/fr24/routes/date_from=2026-05-20/date_to=2026-05-27/batch=VVO-DAD/zero.json
```

Normalized records:

```text
normalized/flights/date=2026-05-22/part-000.json
normalized/routes/date_from=2026-05-20/date_to=2026-05-27/routes.json
normalized/airports/date_from=2026-05-20/date_to=2026-05-27/discovered-origin-airports.json
```

Reports:

```text
reports/daily/date=2026-05-22/summary.json
reports/route-score/date=2026-05-27/routes.json
reports/llm-review/inbound-origins/date=2026-05-27/input.json
reports/llm-review/inbound-origins/date=2026-05-27/output.json
```

### D1 Tables

Use D1 only for indexes and API querying, not as the only copy of raw data.

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  date_from TEXT,
  date_to TEXT,
  input_json TEXT NOT NULL,
  output_prefix TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE route_vocabulary (
  route TEXT PRIMARY KEY,
  origin_iata TEXT NOT NULL,
  destination_iata TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'candidate',
  method TEXT NOT NULL DEFAULT 'routes',
  zero_result_count INTEGER NOT NULL DEFAULT 0,
  positive_result_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  last_checked_at TEXT,
  notes TEXT
);

CREATE TABLE airport_vocabulary (
  iata TEXT PRIMARY KEY,
  icao TEXT,
  city TEXT,
  country TEXT,
  country_iso2 TEXT,
  role TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 3,
  scan_inbound INTEGER NOT NULL DEFAULT 0,
  scan_outbound INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  notes TEXT
);

CREATE TABLE flight_number_vocabulary (
  flight_number TEXT PRIMARY KEY,
  airline_iata TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  monitor INTEGER NOT NULL DEFAULT 0,
  known_routes_json TEXT,
  last_seen_at TEXT,
  notes TEXT
);

CREATE TABLE flight_index (
  id TEXT PRIMARY KEY,
  flight_number TEXT,
  route TEXT,
  origin_iata TEXT,
  destination_iata TEXT,
  scheduled_departure_at TEXT,
  actual_departure_at TEXT,
  scheduled_arrival_at TEXT,
  actual_arrival_at TEXT,
  aircraft_code TEXT,
  aircraft_registration TEXT,
  pax_est INTEGER,
  source_methods TEXT NOT NULL,
  raw_refs_json TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 50,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE airport_lookup_cache (
  iata TEXT PRIMARY KEY,
  icao TEXT,
  name TEXT,
  city TEXT,
  country TEXT,
  country_iso2 TEXT,
  latitude REAL,
  longitude REAL,
  source TEXT NOT NULL,
  raw_ref TEXT,
  updated_at TEXT NOT NULL
);
```

## Pipeline Modules

Each module should be small enough to become a Cloudflare Worker later.

### Module Ownership Rules

Keep responsibilities strict:

- Scheduler creates jobs only. It does not call FR24, parse rows, or score routes.
- Downloader calls FR24 only. It writes raw request, raw response, and manifest objects only.
- Parser reads raw objects and converts provider rows into canonical rows only.
- Indexer deduplicates canonical rows and writes queryable database records only.
- Enrichment adds passenger estimates and lookup metadata only.
- Analyzer reads indexed/enriched data and writes reports only.
- Vocabulary service stores approved airports, routes, airlines, and flight numbers only.
- API service exposes stored data and creates small jobs only. It never performs large scans inline.

The pipeline boundary is always stored data:

```text
job -> raw object -> canonical object -> indexed flight -> enriched flight -> report -> vocabulary update
```

No module should import another service's job implementation. Shared code belongs in `src/shared`, especially:

- FR24 HTTP client and pagination.
- R2/S3 object store.
- D1/SQLite repository.
- canonical flight contracts.
- dedupe keys.
- aircraft passenger estimate rules.
- route scoring formulas.

### Pipeline Orchestration

The scheduler should create small jobs from vocabulary and audit state:

```text
Scheduler
  -> creates fr24.routes.fetch jobs
  -> creates fr24.inbound.fetch jobs
  -> creates fr24.outbound.fetch jobs
  -> creates fr24.flight-number.fetch jobs

Downloader
  -> saves raw FR24 objects
  -> emits parse.prefix jobs

Parser
  -> saves canonical objects
  -> emits index.canonical jobs

Indexer
  -> deduplicates and writes flight_index
  -> emits enrich.flight-index jobs

Enrichment
  -> adds airport, aircraft, pax, airline metadata
  -> emits analyze jobs

Analyzer
  -> writes reports and route scores
  -> emits vocabulary candidate updates

Vocabulary Service
  -> stores approved candidates and route priority changes
```

### 1. Vocabulary Service

Purpose:

- Store destination airports, origin airports, routes, and flight numbers.
- Keep the existing airport lookup data so we do not repeat API calls.
- Store route priority values produced by the analyzer.
- Store candidate airports suggested by analysis after approval.

Inputs:

- Seed files.
- D1 vocabulary tables.
- LLM suggestions.
- Analysis outputs.

Outputs:

- Read-only vocabulary snapshots for the scheduler.
- Approved vocabulary changes for later jobs.

It should not call FR24 and should not decide cron timing.

### 2. Scheduler / Orchestrator Service

Purpose:

- Read vocabulary, route scores, zero-result counts, and job history.
- Create the smallest useful jobs for the next run.
- Enforce API-credit budgets.
- Prevent unbounded scans.

Inputs:

- Vocabulary tables.
- Route score reports.
- Job history.
- API-credit budget configuration.

Outputs:

- Queued jobs only.

It should not call FR24, parse data, or write reports.

### 3. Download Service

Purpose:

- Execute FR24 API calls.
- Save only raw request, raw response, and manifest objects.
- Never parse business meaning.
- Store zero-result responses.

Job types:

- `fr24.routes.fetch`
- `fr24.inbound.fetch`
- `fr24.outbound.fetch`
- `fr24.flight-number.fetch`

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
  "provider": "fr24",
  "jobType": "fr24.routes.fetch",
  "dateFrom": "2026-05-20",
  "dateTo": "2026-05-27",
  "query": {
    "routes": ["SVO-DAD", "ALA-DAD", "TAS-DAD"]
  },
  "requestCount": 1,
  "rowCount": 11,
  "isZeroResult": false,
  "startedAt": "2026-06-04T00:00:00Z",
  "finishedAt": "2026-06-04T00:00:05Z",
  "rawRefs": ["raw/fr24/routes/.../response.json"]
}
```

### 4. Parse Service

Purpose:

- Read raw FR24 objects.
- Convert FR24 records to canonical flight records.
- Write canonical records to object storage.

It should not update route scores or route vocabulary.

Canonical flight shape:

```json
{
  "id": "fr24:c65539",
  "provider": "fr24",
  "fr24Id": "c65539",
  "flightNumber": "VJ8924",
  "airlineIata": "VJ",
  "originIata": "SVO",
  "destinationIata": "DAD",
  "route": "SVO-DAD",
  "scheduledDepartureAt": null,
  "actualDepartureAt": "2026-05-22T14:00:00Z",
  "scheduledArrivalAt": null,
  "actualArrivalAt": "2026-05-22T22:40:00Z",
  "aircraftCode": "A333",
  "aircraftRegistration": "VN-A...",
  "paxEst": 300,
  "paxEstimateMethod": "aircraft-code",
  "sourceMethods": ["routes"],
  "rawRefs": ["raw/fr24/routes/.../response.json"],
  "confidence": 90
}
```

### 5. Indexer Service

Purpose:

- Read canonical flight records.
- Deduplicate records from routes, inbound, outbound, and flight-number sources.
- Write `flight_index`.
- Preserve raw object references for auditability.

Deduplication keys:

1. FR24 internal ID if present.
2. Flight number + origin + destination + actual/scheduled time bucket.
3. Aircraft registration + route + time bucket.

It should not call FR24 and should not estimate passengers.

### 6. Enrichment Service

Purpose:

- Add airport lookup metadata from local cache.
- Add airline metadata.
- Add aircraft and passenger estimates.
- Flag unknown aircraft or missing airport lookup records.

It should not deduplicate records and should not create route recommendations.

### 7. Analysis Service

Purpose:

- Score routes.
- Identify new airports.
- Compare route, inbound, outbound, and flight-number findings.
- Produce daily and period reports.

Outputs:

- Daily passenger estimates.
- Route score report.
- Candidate airport list.
- Candidate flight-number monitor list.
- Data quality issues.

Route scoring signals:

- Positive sightings in the last N checks.
- Zero-result count.
- Passenger estimate volume.
- Whether route is to Tier 1 Vietnam airports.
- Whether route was found by multiple methods.
- Whether same flight number repeats.
- Whether route appears in inbound discovery but not route vocabulary.

Suggested statuses:

- `active`
- `seasonal`
- `candidate`
- `monitor`
- `low_priority`
- `disabled`

It should not call FR24. If more raw data is needed, it should emit recommendations for the scheduler.

### 8. Inbound Discovery Analyzer

Purpose:

- Read parsed inbound arrivals for destination airports.
- Extract all origin airports.
- Produce a source-airport list for LLM or analyst review.

This process is not for final route coverage. It is for discovering missing origins.

Flow:

1. Scheduler creates small `fr24.inbound.fetch` jobs for DAD, SGN, HAN, CXR, and PQC.
2. Downloader saves raw responses.
3. Parser converts rows to canonical records.
4. Inbound Discovery Analyzer extracts unique origin airports.
5. Enrichment joins with existing airport lookup cache.
6. Analyzer marks known and unknown origin airports.
7. Analyzer writes `reports/llm-review/inbound-origins/.../input.json`.
8. LLM reviews unknown or suspicious origins and suggests additions.
9. Vocabulary service stores approved suggestions as candidate origins/routes.

LLM review input:

```json
{
  "destinationAirports": ["DAD", "SGN", "HAN", "CXR", "PQC"],
  "dateFrom": "2026-05-20",
  "dateTo": "2026-05-27",
  "originAirports": [
    {
      "iata": "ALA",
      "city": "Almaty",
      "country": "Kazakhstan",
      "seenDestinations": ["DAD"],
      "flightNumbers": ["VJ52", "DV5340"],
      "known": true
    }
  ]
}
```

### 9. Flight Number Monitor Analyzer

Purpose:

- Extract flight numbers from normalized records.
- Suggest selected flight numbers for later monitoring.
- Detect missing route records or route changes.

Monitor when:

- Flight number appears on a DAD route.
- Flight number appears more than once in the period.
- Flight number appears from a candidate origin airport.
- Flight number is known charter/tour operator traffic.
- Route query has zero result but flight number appears elsewhere.

The analyzer should not fetch flight-number data directly. It should write candidate jobs for the scheduler.

### 10. Aircraft Vocabulary Audit

Purpose:

- Read enriched flights and passenger estimate metadata.
- Flag unknown aircraft types.
- Suggest improvements to aircraft mapping.

Use existing:

```text
data/seeds/aircraft-pax.json
```

Passenger estimate priority:

1. Exact aircraft code match.
2. Aircraft family prefix rule.
3. Aircraft model text pattern.
4. Airline/route default.
5. System default.

Output fields:

```json
{
  "aircraftCode": "A333",
  "aircraftLabel": "Airbus A330-300",
  "paxEst": 300,
  "paxEstimateMethod": "exact-aircraft-code",
  "paxEstimateConfidence": 85
}
```

Also produce:

- Unknown aircraft report.
- Low-confidence estimate report.
- Suggested changes for `data/seeds/aircraft-pax.json`.

It should not write passenger estimates itself. Passenger estimation belongs to the Enrichment Service.

### 11. Periodic Audit Service

Purpose:

- Check for missing raw objects.
- Check parse failures.
- Check zero-result routes.
- Check newly discovered origins.
- Check low-confidence passenger estimates.
- Suggest jobs for the next run.

Examples:

- Route exists in vocabulary but has not been checked in 7 days.
- Route has 5 zero results and no positive result in 30 days, lower priority.
- Inbound DAD found a CIS origin not in route vocabulary, create candidate route.
- Flight number appears from DAD but no route job exists, create monitor job.

## API Credit Usage Policy

FR24 API credits are limited, so the scheduler should always choose the cheapest useful query.

### Endpoint Priority

Use FR24 methods in this order:

1. `routes=` batch query.
2. `airports=outbound:<small-origin-airport>`.
3. `airports=inbound:<vietnam-airport>` for discovery sample days.
4. `flight-number` lookup only for selected monitored flight numbers, after confirming the active FR24 filter name.
5. Airline-wide scan only as a manual audit experiment, not scheduled by default.

### Credit Rules

Route queries:

- Primary method for historical, live, and future checks.
- Batch up to 15 routes per FR24 request.
- Split date ranges into 14-day chunks.
- Skip if the exact raw object already exists.
- Store zero-result responses.

Inbound airport queries:

- Use only for discovery.
- Limit to top destination airports unless manually requested.
- Use sample days instead of every day when looking for new origins.
- Cap pages per job.
- Never use full inbound scans as the main CIS schedule source.

Outbound airport queries:

- Use only for smaller origin airports where pagination is affordable.
- Default allowed origins: `ALA`, `TAS`, `NQZ`, `VVO`, `OVB`, `FRU`, `GYD`, `EVN`, `MSQ`.
- Avoid scheduled full outbound scans for `SVO`, `DME`, `VKO`.
- For Moscow, use route queries like `SVO-DAD`, `SVO-SGN`, `SVO-HAN`, `SVO-CXR`.

Flight-number queries:

- Use only for monitored flight numbers from the vocabulary.
- Use short windows.
- Prefer route checks first if the route is known.

Airline queries:

- Do not schedule by default.
- Use as an analyst-triggered audit only if route and inbound data show repeated missing flights for one airline.
- If used, require a strict date range and a destination or route filter.

### Credit Budget Guards

The scheduler should enforce these limits:

- Max route requests per run.
- Max inbound airport pages per run.
- Max outbound airport pages per run.
- Max flight-number requests per run.
- No job without a `maxPages`, `dateFrom`, `dateTo`, and reason.
- No Moscow outbound job unless manually approved.
- No repeat call when an identical raw object already exists.

Suggested default budget:

```json
{
  "dailyRouteRequests": 20,
  "dailyInboundPages": 20,
  "dailyOutboundPages": 20,
  "dailyFlightNumberRequests": 10,
  "minRequestDelayMs": 3500,
  "manualApprovalRequired": ["outbound:SVO", "outbound:DME", "outbound:VKO", "airline-scan"]
}
```

## Job Scheduling

All cron jobs should create pipeline jobs. They should not call FR24 directly.

### Cron Frequency Plan

```text
*/30 * * * *      live-high-priority-routes
0 */6 * * *       near-term-route-refresh
30 1 * * *        historical-yesterday-routes
0 2 * * *         parse-new-raw-objects
30 2 * * *        index-new-canonical
45 2 * * *        enrich-new-indexed-flights
0 3 * * *         daily-route-analysis
30 3 * * *        daily-passenger-summary
0 4 * * *         audit-and-plan-next-jobs
0 5 * * *         future-route-forecast
0 6 * * 1,4       inbound-discovery-sample
0 7 * * 2         small-origin-outbound-discovery
0 8 * * 3         flight-number-monitoring
0 9 * * 5         route-priority-recalculation
0 10 * * 5        llm-origin-review-pack
```

### Scheduled Job Details

`live-high-priority-routes`

- Frequency: every 30 minutes.
- FR24 method: `routes=`.
- Scope: active Tier 1 routes for today only.
- Purpose: catch charters as they become visible.
- Credit guard: max 5 route batch requests per run.

`near-term-route-refresh`

- Frequency: every 6 hours.
- FR24 method: `routes=`.
- Scope: next 72 hours for active and monitored routes.
- Purpose: refresh provisional future rows.
- Credit guard: max 10 route batch requests per run.

`historical-yesterday-routes`

- Frequency: daily.
- FR24 method: `routes=`.
- Scope: yesterday and recent completed days.
- Purpose: convert live/provisional data into historical truth.
- Credit guard: max 20 route batch requests per run.

`future-route-forecast`

- Frequency: daily.
- FR24 method: `routes=`.
- Scope: next 7 to 30 days.
- Purpose: store provisional forecast rows.
- Credit guard: only active, seasonal, and monitor routes; max 20 route batch requests per run.

`inbound-discovery-sample`

- Frequency: twice per week.
- FR24 method: `airports=inbound:<destination>`.
- Scope: `DAD`, `SGN`, `HAN`, `CXR`, `PQC`.
- Purpose: discover unknown origin airports.
- Credit guard: sample days only; max 2 pages per airport unless manually approved.

`small-origin-outbound-discovery`

- Frequency: weekly.
- FR24 method: `airports=outbound:<origin>`.
- Scope: smaller origin airports only.
- Purpose: find Vietnam flights missing from the route matrix.
- Credit guard: max 3 pages per origin; no `SVO`, `DME`, or `VKO`.

`flight-number-monitoring`

- Frequency: weekly, or daily for very high-priority charters during season.
- FR24 method: flight-number lookup, if supported by the active FR24 plan.
- Scope: monitored flight numbers only.
- Purpose: find route changes and missed route records.
- Credit guard: max 10 flight numbers per run.

`parse-new-raw-objects`

- Frequency: daily, after downloader jobs.
- FR24 method: none.
- Scope: raw prefixes with no canonical output.

`index-new-canonical`

- Frequency: daily.
- FR24 method: none.
- Scope: canonical objects not yet indexed.

`enrich-new-indexed-flights`

- Frequency: daily.
- FR24 method: none.
- Scope: indexed flights missing airport, airline, aircraft, or passenger metadata.

`daily-route-analysis`

- Frequency: daily.
- FR24 method: none.
- Scope: indexed flights.

`daily-passenger-summary`

- Frequency: daily.
- FR24 method: none.
- Scope: enriched flights.

`audit-and-plan-next-jobs`

- Frequency: daily.
- FR24 method: none.
- Scope: job history, route scores, zero-result counts, missing raw objects.

`route-priority-recalculation`

- Frequency: weekly.
- FR24 method: none.
- Scope: route vocabulary and reports.

`llm-origin-review-pack`

- Frequency: weekly.
- FR24 method: none.
- Scope: discovered origin airport reports.

### Backfill Jobs

Backfills should be manual or explicitly queued with a fixed budget.

- Historical route matrix for selected periods: use `routes=` only.
- Historical inbound discovery for sample days: cap pages and airports.
- Flight-number reconstruction for key charters: monitored numbers only.
- Never run full all-origin or full Moscow outbound scans as a default backfill.

## Route Priority Policy

Start with route batches:

- `SVO-DAD`, `DME-DAD`, `VKO-DAD`
- `ALA-DAD`, `NQZ-DAD`, `TAS-DAD`, `VVO-DAD`, `OVB-DAD`
- Same origins to `SGN`, `HAN`, `CXR`, `PQC`

Priority rules:

- Positive result: increase priority.
- Repeated positive result: keep active.
- Zero result: keep the raw zero object and increment `zero_result_count`.
- Many zero results: lower priority, do not delete.
- New inbound origin from CIS market: add candidate route with medium priority.
- New flight number on DAD route: add flight-number monitor.

## API Key

All internal API endpoints should require an API key.

Header:

```text
X-API-Key: <FLIGHT_SCHEDULER_API_KEY>
```

Environment variables:

```text
FLIGHT_SCHEDULER_API_KEY=local-dev-key
FR24_API_TOKEN=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_RAW=flight-scheduler-raw
R2_BUCKET_NORMALIZED=flight-scheduler-normalized
D1_DATABASE_ID=...
```

Later on Cloudflare Workers:

- Store keys as Worker secrets.
- Bind R2 buckets as `RAW_BUCKET`, `NORMALIZED_BUCKET`, `REPORTS_BUCKET`.
- Bind D1 as `DB`.

## Small Internal API Endpoints

Keep endpoints small. Each endpoint should do one thing.

### Health

```text
GET /health
```

Returns service status.

### Vocabulary

```text
GET /v1/vocabulary/airports
GET /v1/vocabulary/routes
GET /v1/vocabulary/flight-numbers
POST /v1/vocabulary/airports
POST /v1/vocabulary/routes
POST /v1/vocabulary/flight-numbers
PATCH /v1/vocabulary/routes/{route}
```

### Jobs

```text
POST /v1/jobs
GET /v1/jobs/{jobId}
POST /v1/jobs/{jobId}/run
```

### Raw Data

```text
GET /v1/raw/objects?prefix=
GET /v1/raw/objects/{objectKey}
```

Raw writes should usually happen only from downloader jobs, not from frontend.

### Download Actions

```text
POST /v1/download/fr24/routes
POST /v1/download/fr24/inbound
POST /v1/download/fr24/outbound
POST /v1/download/fr24/flight-number
```

These endpoints create or run downloader jobs. They save raw data only.

### Parse Actions

```text
POST /v1/parse/raw-object
POST /v1/parse/prefix
```

These endpoints read raw objects and write normalized data.

### Index Actions

```text
POST /v1/index/canonical-object
POST /v1/index/prefix
```

These endpoints deduplicate canonical rows and update `flight_index`.

### Enrichment Actions

```text
POST /v1/enrich/flights
POST /v1/enrich/prefix
```

These endpoints add airport, airline, aircraft, and passenger estimate metadata.

### Analysis

```text
POST /v1/analyze/routes
POST /v1/analyze/inbound-origins
POST /v1/analyze/aircraft-vocabulary
POST /v1/analyze/flight-numbers
GET /v1/reports/daily
GET /v1/reports/routes
GET /v1/reports/discovered-origins
GET /v1/reports/issues
```

### Public Backend For Frontend

```text
GET /v1/flights
GET /v1/summary/daily
GET /v1/summary/routes
GET /v1/summary/airports
```

The frontend should read normalized/indexed data only. It should not trigger large FR24 fetches directly.

## OpenAPI Document

The OpenAPI contract is stored separately in:

```text
openapi.v2.yaml
```

Keep examples and design notes in this document. Keep the executable API contract in `openapi.v2.yaml` so backend and frontend can share it directly.

## Frontend Contract

The frontend should not know about FR24 internals.

Frontend reads:

- `GET /v1/flights`
- `GET /v1/summary/daily`
- `GET /v1/summary/routes`
- `GET /v1/summary/airports`
- `GET /v1/reports/issues`

Admin screens can read:

- jobs
- vocabulary
- discovered origins
- route scores
- unknown aircraft

Admin screens can trigger small jobs, but should never trigger an unbounded scan.

## Folder Architecture

Keep the local Node.js version close to the future Cloudflare Worker split.

```text
Flight Scheduler/
  openapi.v2.yaml
  README.md
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
        route.js
      storage/
        object-store.js        # R2/S3/local abstraction
        d1-repository.js       # D1/SQLite abstraction
      fr24/
        client.js              # thin FR24 HTTP client
        pagination.js
        adapters.js            # FR24 row -> canonical row
      vocabulary/
        airports.js
        routes.js
        flight-numbers.js
        airlines.js
      analysis/
        pax-estimate.js
        dedupe.js
        route-score.js

    services/
      api/
        index.js               # public + admin HTTP API
        middleware/
          api-key.js
        routes/
          health.js
          jobs.js
          vocabulary.js
          flights.js
          reports.js
      downloader/
        index.js
        jobs/
          fr24-routes.js
          fr24-inbound.js
          fr24-outbound.js
          fr24-flight-number.js
      parser/
        index.js
        parse-prefix.js
        parse-object.js
      indexer/
        index.js
        dedupe-canonical.js
        write-flight-index.js
      enrichment/
        index.js
        enrich-airports.js
        enrich-airlines.js
        enrich-aircraft-pax.js
      analyzer/
        index.js
        route-analysis.js
        inbound-origin-discovery.js
        aircraft-vocabulary-audit.js
        flight-number-analysis.js
      scheduler/
        index.js
        daily-plan.js
        weekly-plan.js
        backfill-plan.js

  data/
    seeds/
      airports.json
      aircraft-pax.json
      russian-speaking-countries.json
      v2-origin-airports.json
      v2-routes.json
      v2-airlines.json
      v2-flight-numbers.json
    local-r2/
      raw/
      normalized/
      reports/
    local-db/
      flight-scheduler.sqlite

  migrations/
    0001_jobs.sql
    0002_vocabulary.sql
    0003_flight_index.sql

  scripts/
    v2-download-routes.mjs
    v2-download-inbound.mjs
    v2-parse-prefix.mjs
    v2-index-canonical.mjs
    v2-enrich-flights.mjs
    v2-analyze-routes.mjs
    v2-daily-run.mjs
```

Future Cloudflare split:

```text
workers/
  api-worker/
  downloader-worker/
  parser-worker/
  indexer-worker/
  enrichment-worker/
  analyzer-worker/
  scheduler-worker/
```

The shared modules should avoid Node-only APIs where possible so they can move into Workers with minimal changes.

## Implementation Phases

### Phase 1: Local Node.js Pipeline

- Keep Express or split into small scripts.
- Add R2-compatible storage abstraction that can also write to local files in development.
- Add D1-compatible repository interface, backed by SQLite locally if needed.
- Implement route downloader first.
- Implement parser and `flight_index`.
- Implement daily summary.

### Phase 2: Discovery And Scoring

- Add inbound discovery for destination airports.
- Add candidate origin reports.
- Add route priority scoring.
- Add zero-result retention and priority lowering.
- Add flight-number monitor extraction.

### Phase 3: Cloudflare Deployment

- Move each service to a small Worker:
  - API Worker
  - Downloader Worker
  - Parser Worker
  - Analyzer Worker
- Use Cron Triggers for scheduled jobs.
- Use Queues between steps if jobs become asynchronous.
- Store raw in R2.
- Store indexes and vocabulary in D1.

## Key Decisions

- Use FR24 route queries as the main data source.
- Use inbound airport scans only for discovery.
- Use outbound scans only for smaller origin airports.
- Store zero-result responses.
- Keep raw data immutable.
- Keep existing airport and aircraft lookup data.
- Separate download, parse, analysis, and API.
- Make data objects the boundary between pipeline steps.
- Keep endpoints tiny so they can become Cloudflare Workers later.
