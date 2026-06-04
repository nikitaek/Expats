import { Router } from "express";
import { aviationEdge } from "../config.js";
import { getAirports, getRussianSpeakingCountries } from "../services/seeds.js";
import { multiAirportPerRequestSupported } from "../services/aviation-edge.js";
import {
  getScopeStatus,
  getOrLoadScope,
  loadScopeFromApi,
  loadScopeFromApiBatch,
  loadScopeFromProjection,
  loadScopeFromProjectionBatch,
} from "../services/scheduler.js";
import { isNearTermGapDate } from "../services/project-history.js";
import {
  validateDateRange,
  resolveAirportList,
  getRangeStatus,
  aggregateRange,
  loadRangeFromApi,
} from "../services/aggregate.js";
import { dadJuneRouteGapAudit } from "../services/route-gap-audit.js";

const router = Router();

function parseDateQuery(req) {
  const date = req.query.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Query parameter date (YYYY-MM-DD) is required." };
  }
  return { date };
}

function parseScopeQuery(req) {
  const dateParsed = parseDateQuery(req);
  if (dateParsed.error) return dateParsed;

  const arrIata = req.query.arr_iata || req.query.arrIata;
  if (!arrIata || !/^[A-Za-z]{3}$/.test(arrIata)) {
    return { error: "Query parameter arr_iata (3-letter IATA) is required." };
  }
  return { date: dateParsed.date, arrIata: arrIata.toUpperCase() };
}

function parseAirportList(value) {
  if (!value) return [];
  return [
    ...new Set(
      String(value)
        .split(/[,\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{3}$/.test(c)),
    ),
  ];
}

router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(aviationEdge.apiKey),
    futureMinDaysAhead: aviationEdge.futureMinDaysAhead,
    multiAirportPerRequestSupported,
  });
});

router.get("/airports", async (_req, res, next) => {
  try {
    res.json(await getAirports());
  } catch (err) {
    next(err);
  }
});

router.get("/countries", async (_req, res, next) => {
  try {
    res.json(await getRussianSpeakingCountries());
  } catch (err) {
    next(err);
  }
});

router.get("/audit/dad-june", async (req, res, next) => {
  try {
    const year = String(req.query.year || "2026");
    if (!/^\d{4}$/.test(year)) {
      return res.status(400).json({ error: "Query year must be YYYY." });
    }
    res.json(await dadJuneRouteGapAudit(year));
  } catch (err) {
    next(err);
  }
});

router.get("/schedules/status", async (req, res, next) => {
  try {
    const parsed = parseScopeQuery(req);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    res.json(await getScopeStatus(parsed.date, parsed.arrIata));
  } catch (err) {
    next(err);
  }
});

router.get("/schedules", async (req, res, next) => {
  try {
    const parsed = parseScopeQuery(req);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const status = await getScopeStatus(parsed.date, parsed.arrIata);
    if (!status.hasRawCache) {
      return res.status(404).json({
        error: "No cached schedule data for this date and airport.",
        ...status,
      });
    }

    const data = await getOrLoadScope(parsed.date, parsed.arrIata);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post("/schedules/load", async (req, res, next) => {
  try {
    const parsed = parseScopeQuery(req);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const data = await loadScopeFromApi(parsed.date, parsed.arrIata);
    res.json(data);
  } catch (err) {
    if (err.code === "NO_SCHEDULE_DATA") {
      return res.status(404).json({
        error: err.message,
        ...err.details,
      });
    }
    next(err);
  }
});

/** One API request per airport (provider limit); reuses timetable snapshot per airport. */
function parseRangeQuery(req) {
  const range = validateDateRange(
    req.query.date_from || req.query.dateFrom,
    req.query.date_to || req.query.dateTo,
  );
  if (range.error) return range;
  return range;
}

async function parseRangeScopeQuery(req) {
  const range = parseRangeQuery(req);
  if (range.error) return range;

  const arrParam = req.query.arr_iata || req.query.arrIata || "ALL";
  const airports = await resolveAirportList(arrParam);
  if (airports.error) return airports;

  return { ...range, arrIataList: airports };
}

async function respondDashboardStatus(req, res, next) {
  try {
    const parsed = await parseRangeScopeQuery(req);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    res.json(
      await getRangeStatus(parsed.dateFrom, parsed.dateTo, parsed.arrIataList),
    );
  } catch (err) {
    next(err);
  }
}

async function respondDashboardData(req, res, next) {
  try {
    const parsed = await parseRangeScopeQuery(req);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const data = await aggregateRange(
      parsed.dateFrom,
      parsed.dateTo,
      parsed.arrIataList,
    );

    if (data.scopesCached === 0) {
      return res.status(404).json({
        error: "No cached schedule data for this range and selection.",
        ...data,
      });
    }

    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function respondDashboardLoad(req, res, next) {
  try {
    const parsed = await parseRangeScopeQuery(req);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const data = await loadRangeFromApi(
      parsed.dateFrom,
      parsed.dateTo,
      parsed.arrIataList,
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/** Multi-date × multi-airport dashboard (primary API for the UI). */
router.get("/dashboard/status", respondDashboardStatus);
router.get("/dashboard", respondDashboardData);
router.post("/dashboard/load", respondDashboardLoad);

/** Aliases kept for scripts and older clients. */
router.get("/schedules/range/status", respondDashboardStatus);
router.get("/schedules/range", respondDashboardData);
router.post("/schedules/load-range", respondDashboardLoad);

router.post("/schedules/project", async (req, res, next) => {
  try {
    const parsed = parseScopeQuery(req);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    if (!isNearTermGapDate(parsed.date)) {
      return res.status(400).json({
        error: `Date ${parsed.date} is outside the near-term gap. Use load or prefetch for future dates.`,
        scheduleMode: (await getScopeStatus(parsed.date, parsed.arrIata)).scheduleMode,
      });
    }

    const data = await loadScopeFromProjection(parsed.date, parsed.arrIata);
    res.json(data);
  } catch (err) {
    if (err.code === "NO_SCHEDULE_DATA" || err.code === "NO_PROJECTION_DATA") {
      return res.status(404).json({
        error: err.message,
        ...err.details,
      });
    }
    next(err);
  }
});

router.post("/schedules/project-batch", async (req, res, next) => {
  try {
    const dateParsed = parseDateQuery(req);
    if (dateParsed.error) return res.status(400).json({ error: dateParsed.error });

    if (!isNearTermGapDate(dateParsed.date)) {
      return res.status(400).json({
        error: `Date ${dateParsed.date} is outside the near-term gap.`,
      });
    }

    const list = parseAirportList(req.query.arr_iata || req.query.arrIata);
    if (list.length === 0) {
      return res.status(400).json({
        error: "Query arr_iata must list one or more IATA codes.",
      });
    }

    const data = await loadScopeFromProjectionBatch(dateParsed.date, list);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

router.post("/schedules/load-batch", async (req, res, next) => {
  try {
    const dateParsed = parseDateQuery(req);
    if (dateParsed.error) return res.status(400).json({ error: dateParsed.error });

    const list = parseAirportList(req.query.arr_iata || req.query.arrIata);
    if (list.length === 0) {
      return res.status(400).json({
        error:
          "Query arr_iata must list one or more IATA codes, comma-separated (e.g. SGN,DAD,CXR).",
      });
    }
    if (list.length > 15) {
      return res.status(400).json({ error: "Maximum 15 airports per batch." });
    }

    const data = await loadScopeFromApiBatch(dateParsed.date, list);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
