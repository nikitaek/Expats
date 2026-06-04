# Flight Scheduler — Future Modules (v2.1+)

This document describes modules **not** in [Version 2](./README.md).

**Version 2 already covers:** route-batch FR24 fetch, `actual` / `upcoming` / `forecast` rows in D1, `pax_est`, and API summaries for past arrivals, near-term airport outreach, and ~2-week outlook — for **all** Vietnam airports in `version-2/data/seeds/airports.json`.

**This document covers:** discovery scans, route scoring, cross-source reconciliation, and vocabulary expansion.

---

## Goals (v2.1+)

Future modules should answer:

- Which routes are regular, seasonal, charter-like, or no longer useful?
- Which new origin airports appear in Vietnam inbound traffic and should be added to our vocabulary?
- Which routes or flight numbers need more monitoring because route data, inbound data, or flight-number data disagree?
- Which flight numbers should be tracked after they appear on important routes?
- Which aircraft codes need better passenger-estimate mappings?

These require extra FR24 query modes, cross-source comparison, and analyst/LLM review — not the v2 fact table.

---

## Extra FR24 Query Modes

### Origin airport outbound

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

Use carefully for `SVO`, `DME`, `VKO` — pagination is expensive and noisy.

### Vietnam airport inbound

```text
inbound=SGN
inbound=HAN
inbound=CXR
inbound=DAD
inbound=PQC
```

Use for discovery and monitoring, not for the main CIS route fetch.

Best for:

- Finding new origin airports that land at Vietnam destinations.
- Checking if route seed files are missing something.
- Building origin lists for LLM or analyst review.

Weakness: very noisy; bad primary method for CIS charters.

### Flight number monitoring

```text
flight=VJ8924
flight=SU292
```

Use after a flight number is discovered.

Best for:

- Repeat patterns and route changes for the same flight number.
- Detecting gaps when route queries and inbound queries disagree.
- Charter numbers that move between routes or dates.

Not a discovery method unless the flight number is already known.

Scheduled and forecast windows are handled in v2 via `data_kind` (`actual`, `upcoming`, `forecast`) on route-batch jobs — see [README.md](./README.md).

---

## Future Pipeline Modules

### Analysis Service

Purpose:

- Score routes.
- Identify new airports.
- Compare route, inbound, outbound, and flight-number findings.
- Produce period reports beyond daily passenger totals.

Outputs:

- Route score report.
- Candidate airport list.
- Candidate flight-number monitor list.
- Data quality issues.

Route scoring signals:

- Positive sightings in the last N checks.
- Zero-result count.
- Passenger estimate volume.
- Tier 1 Vietnam destinations.
- Multiple discovery methods.
- Repeating flight numbers.
- Route found via inbound but missing from route seeds.

Suggested route statuses:

- `active`
- `seasonal`
- `candidate`
- `monitor`
- `low_priority`
- `disabled`

Does not call FR24 directly; emits job recommendations for the scheduler.

### Inbound Discovery Analyzer

Purpose:

- Read parsed inbound arrivals for destination airports.
- Extract all origin airports.
- Produce a source-airport list for LLM or analyst review.

Flow:

1. Scheduler creates `fr24.inbound.fetch` jobs for each airport in `airports.json`.
2. Downloader saves raw responses.
3. Parser converts rows to canonical records.
4. Analyzer extracts unique origin airports.
5. Enrichment joins airport metadata from seed/cache files.
6. Report written to R2: `reports/llm-review/inbound-origins/.../input.json`.
7. LLM or analyst reviews unknown origins.
8. Approved additions merged into seed JSON (`v2-origin-airports.json`, `v2-routes.json`).

### Flight Number Monitor Analyzer

Purpose:

- Extract flight numbers from normalized records.
- Suggest flight numbers for `fr24.flight-number.fetch` jobs.
- Detect missing route records or route changes.

Monitor when:

