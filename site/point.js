// Click a point: rain timeline chart, summary and next dry window for the nearest grid cell.
// Uses nextDryWindow / rainBetween from dry.js and Chart.js.

function setupPointPanel(map, meta, rain, getFrame) {
  const $ = (id) => document.getElementById(id);
  const { steps, nlat, nlon, lat0, lon0, dlat, dlon, scale } = meta;
  const n = steps.length - 1, runMs = Date.parse(meta.run), last = steps[n];
  const css = getComputedStyle(document.documentElement);
  const ACCENT = css.getPropertyValue("--accent").trim(), DIM = css.getPropertyValue("--dim").trim(),
        LINE = css.getPropertyValue("--line").trim(), TEXT = css.getPropertyValue("--text").trim();

  const hToDate = (h) => new Date(runMs + h * 3600e3);
  const fmt = (h, opts) => hToDate(h).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false, ...opts });
  const dayTime = (h) => `${fmt(h, { weekday: "short", day: "numeric", month: "short" })}, ${fmt(h, { hour: "2-digit", minute: "2-digit" })}`;
  const nowH = () => (Date.now() - runMs) / 3600e3;

  let marker = null, chart = null, state = null;

  // Chart.js plugin: shade the dry window, mark "now" and the map's current frame.
  const overlays = {
    id: "overlays",
    beforeDatasetsDraw(c) {
      if (!state) return;
      const { ctx, chartArea: a, scales: { x } } = c;
      ctx.save();
      if (state.dry) {
        const x0 = x.getPixelForValue(state.dry.start), x1 = x.getPixelForValue(state.dry.end);
        ctx.fillStyle = "rgba(56,214,245,0.10)";
        ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      }
      const t = getFrame();
      const fx0 = x.getPixelForValue(steps[t]), fx1 = x.getPixelForValue(steps[t + 1]);
      ctx.fillStyle = "rgba(214,230,238,0.10)";
      ctx.fillRect(fx0, a.top, Math.max(1, fx1 - fx0), a.bottom - a.top);
      const h = nowH();
      if (h >= 0 && h <= last) {
        const xn = x.getPixelForValue(h);
        ctx.strokeStyle = ACCENT; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xn, a.top); ctx.lineTo(xn, a.bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = ACCENT; ctx.font = "10px ui-monospace, monospace";
        ctx.fillText("now", xn + 3, a.top + 10);
      }
      ctx.restore();
    },
  };

  function series(i, j) {
    const mm = new Array(n);
    for (let t = 0; t < n; t++) mm[t] = rain[t * nlat * nlon + i * nlon + j] / scale;
    return mm;
  }

  function open(latlng, label) {
    const i = Math.round((latlng.lat - lat0) / dlat), j = Math.round((latlng.lng - lon0) / dlon);
    if (i < 0 || i >= nlat || j < 0 || j >= nlon || !window.inIndia(latlng)) return false;   // outside India
    const glat = lat0 + i * dlat, glon = lon0 + j * dlon;
    const mm = series(i, j);
    const from = Math.max(0, nowH());
    const dry = from < last ? nextDryWindow(steps, mm, from) : null;
    state = { mm, dry };

    if (!marker) marker = L.circleMarker([glat, glon], { radius: 6, color: ACCENT, weight: 2, fillOpacity: 0.15 }).addTo(map);
    else marker.setLatLng([glat, glon]);

    setTitle(latlng, label, `${glat.toFixed(2)}°N ${glon.toFixed(2)}°E`);
    $("pt-dry").innerHTML = dryText(dry, from);
    const next24 = rainBetween(steps, mm, from, Math.min(last, from + 24));
    const total = rainBetween(steps, mm, from, last);
    let peak = 0, peakT = 0;
    mm.forEach((v, t) => { const r = v / (steps[t + 1] - steps[t]); if (r > peak) { peak = r; peakT = t; } });
    $("pt-stats").innerHTML =
      `<div><b>${next24.toFixed(1)}</b> mm <span>next 24 h</span></div>` +
      `<div><b>${total.toFixed(0)}</b> mm <span>to ${fmt(last, { day: "numeric", month: "short" })}</span></div>` +
      `<div><b>${peak.toFixed(1)}</b> mm/h <span>peak${peak > 0 ? ", " + fmt(steps[peakT], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span></div>`;

    drawChart(mm);
    $("point").hidden = false;
    requestAnimationFrame(() => $("point").classList.add("open"));
    return true;
  }

  // Title: place name (searched label, the nearest listed city, or "N km from <city>")
  // on the first line; state and grid-cell coordinates below.
  const NEAR_KM = 12;
  function setTitle(latlng, label, coords) {
    const p = window.nearestPlace?.(latlng.lat, latlng.lng);
    let place = label || "Selected point", sub = coords;
    if (p && (label ? p.km < 5 : p.km < NEAR_KM)) {
      place = label || p.name;                       // inside a town: name it, state below
      sub = `${p.state} · ${coords}`;
    } else if (p && !label) {
      // Farther away: give the distance to the nearest town. The state belongs to that town,
      // not necessarily to the clicked point (which may be across a state border).
      place = `${Math.round(p.km)} km from ${p.name}`;
      sub = `${p.name}, ${p.state} · ${coords}`;
    }
    $("pt-place").textContent = place;
    $("pt-sub").textContent = sub;
  }

  function dryText(dry, from) {
    if (from >= last) return `<b>Forecast expired</b> — waiting for the next run.`;
    const end = dayTime(last);
    if (!dry) return `<b>No dry spell</b> of 6 h or more until ${end} IST.`;
    if (dry.dryNow && dry.openEnded) return `<b>Dry now</b> and for the rest of the forecast (to ${end} IST).`;
    if (dry.dryNow) return `<b>Dry now</b> until ${dayTime(dry.end)} IST <span>(${Math.round(dry.hours)} h)</span>.`;
    if (dry.openEnded) return `<b>Next dry window</b> from ${dayTime(dry.start)} IST to the end of the forecast.`;
    return `<b>Next dry window</b> ${dayTime(dry.start)} → ${dayTime(dry.end)} IST <span>(${Math.round(dry.hours)} h)</span>.`;
  }

  function drawChart(mm) {
    // stepped mean rate (mm/h) per interval + cumulative total (mm)
    const rate = mm.map((v, t) => ({ x: steps[t], y: v / (steps[t + 1] - steps[t]) }));
    rate.push({ x: last, y: rate[n - 1].y });
    let acc = 0;
    const cum = [{ x: 0, y: 0 }, ...mm.map((v, t) => ({ x: steps[t + 1], y: (acc += v) }))];

    if (chart) {
      chart.data.datasets[0].data = rate;
      chart.data.datasets[1].data = cum;
      chart.update();
      return;
    }
    Chart.defaults.font.family = "ui-monospace, monospace";
    Chart.defaults.font.size = 10;
    Chart.defaults.color = DIM;
    chart = new Chart($("pt-chart"), {
      type: "line",
      data: {
        datasets: [
          { label: "rate mm/h", data: rate, stepped: "before", fill: true, borderWidth: 1.5, pointRadius: 0,
            borderColor: ACCENT, backgroundColor: "rgba(56,214,245,0.25)", yAxisID: "y" },
          { label: "total mm", data: cum, borderWidth: 1, pointRadius: 0, borderColor: TEXT,
            borderDash: [4, 3], tension: 0.2, yAxisID: "y2" },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { type: "linear", min: 0, max: last, grid: { color: LINE },
               ticks: { stepSize: 24, maxRotation: 0, autoSkip: true, autoSkipPadding: 8, callback: (h) => fmt(h, { weekday: "short", day: "numeric" }) } },
          y: { beginAtZero: true, grid: { color: LINE }, title: { display: true, text: "mm/h" } },
          y2: { beginAtZero: true, position: "right", grid: { display: false }, title: { display: true, text: "total mm" } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => dayTime(items[0].parsed.x) + " IST",
              label: (item) => item.datasetIndex === 0 ? ` ${item.parsed.y.toFixed(1)} mm/h` : ` ${item.parsed.y.toFixed(1)} mm total`,
            },
          },
        },
      },
      plugins: [overlays],
    });
  }

  function close() {
    $("point").classList.remove("open");
    $("point").hidden = true;
    if (marker) { marker.remove(); marker = null; }
    state = null;
  }

  map.on("click", (e) => { if (!open(e.latlng)) window.toast?.("Click inside India for a point forecast."); });
  $("pt-close").addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  return {
    open,
    onFrame: () => { if (chart && state) chart.draw(); },
  };
}
