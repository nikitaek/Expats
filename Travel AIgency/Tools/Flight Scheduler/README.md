# Flight Scheduler

Node.js pipeline for CIS→Vietnam FR24 route batches (FR24-only).

## Quick start

```bash
cd "Travel AIgency/Tools/Flight Scheduler"
cp .env.example .env
# Set FR24_API_TOKEN, optionally BIGQUERY_PROJECT + GOOGLE_APPLICATION_CREDENTIALS

npm install
npm run test-pipeline    # local parse/enrich test (no API)
npm run bq-setup         # create BQ dataset/tables/view (needs GCP creds)
npm run bootstrap        # first launch: ±30d download (needs FR24 token)
npm run bootstrap -- --prune-dry-run
npm run bootstrap -- --prune   # disable routes with no flights in canonical store
npm run daily              # steady-state scheduler tick
```

## Commands

```bash
npm run download -- --data-kind actual --date-from 2026-05-20 --date-to 2026-05-27 --routes SVO-SGN,ALA-CXR
npm run download -- --data-kind upcoming   # live in-air snapshot (airborne now)
npm run parse-prefix -- --prefix raw/routes/2026-05-20_2026-05-27/
npm run parse-prefix -- --prefix raw/live/2026-06-05/
npm run enrich-flights -- --date-from 2026-05-20 --date-to 2026-05-27
npm run load-bigquery -- --date-from 2026-05-20 --date-to 2026-05-27
npm run report -- --data-kind actual --date-from 2026-05-20 --date-to 2026-05-27 --destination SGN
npm run analyze -- --date-from 2026-05-07 --date-to 2026-06-05
```

### Data kinds & FR24 source endpoints

FR24 has **no scheduled/timetable endpoint** for multi-day outlooks. The pipeline uses two `data_kind` values:

| `data_kind` | FR24 endpoint | What it answers |
|-------------|---------------|-----------------|
| `actual` | `flight-summary/full` | **What already happened** — completed flights in a past date range (yesterday + rolling repair window in cron). |
| `upcoming` | `live/flight-positions/full` (manual download) or `flight-summary/full` (cron window) | **What is in motion soon** — see below. |

**`upcoming` has two modes:**

1. **`npm run daily`** — `flight-summary/full` over today through the next **72 hours** (`hoursAhead` in `data/config/scheduler-policy.json`).
2. **`npm run download -- --data-kind upcoming`** — `live/flight-positions/full` snapshot of aircraft **airborne right now** on monitored routes. Stored under `raw/live/<capture-date>/`.

Without R2 credentials, objects are stored under `data/local-r2/`.

### R2 (Cloudflare)

Bucket: `tour-aigency-flights`  
Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

In `.env` set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT`, plus either:

- **API token:** `R2_API_TOKEN_ID` + `CLOUDFLARE_API_TOKEN` (`cfat_*` secret).
- **Classic S3 keys:** `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` from the R2 dashboard.

```bash
npm run r2-test
```
