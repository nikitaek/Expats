const $ = (id) => document.getElementById(id);

const dateFromInput = $("date-from-input");
const dateToInput = $("date-to-input");
const airportSelect = $("airport-select");
const refreshBtn = $("refresh-btn");
const loadApiBtn = $("load-api-btn");
const cacheHint = $("cache-hint");
const apiStatus = $("api-status");
const statTotal = $("stat-total");
const statFiltered = $("stat-filtered");
const statIncomingPax = $("stat-incoming-pax");
const statPax = $("stat-pax");
const statPctFlights = $("stat-pct-flights");
const statPctPax = $("stat-pct-pax");
const statScopes = $("stat-scopes");
const inboundBody = $("inbound-body");
const outboundBody = $("outbound-body");
const flightsBody = $("flights-body");
const messageEl = $("message");

/** Load-from-API UI disabled until we expose it again */
const SHOW_LOAD_API_BTN = false;

let countryNames = new Map();
let airportsList = [];
let chartByDate = null;
let chartByAirport = null;
let chartByCountry = null;

const ALL_VIETNAM = "ALL";

const CHART_COLORS = [
  "#3d9cf5",
  "#3ecf8e",
  "#f5b83d",
  "#b07cf5",
  "#f56b8a",
  "#5ad4c4",
  "#e879f9",
  "#94a3b8",
];

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: "#8b9cb3", boxWidth: 12 } },
  },
  scales: {
    x: {
      ticks: { color: "#8b9cb3", maxRotation: 45, minRotation: 0 },
      grid: { color: "rgba(46, 63, 86, 0.5)" },
    },
    y: {
      ticks: { color: "#8b9cb3", precision: 0 },
      grid: { color: "rgba(46, 63, 86, 0.5)" },
      beginAtZero: true,
    },
  },
};

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function showMessage(text, type = "info") {
  if (!text) {
    messageEl.hidden = true;
    return;
  }
  messageEl.hidden = false;
  messageEl.textContent = text;
  messageEl.className = `message message-${type}`;
}

function setLoading(loading) {
  document.body.classList.toggle("loading", loading);
  refreshBtn.disabled = loading;
  loadApiBtn.disabled = loading;
}

function queryParams() {
  return new URLSearchParams({
    date_from: dateFromInput.value,
    date_to: dateToInput.value,
    arr_iata: airportSelect.value,
  });
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    dateFrom: params.get("date_from"),
    dateTo: params.get("date_to"),
    arrIata: params.get("arr_iata"),
  };
}

function isValidIsoDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

function syncUrlFromSelection() {
  if (!dateFromInput.value || !dateToInput.value || !airportSelect.value) {
    return;
  }
  const params = queryParams();
  const search = `?${params}`;
  if (window.location.search !== search) {
    history.replaceState(null, "", `${window.location.pathname}${search}`);
  }
}

function applyUrlState(minIso, maxIso) {
  const { dateFrom, dateTo, arrIata } = readUrlState();
  if (!isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) return false;

  if (dateFrom > maxIso || dateTo > maxIso || dateFrom < minIso) return false;
  if (dateFrom > dateTo) return false;

  dateFromInput.value = dateFrom;
  dateToInput.value = dateTo;
  syncDateConstraints();

  if (arrIata) {
    const validAirport =
      arrIata === ALL_VIETNAM ||
      airportsList.some((a) => a.iata === arrIata);
    if (validAirport) {
      airportSelect.value = arrIata;
    }
  }

  return true;
}

