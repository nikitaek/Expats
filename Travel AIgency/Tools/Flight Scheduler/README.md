# Flight Scheduler

Dashboard for Vietnam **inbound** flights, filtered to departures from Russian-speaking origin countries. Uses [Aviation Edge](https://aviation-edge.com/developers/) schedule APIs with local raw and normalized JSON storage.

## Setup

```bash
cd "Travel AIgency/Tools/Flight Scheduler"
cp .env.example .env
# Edit .env and set AVIATION_EDGE_API_KEY from https://aviation-edge.com/developers/
npm install
npm start
```

## The “7-day gap” (tomorrow … +6 days)

Aviation Edge **cannot** return full-day schedules for tomorrow through the next ~7 days:

| Window | API | What you get |
|--------|-----|----------------|
| Today | `timetable` | Live board only (~±6 hours) |
| Tomorrow … +6 | *no full-day API* | Partial timetable **or** cached/projected data |
| +7 days and beyond | `flightsFuture` | Full-day algorithmic schedule |

**Official workaround:** fetch each date with `flightsFuture` while it is still ≥7 days in the future, cache it locally, then read from cache as that day approaches ([FAQ](https://aviation-edge.com/frequently-asked-questions/)).

### 1. Rolling prefetch (best quality — run daily)

```bash
npm run prefetch:rolling
# same as: npm run prefetch:future -- --days 37 --delay 400
```

Schedule in cron (example 06:00 daily):

```cron
0 6 * * * cd "/path/to/Flight Scheduler" && npm run prefetch:rolling >> logs/prefetch.log 2>&1
```

This keeps `data/cache/raw/{date}_{IATA}.json` populated from **today+7** through ~37 days out. When “tomorrow” arrives, you already have yesterday’s future snapshot in cache.

### 2. Fill gap via Aviationstack (one-time, ~15–90 API calls)

Uses [Aviationstack `/v1/timetable`](https://docs.apilayer.com/aviationstack/docs/aviationstack-api-v-1-0-0) — **one request per airport** (paginate only within your monthly cap). Fills **today + 6 days** into the same `data/cache/raw` + `data/normalized` layout. Airport countries use existing Aviation Edge cache; any still-empty scope falls back to historical projection (no extra Aviationstack calls).

```bash
AVIATIONSTACK_ACCESS_KEY=your_key npm run fill:gap:stack
node scripts/fill-gap-aviationstack.mjs --max-requests 95 --delay 11000
```

**Note:** `flight_date` on `/v1/flights` requires a higher plan. The timetable endpoint is used instead. Respect rate limits (~1 req / 10s on paid plans).

### 3. Fill gap from history (estimate for missing near-term days)

If you did not prefetch in time, project from **flightsHistory** (same weekday 7/14/21/28 days ago):

```bash
npm run fill:gap
# Options:
node scripts/fill-gap.mjs --date 2026-06-05 --airports SGN,DAD
node scripts/fill-gap.mjs --force
```

Or via API: `POST /api/schedules/project?date=YYYY-MM-DD&arr_iata=SGN`

Cached rows use `scheduleMode: "projected"` and a clear `coverageNote`. The dashboard reads them like any other cache.

### Historical backfill (actual flown data — rewrites cache)

Uses `flightsHistory` for past dates. Default: **2026-05-15 through yesterday**, top **8** Vietnamese airports by priority, **force overwrite** of existing raw/normalized files.

Aviation Edge history is only available for dates **4+ days ago**; the script auto-caps `--to` to that limit. Re-run daily to backfill the rolling window, or pass `--include-recent` for the last few days via timetable (partial day).

```bash
npm run prefetch:history
node scripts/prefetch-history.mjs --from 2026-05-15 --to 2026-06-03
node scripts/prefetch-history.mjs --date 2026-05-20 --airports SGN,HAN,DAD
node scripts/prefetch-history.mjs --skip-cached
```

Summary: `data/cache/prefetch-history-manifest.json`. **API usage:** up to **days × airports** schedule calls (+ airport country lookups on first normalize).

### One-time bulk future download

```bash
npm run prefetch:future
node scripts/prefetch-future.mjs --days 30 --delay 400
```

Summary: `data/cache/prefetch-future-manifest.json`. **API usage:** up to **days × 15** schedule calls on a cold cache.

Open http://localhost:3847 (or your `PORT`).

## Data layout

| Path | Purpose |
|------|---------|
| `data/seeds/airports.json` | 15 Vietnamese airports (`priority` = popularity for Russian tourists) |
| `data/seeds/russian-speaking-countries.json` | Origin countries filter (ISO2) |
| `data/cache/raw/{date}_{IATA}.json` | Raw Aviation Edge responses + canonical rows |
| `data/cache/airports/{IATA}.json` | Departure airport → country (from `airportDatabase`) |
| `data/normalized/{date}_{IATA}.json` | Filtered flights with short field names |

## Schedule APIs (by selected date)

| When | Endpoint | Docs |
|------|----------|------|
| Today … +7 days | `GET /v2/public/timetable?iataCode=&type=arrival` | [Flight Schedules](https://aviation-edge.com/flight-schedule-and-timetable-of-airlines-and-airports/) |
| Past | `GET /v2/public/flightsHistory?code=&type=arrival&date_from=&date_to=` | [Historical Schedules](https://aviation-edge.com/historical-flight-schedules-api/) |
| +7 days and beyond | `GET /v2/public/flightsFuture?iataCode=&type=arrival&date=` | [Future Schedules](https://aviation-edge.com/future-flight-schedules-and-timetables-of-airports-api/) |

**Tomorrow … +6:** no full-day API — use **rolling prefetch** or **`npm run fill:gap`** (see above). Timetable-only loads show a partial day.

**Caching:** empty API responses are **not** saved. Timetable responses are snapshotted per airport for 15 minutes so switching between today/tomorrow reuses one API call.

**Multiple airports:** Aviation Edge allows **one IATA per request** ([FAQ](https://aviation-edge.com/frequently-asked-questions/)). Use batch load:

`POST /api/schedules/load-batch?date=YYYY-MM-DD&arr_iata=SGN,DAD,CXR`

## Local API

- `GET /api/airports` — airport seeds
- `GET /api/countries` — Russian-speaking countries
- `GET /api/schedules/status?date=&arr_iata=` — cache exists? + `scheduleMode`
- `GET /api/schedules?date=&arr_iata=` — read from cache (404 if missing)
- `POST /api/schedules/load?date=&arr_iata=` — fetch Aviation Edge, save raw + normalized (skipped if zero flights)
- `POST /api/schedules/project?date=&arr_iata=` — fill near-term gap from historical same-weekday data
- `POST /api/schedules/load-batch?date=&arr_iata=SGN,DAD` — same, one provider request per airport
- `POST /api/schedules/project-batch?date=&arr_iata=SGN,DAD` — project gap for multiple airports

## Notes

- `paxEst` is estimated from aircraft type via `data/seeds/aircraft-pax.json` (API does not provide passenger counts). Run `npm run scan:aircraft` after loading new data to verify all types are mapped.
- Raw API payloads and normalized records are stored separately per `date` + arrival airport.

## Module structure

```
server/
  config.js
  index.js
  routes/api.js
  services/
    seeds.js
    raw-cache.js
    normalized-store.js
    aviation-edge.js   # Aviation Edge HTTP client + adapters
    normalize.js
    pax-estimate.js   # aircraft-pax.json lookup + paxEst
    scheduler.js
```