- Flight number appears on a Vietnam inbound route.
- Flight number repeats in the period.
- Flight number from a candidate origin.
- Known charter/tour operator traffic.
- Route query zero-result but flight number appears elsewhere.

### Aircraft Vocabulary Audit

Purpose:

- Flag unknown aircraft types and low-confidence passenger estimates.
- Suggest updates to `version-2/data/seeds/aircraft-pax.json`.

Does not write `pax_est` — enrichment owns estimates.

### Periodic Audit Service

Purpose:

- Missing raw objects, parse failures, stale route checks.
- Newly discovered origins, low-confidence estimates.
- Job suggestions for the next scheduler run.

Examples:

- Route in seeds but not checked in 7 days.
- Five zero results in 30 days → lower priority in seed route file.
- Inbound scan found CIS origin not in `v2-routes.json` → add `{ "route": "..." }` to seeds.
- Flight number on a route with no recent fetch → flight-number monitor job.

---

## Future Job Types

Downloader (in addition to `fr24.routes.fetch`):

- `fr24.inbound.fetch`
- `fr24.outbound.fetch`
- `fr24.flight-number.fetch`

Analyzer:

- `analyze.routes`
- `analyze.inbound-origins`
- `analyze.aircraft-vocabulary`
- `analyze.flight-numbers`

---

## Future Cron Plan

```text
0 5 * * *         future-route-forecast
0 6 * * 1,4       inbound-discovery-sample
0 7 * * 2         small-origin-outbound-discovery
0 8 * * 3         flight-number-monitoring
0 9 * * 5         route-priority-recalculation
0 10 * * 5        llm-origin-review-pack
```

Details:

| Job | Frequency | FR24 method | Purpose |
|-----|-----------|-------------|---------|
| `future-route-forecast` | — | — | replaced by v2 `fetch-forecast-14d` |
| `inbound-discovery-sample` | 2×/week | `inbound:<dest>` | unknown origins |
| `small-origin-outbound-discovery` | weekly | `outbound:<origin>` | missing matrix routes |
| `flight-number-monitoring` | weekly | flight number | route changes, gaps |
| `route-priority-recalculation` | weekly | none | update seed route priorities |
| `llm-origin-review-pack` | weekly | none | review discovered origins |

Credit guards from v2 README still apply; discovery jobs stay capped.

---

## Future Debug Commands

```text
npm run v2:download-inbound -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD --airport SGN
npm run v2:download-outbound -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD --origin ALA
npm run v2:download-flight-number -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD --flight-number VJ8924
npm run v2:analyze-routes -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD
npm run v2:analyze-inbound-origins -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD
npm run v2:analyze-aircraft-vocabulary -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD
npm run v2:analyze-flight-numbers -- --date-from YYYY-MM-DD --date-to YYYY-MM-DD
```

Future modules should also be cron/debug only. They write R2 report files such as route scores, discovered origins, vocabulary candidates, and unknown aircraft. No public API is required.

---

## Future Storage (optional)

v2 keeps **only normalized flights in D1**. Future modules may add:

- **Job queue state**: JSON manifests under `data/jobs/` or R2 `jobs/`, not D1.
- **Route/airport/flight-number vocabulary**: seed JSON under `version-2/data/seeds/`, updated after human approval — not D1 tables.
- **Route scores / audit reports**: R2 `reports/` objects.
- **Airport lookup cache**: local JSON or R2; refresh on demand.

Only add D1 tables here if query patterns truly need SQL joins at scale (e.g. a `route_audit` snapshot table). Prefer R2 reports + seed files first.

---

## Implementation Phase (after v2 core)

### Phase 2: Discovery and scoring

- Inbound discovery for destination airports.
- Candidate origin reports and LLM review packs.
- Route priority updates in seed files (not D1).
- Zero-result retention and priority lowering.
- Flight-number monitor extraction.
- Optional future/live route refresh jobs.

See [README.md](./README.md) Phase 1 for the prerequisite pipeline.