async function apiGet(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

async function apiPost(path) {
  const res = await fetch(path, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function countryLabel(iso2) {
  const c = countryNames.get(iso2);
  if (!c) return iso2;
  return `${c.nameRu} (${iso2})`;
}

function destroyChart(chart) {
  if (chart) chart.destroy();
  return null;
}

function renderCharts(data) {
  chartByDate = destroyChart(chartByDate);
  chartByAirport = destroyChart(chartByAirport);
  chartByCountry = destroyChart(chartByCountry);

  const byDate = data?.byDate || [];
  const byAirport = data?.byAirport || [];
  const byCountry = data?.byCountry || [];

  const dateCtx = $("chart-by-date").getContext("2d");
  chartByDate = new Chart(dateCtx, {
    type: "bar",
    data: {
      labels: byDate.map((d) => d.date.slice(5)),
      datasets: [
        {
          label: "RU-origin flights",
          data: byDate.map((d) => d.flights),
          backgroundColor: "rgba(61, 156, 245, 0.85)",
          borderRadius: 4,
        },
        {
          label: "Est. RU pax",
          data: byDate.map((d) => d.pax),
          type: "line",
          borderColor: "#3ecf8e",
          backgroundColor: "rgba(62, 207, 142, 0.15)",
          yAxisID: "y1",
          tension: 0.25,
          pointRadius: 3,
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y1: {
          position: "right",
          ticks: { color: "#3ecf8e" },
          grid: { drawOnChartArea: false },
          beginAtZero: true,
        },
      },
    },
  });

  const airportsWithTraffic = byAirport.filter((a) => (a.incoming ?? 0) > 0);
  const airportCtx = $("chart-by-airport").getContext("2d");
  chartByAirport = new Chart(airportCtx, {
    type: "bar",
    data: {
      labels: airportsWithTraffic.map((a) => `${a.city} (${a.iata})`),
      datasets: [
        {
          label: "All incoming",
          data: airportsWithTraffic.map((a) => a.incoming ?? 0),
          backgroundColor: "rgba(148, 163, 184, 0.55)",
          borderRadius: 4,
        },
        {
          label: "RU-origin",
          data: airportsWithTraffic.map((a) => a.flights ?? 0),
          backgroundColor: "rgba(61, 156, 245, 0.85)",
          borderRadius: 4,
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: airportsWithTraffic.length > 8 ? "y" : "x",
    },
  });

  const countryCtx = $("chart-by-country").getContext("2d");
  chartByCountry = new Chart(countryCtx, {
    type: "doughnut",
    data: {
      labels: byCountry.map((c) => countryLabel(c.iso2)),
      datasets: [
        {
          data: byCountry.map((c) => c.flights),
          backgroundColor: byCountry.map(
            (_, i) => CHART_COLORS[i % CHART_COLORS.length],
          ),
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "right",
          labels: { color: "#8b9cb3", boxWidth: 12 },
        },
      },
    },
  });
}

function formatAircraftCell(f) {
  const code = f.aircraft || "";
  const label = f.aircraftLabel || "";
  if (!code && !label) return "—";
  if (label && code && label !== code) {
    return `${escapeHtml(label)}<br><small>${escapeHtml(code)}</small>`;
  }
  return escapeHtml(label || code);
}

function formatPct(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function renderCityTable(tbody, rows, emptyColspan, emptyText) {
  if (!rows?.length) {
    tbody.innerHTML = `<tr><td colspan="${emptyColspan}" class="empty">${emptyText}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      ${r.cells.map((c) => `<td>${c}</td>`).join("")}
    </tr>`,
    )
    .join("");
}

function renderInboundTable(byInbound) {
  renderCityTable(
    inboundBody,
    (byInbound || []).map((r) => ({
      cells: [
        escapeHtml(r.city),
        escapeHtml(r.iata),
        (r.flights ?? 0).toLocaleString(),
        (r.pax ?? 0).toLocaleString(),
      ],
    })),
    4,
    "No RU-origin inbound flights for this selection",
  );
}

function renderOutboundTable(byOrigin) {
  renderCityTable(
    outboundBody,
    (byOrigin || []).map((r) => ({
      cells: [
        countryLabel(r.iso2),
        escapeHtml(r.city),
        (r.flights ?? 0).toLocaleString(),
        (r.pax ?? 0).toLocaleString(),
      ],
    })),
    4,
    "No RU-origin outbound cities for this selection",
  );
}

function renderFlights(flights) {
  if (!flights?.length) {
    flightsBody.innerHTML =
      '<tr><td colspan="9" class="empty">No matching flights for this selection</td></tr>';
    return;
  }

  flightsBody.innerHTML = flights
    .map(
      (f) => `
    <tr>
      <td>${escapeHtml(f.date)}</td>
      <td>${f.eta || "—"}</td>
      <td>${escapeHtml(f.toCity)}<br><small>${escapeHtml(f.arrIata || "")}</small></td>
      <td>${escapeHtml(f.fromCity)}<br><small>${escapeHtml(f.fromAirport)}</small></td>
      <td>${countryLabel(f.fromCountry)}</td>
      <td>${escapeHtml(f.flightNo)}</td>
      <td>${escapeHtml(f.airline)}</td>
      <td>${formatAircraftCell(f)}</td>
      <td>${f.paxEst ?? "—"}</td>
    </tr>`,
    )
    .join("");
}

function renderSummary(data) {
  statTotal.textContent =
    data?.totalIncoming != null ? data.totalIncoming.toLocaleString() : "—";
  statFiltered.textContent =
    data?.filteredCount != null ? data.filteredCount.toLocaleString() : "—";
  statIncomingPax.textContent =
    data?.totalIncomingPax != null
      ? data.totalIncomingPax.toLocaleString()
      : "—";
  statPax.textContent =
    data?.paxTotal != null ? data.paxTotal.toLocaleString() : "—";

  const pctFlights =
    data?.pctFlightsRu ??
    (data?.totalIncoming > 0
      ? (data.filteredCount / data.totalIncoming) * 100
      : null);
  const pctPax =
    data?.pctPaxRu ??
    (data?.totalIncomingPax > 0
      ? (data.paxTotal / data.totalIncomingPax) * 100
      : null);
  statPctFlights.textContent = formatPct(pctFlights);
  statPctPax.textContent = formatPct(pctPax);

  if (data?.scopesTotal != null) {
    statScopes.textContent = `${data.completeScopes ?? data.scopesCached ?? 0}/${data.scopesTotal}`;
  } else {
    statScopes.textContent = "—";
  }

  renderCharts(data);
  renderInboundTable(data?.byInbound);
  renderOutboundTable(data?.byOrigin);
  renderFlights(data?.flights);
}

function clearView(message) {
  statTotal.textContent = "—";
  statFiltered.textContent = "—";
  statIncomingPax.textContent = "—";
  statPax.textContent = "—";
  statPctFlights.textContent = "—";
  statPctPax.textContent = "—";
  statScopes.textContent = "—";
  renderCharts({ byDate: [], byAirport: [], byCountry: [] });
  renderInboundTable([]);
  renderOutboundTable([]);
  flightsBody.innerHTML = `<tr><td colspan="9" class="empty">${message}</td></tr>`;
}

function validateSelection() {
  if (!dateFromInput.value || !dateToInput.value || !airportSelect.value) {
    return false;
  }
  if (dateFromInput.value > dateToInput.value) {
    showMessage("From date must be on or before to date.", "error");
    return false;
  }
  return true;
}

function selectionSummary() {
  const days =
    dateFromInput.value && dateToInput.value
      ? Math.max(
          1,
          Math.round(
            (new Date(`${dateToInput.value}T12:00:00`) -
              new Date(`${dateFromInput.value}T12:00:00`)) /
              86_400_000,
          ) + 1,
        )
      : 0;
  const airportLabel =
    airportSelect.value === ALL_VIETNAM
      ? `all ${airportsList.length} airports`
      : airportSelect.value;
  return { days, airportLabel };
}

async function updateCacheUi() {
  loadApiBtn.hidden = !SHOW_LOAD_API_BTN;

  if (!validateSelection()) {
    cacheHint.textContent = "";
    return;
  }

  const { days, airportLabel } = selectionSummary();

  try {
    const status = await apiGet(`/api/dashboard/status?${queryParams()}`);
    const allCached = status.isComplete;

    cacheHint.textContent = allCached
      ? `Cache complete: ${status.scopesTotal} scopes (${status.days} days × ${status.airports.length} airports, ${airportLabel}).`
      : `Cache ${status.completeScopes ?? status.scopesCached}/${status.scopesTotal} for ${days} days · ${airportLabel}.`;
  } catch {
    cacheHint.textContent = `Selection: ${days} days · ${airportLabel}. Cache status unknown.`;
  }
}

async function refreshView() {
  if (!validateSelection()) return;

  syncUrlFromSelection();
  setLoading(true);
  const { days, airportLabel } = selectionSummary();
  showMessage(`Loading dashboard (${days} days · ${airportLabel})…`, "info");

  try {
    const data = await apiGet(`/api/dashboard?${queryParams()}`);
    renderSummary(data);
    if (!data.isComplete) {
      showMessage(
        `Partial cache (${data.completeScopes ?? data.scopesCached}/${data.scopesTotal} scopes) · ${data.totalIncoming?.toLocaleString()} incoming · ${data.filteredCount} RU-origin.`,
        "info",
      );
    } else {
      showMessage("");
    }
  } catch (err) {
    if (err.status === 404) {
      clearView("No cached data for this selection");
      const missing = err.payload?.scopesMissing ?? err.payload?.incompleteScopes;
      showMessage(
        missing != null
          ? `No cached data for this range (${missing} scopes not loaded). Run prefetch or widen dates.`
          : err.message,
        "info",
      );
    } else {
      showMessage(err.message, "error");
    }
  } finally {
    setLoading(false);
    await updateCacheUi();
  }
}

async function loadFromApi() {
  if (!validateSelection()) return;

  setLoading(true);
  showMessage("Fetching schedules from Aviation Edge… This may take a while for large ranges.");

  try {
    const data = await apiPost(`/api/dashboard/load?${queryParams()}`);
    renderSummary(data);
    showMessage(
      `Loaded ${data.filteredCount} RU-origin flights (${data.totalIncoming} total incoming) across ${data.scopesCached}/${data.scopesTotal} scopes.`,
      "info",
    );
  } catch (err) {
    showMessage(err.message || "Load failed", "error");
  } finally {
    setLoading(false);
    await updateCacheUi();
  }
}

function syncDateConstraints() {
  dateToInput.min = dateFromInput.value;
  dateFromInput.max = dateToInput.value;
}

async function init() {
  const today = todayIso();
  const maxFuture = new Date();
  maxFuture.setFullYear(maxFuture.getFullYear() + 1);
  const maxIso = maxFuture.toISOString().slice(0, 10);

  let prefetchStart = addDays(today, 8);
  try {
    const health = await apiGet("/api/health");
    if (health.futureMinDaysAhead) {
      prefetchStart = addDays(today, health.futureMinDaysAhead);
    }
    if (health.hasApiKey) {
      apiStatus.textContent = "API key configured";
      apiStatus.className = "badge badge-ok";
    } else {
      apiStatus.textContent = "No API key (.env)";
      apiStatus.className = "badge badge-warn";
    }
  } catch {
    apiStatus.textContent = "Server offline";
    apiStatus.className = "badge badge-warn";
  }

  const minIso = addDays(today, -30);

  dateFromInput.value = prefetchStart;
  dateToInput.value = addDays(prefetchStart, 29);
  dateFromInput.min = minIso;
  dateFromInput.max = maxIso;
  dateToInput.max = maxIso;
  dateToInput.min = minIso;
  syncDateConstraints();

  const [airports, countries] = await Promise.all([
    apiGet("/api/airports"),
    apiGet("/api/countries"),
  ]);

  airportsList = airports;
  countryNames = new Map(countries.map((c) => [c.iso2, c]));

  airportSelect.innerHTML = [
    `<option value="${ALL_VIETNAM}">All Vietnam (${airports.length} airports)</option>`,
    ...airports.map(
      (a) =>
        `<option value="${a.iata}">${a.city} (${a.iata}) — ${a.airportName}</option>`,
    ),
  ].join("");

  if (!applyUrlState(minIso, maxIso)) {
    airportSelect.value = ALL_VIETNAM;
  }

  let refreshTimer;
  const scheduleRefresh = () => {
    syncDateConstraints();
    updateCacheUi();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshView(), 250);
  };

  dateFromInput.addEventListener("change", scheduleRefresh);
  dateToInput.addEventListener("change", scheduleRefresh);
  airportSelect.addEventListener("change", scheduleRefresh);
  refreshBtn.addEventListener("click", refreshView);
  loadApiBtn.addEventListener("click", loadFromApi);

  window.addEventListener("popstate", () => {
    applyUrlState(minIso, maxIso);
    syncDateConstraints();
    updateCacheUi();
    refreshView();
  });

  await updateCacheUi();
  await refreshView();
}

init().catch((err) => {
  showMessage(`Failed to start: ${err.message}`, "error");
});
