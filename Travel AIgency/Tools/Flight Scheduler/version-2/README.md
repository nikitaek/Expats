# Flight Scheduler v2 (implementation)

Node.js pipeline for CIS→Vietnam FR24 route batches. Full spec: [../README.md](../README.md).

## Quick start

```bash
cd version-2
cp .env.example .env
# Set FR24_API_TOKEN, optionally BIGQUERY_PROJECT + GOOGLE_APPLICATION_CREDENTIALS

npm install
npm run v2:test-pipeline    # local parse/enrich test (no API)
npm run v2:bq-setup         # create BQ dataset/tables/view (needs GCP creds)
npm run v2:bootstrap        # first launch: ±30d download (needs FR24 token)
npm run v2:bootstrap -- --prune-dry-run
npm run v2:bootstrap -- --prune   # disable routes with no flights in canonical store
npm run v2:cron               # steady-state scheduler tick
```

## Debug commands

```bash
npm run v2:download-routes -- --data-kind actual --date-from 2026-05-20 --date-to 2026-05-27 --routes SVO-SGN,ALA-CXR
npm run v2:download-routes -- --data-kind upcoming --routes SVO-SGN,ALA-CXR   # live in-air arrivals (snapshot now)
npm run v2:parse-prefix -- --prefix raw/routes/2026-05-20_2026-05-27/
npm run v2:parse-prefix -- --prefix raw/live/2026-06-05/                       # parse a live snapshot by capture date
npm run v2:enrich-flights -- --date-from 2026-05-20 --date-to 2026-05-27
npm run v2:load-bigquery -- --date-from 2026-05-20 --date-to 2026-05-27
npm run v2:report -- --data-kind actual --date-from 2026-05-20 --date-to 2026-05-27 --destination SGN
```

### Data kinds & FR24 source endpoints

FR24 has **no scheduled/timetable endpoint** for multi-day outlooks. The pipeline uses two `data_kind` values:

| `data_kind` | FR24 endpoint | What it answers |
|-------------|---------------|-----------------|
| `actual` | `flight-summary/full` | **What already happened** — completed flights in a past date range (yesterday + rolling repair window in cron). |
| `upcoming` | `live/flight-positions/full` (manual download) or `flight-summary/full` (cron window) | **What is in motion soon** — see below. |

**`upcoming` has two modes:**

1. **Cron / `v2:daily`** — `flight-summary/full` over today through the next **72 hours** (`hoursAhead` in `scheduler-policy.json`). Finds flights FR24 already knows about in that near-term window (including ones that departed recently and have not landed yet).
2. **Manual `v2:download-routes --data-kind upcoming`** — `live/flight-positions/full` snapshot of aircraft **airborne right now** on monitored routes, each with an ETA. Stored under `raw/live/<capture-date>/`. Run on a schedule (e.g. hourly) to build an operational “who is landing soon” picture.

There is no separate forecast/timetable fetch — FR24 does not expose one on this API plan.

Without `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`, objects are stored under `data/local-r2/`.

### R2 (Cloudflare)

Bucket: `tour-aigency-flights`  
Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

In `.env` set `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT`, plus either:

- **API token (what you have):** `R2_API_TOKEN_ID` + `CLOUDFLARE_API_TOKEN` (`cfat_*` secret). The app derives S3 credentials per [Cloudflare docs](https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token) (Access Key ID = token `id`, Secret = SHA-256 of token value). Permission names like “Workers R2 Storage Bucket Item Read/Write” are normal for bucket-scoped tokens.
- **Classic S3 keys:** `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` from the R2 dashboard (shown once at token creation).

```bash
npm run v2:r2-test
```
