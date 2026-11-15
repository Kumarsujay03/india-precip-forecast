// Rain viewer: smooth rain field per forecast interval, crossfading time slider, play/pause.
// Data: data/meta.json + data/rain.bin (uint16 LE, mm*scale, [interval][lat][lon]).

// Colour by mean rain rate (mm/h) so 3 h and 6 h intervals are comparable.
// Colours are interpolated (in log rate) between these stops.
const STOPS = [
  [0.1, [120, 220, 255]], [0.5, [60, 190, 250]], [1, [40, 140, 240]], [2, [50, 90, 225]],
  [4, [60, 200, 130]], [8, [245, 220, 60]], [16, [250, 130, 35]], [32, [235, 40, 70]],
];
const MIN_RATE = 0.1;       // below this: fully transparent
const SUPERSAMPLE = 4;      // output pixels per grid cell (bilinear in between)
const FRAME_MS = 650;       // playback speed
const FADE_MS = 280;        // crossfade duration (matches CSS)

const $ = (id) => document.getElementById(id);
let map;   // created in initMap() once Leaflet is confirmed loaded

let meta, rain, bounds, rowLat, layers, front = 0, current = -1, timer = null;
const frames = new Map();   // interval index -> data URL (rendered once, reused)

// ---------- colour ----------
const LUT_SIZE = 512, LUT_MAX = 64;  // rate lookup table on a log axis up to 64 mm/h
const lut = new Uint8ClampedArray(LUT_SIZE * 4);
(function buildLut() {
  const lo = Math.log(MIN_RATE), hi = Math.log(LUT_MAX);
  for (let k = 0; k < LUT_SIZE; k++) {
    const rate = Math.exp(lo + (k / (LUT_SIZE - 1)) * (hi - lo));
    let c = STOPS[STOPS.length - 1][1];
    if (rate < STOPS[0][0]) c = STOPS[0][1];
    for (let s = 0; s < STOPS.length - 1; s++) {
      const [r0, c0] = STOPS[s], [r1, c1] = STOPS[s + 1];
      if (rate >= r0 && rate < r1) {
        const f = (Math.log(rate) - Math.log(r0)) / (Math.log(r1) - Math.log(r0));
        c = c0.map((v, i) => v + f * (c1[i] - v));
        break;
      }
    }
    // fade in from MIN_RATE to 1 mm/h so light drizzle is a soft haze
    const a = Math.min(1, (Math.log(rate) - lo) / (Math.log(1) - lo));
    lut.set([c[0], c[1], c[2], 60 + 175 * a], k * 4);
  }
})();
const lutIndex = (rate) =>
  Math.min(LUT_SIZE - 1, Math.round(((Math.log(rate) - Math.log(MIN_RATE)) / (Math.log(LUT_MAX) - Math.log(MIN_RATE))) * (LUT_SIZE - 1)));

// ---------- rendering ----------
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

function setupGrid() {
  const { nlat, nlon, lat0, lon0, dlat, dlon } = meta;
  const north = lat0 - dlat / 2, south = lat0 + dlat * (nlat - 0.5);   // dlat < 0
  const west = lon0 - dlon / 2, east = lon0 + dlon * (nlon - 0.5);
  bounds = [[south, west], [north, east]];
  // Canvas rows evenly spaced in Web Mercator y, so Leaflet's linear stretch lands correctly.
  const H = Math.round(nlat * SUPERSAMPLE * 1.15);
  const yN = mercY(north), yS = mercY(south);
  rowLat = new Float32Array(H);
  for (let r = 0; r < H; r++) {
    const y = yN + ((r + 0.5) / H) * (yS - yN);
    rowLat[r] = (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;
  }
  if (indiaGeo) indiaMask = buildMask(indiaGeo, nlon * SUPERSAMPLE, H, west, east, yN, yS);
}
let indiaGeo = null;

function renderFrame(t) {
  if (frames.has(t)) return frames.get(t);
  const { nlat, nlon, lat0, lon0, dlat, scale, steps } = meta;
  const hours = steps[t + 1] - steps[t];
  const W = nlon * SUPERSAMPLE, H = rowLat.length;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(W, H);
  const base = t * nlat * nlon, k = 1 / (scale * hours);
  for (let r = 0; r < H; r++) {
    const fi = Math.min(nlat - 1, Math.max(0, (rowLat[r] - lat0) / dlat));
    const i0 = Math.floor(fi), i1 = Math.min(nlat - 1, i0 + 1), wi = fi - i0;
    const row0 = base + i0 * nlon, row1 = base + i1 * nlon;
    for (let x = 0; x < W; x++) {
      const fj = Math.min(nlon - 1, Math.max(0, (x + 0.5) / SUPERSAMPLE - 0.5));
      const j0 = Math.floor(fj), j1 = Math.min(nlon - 1, j0 + 1), wj = fj - j0;
      const v = (rain[row0 + j0] * (1 - wj) + rain[row0 + j1] * wj) * (1 - wi)
              + (rain[row1 + j0] * (1 - wj) + rain[row1 + j1] * wj) * wi;
      const rate = v * k;
      if (rate < MIN_RATE || (indiaMask && !indiaMask[r * W + x])) continue;
      const q = lutIndex(rate) * 4, p = (r * W + x) * 4;
      img.data[p] = lut[q]; img.data[p + 1] = lut[q + 1]; img.data[p + 2] = lut[q + 2]; img.data[p + 3] = lut[q + 3];
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  frames.set(t, url);
  return url;
}

// Crossfade: load the new frame into the hidden overlay, then swap opacities.
function show(t) {
  if (t === current) return;
  current = t;
  const back = layers[1 - front];
  const img = back.getElement();
  const url = renderFrame(t);
  const swap = () => {
    if (current !== t) return;            // a newer frame was requested meanwhile
    back.setOpacity(1);
    layers[front].setOpacity(0);
    front = 1 - front;
  };
  if (img.src === url) swap();
  else { img.onload = swap; back.setUrl(url); }
  updateLabels(t);
  window.pointPanel?.onFrame(t);
  // warm the cache for the next frame so playback stays smooth
  requestIdleCallback?.(() => renderFrame((t + 1) % (meta.steps.length - 1)));
}

// ---------- labels / controls ----------
function fmtIST(d, opts) {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false, ...opts });
}

function updateLabels(t) {
  const { steps } = meta, run = Date.parse(meta.run);
  const start = new Date(run + steps[t] * 3600e3), end = new Date(run + steps[t + 1] * 3600e3);
  const hm = { hour: "2-digit", minute: "2-digit" };
  $("valid").textContent = `${fmtIST(start, { weekday: "short", day: "numeric", month: "short" })} · ${fmtIST(start, hm)}–${fmtIST(end, hm)} IST`;
  $("lead").textContent = `+${steps[t]}–${steps[t + 1]} h · ${steps[t + 1] - steps[t]} h interval`;
  // slider is in forecast hours (time-proportional), not interval index
  $("slider").value = steps[t];
  $("slider").style.setProperty("--pct", `${(steps[t] / steps[steps.length - 2]) * 100}%`);
}

function buildTicks() {
  // one tick per IST midnight, positioned at the interval that starts the day
  const { steps } = meta, run = Date.parse(meta.run), n = steps.length - 1;
  const box = $("ticks");
  box.innerHTML = "";
  let prevDay = null;
  for (let t = 0; t < n; t++) {
    const d = new Date(run + steps[t] * 3600e3);
    const day = fmtIST(d, { day: "numeric" });
    if (day !== prevDay && prevDay !== null) {
      const el = document.createElement("span");
      el.style.left = `${(steps[t] / steps[n - 1]) * 100}%`;
      el.textContent = fmtIST(d, { weekday: "short", day: "numeric" });
      box.appendChild(el);
    }
    prevDay = day;
  }
}

function buildLegend() {
  // Labels sit at the same percentage positions as their colour stops, so they line up exactly.
  const last = STOPS.length - 1, pos = (i) => (i / last) * 100;
  const grad = STOPS.map(([, c], i) => `rgb(${c}) ${pos(i)}%`).join(",");
  const ticks = STOPS.map(([r], i) => `<i style="left:${pos(i)}%">${r}${i === last ? "+" : ""}</i>`).join("");
  $("legend").innerHTML =
    `<span class="unit">mm/h</span>` +
    `<div class="scale"><span class="ramp" style="background:linear-gradient(90deg,${grad})"></span>` +
    `<div class="stops" aria-hidden="true">${ticks}</div></div>`;
}

function setPlaying(on) {
  clearInterval(timer);
  timer = null;
  $("play").classList.toggle("on", on);
  $("play").setAttribute("aria-label", on ? "Pause" : "Play");
  if (on) {
    const n = meta.steps.length - 1;
    timer = setInterval(() => show((current + 1) % n), FRAME_MS);
  }
}

function initMap() {
  if (!window.L) throw new Error("the map library (Leaflet) could not be loaded - check your connection or content blocker");
  // No basemap tiles: the map shows only India (outline from india.geojson) with the rain on top.
  map = L.map("map", { zoomSnap: 0.25, zoomDelta: 0.5, maxZoom: 9, attributionControl: true });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  map.createPane("land").style.zIndex = 350;      // below rain overlays (400)
  map.createPane("border").style.zIndex = 450;    // outline drawn above the rain
  map.createPane("labels").style.zIndex = 460;
  map.getPane("border").style.pointerEvents = "none";
  map.getPane("labels").style.pointerEvents = "none";
  fitIndia();
  window.addEventListener("resize", () => { clearTimeout(fitIndia.t); fitIndia.t = setTimeout(() => fitIndia(true), 200); });
}

const INDIA_BOUNDS = [[6.5, 68], [37.2, 97.5]];
function fitIndia(keepView = false) {
  // Fit India to the screen, then stop users panning/zooming far away from it.
  const z = map.getBoundsZoom(INDIA_BOUNDS, false, L.point(16, 16));
  map.setMinZoom(z);
  map.setMaxBounds(L.latLngBounds(INDIA_BOUNDS).pad(0.15));
  if (!keepView || map.getZoom() < z) map.fitBounds(INDIA_BOUNDS, { padding: [8, 8] });
}

let indiaMask = null;   // Uint8Array over the rain canvas: 1 = inside India

function addIndia(geo) {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim();
  L.geoJSON(geo, { pane: "land", interactive: false,
    style: { stroke: false, fillColor: "#0f1a24", fillOpacity: 1 } }).addTo(map);
  L.geoJSON(geo, { pane: "border", interactive: false,
    style: { color: accent, weight: 1.2, opacity: 0.85, fill: false, className: "india-border" } }).addTo(map);
  map.attributionControl.addAttribution('Boundary: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (India view)');
}

// Rasterise the India polygons onto the rain canvas grid (same Mercator row spacing),
// so rain outside India is not drawn.
function buildMask(geo, W, H, west, east, yN, yS) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  const px = (lon) => ((lon - west) / (east - west)) * W;
  const py = (lat) => ((mercY(lat) - yN) / (yS - yN)) * H;
  for (const f of geo.features) {
    const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const ring of poly) {
      ring.forEach(([lon, lat], k) => (k ? ctx.lineTo(px(lon), py(lat)) : ctx.moveTo(px(lon), py(lat))));
      ctx.closePath();
    }
  }
  ctx.fill("evenodd");
  const a = ctx.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
  for (let k = 0; k < m.length; k++) m[k] = a[k * 4 + 3] > 0 ? 1 : 0;
  // Grow the mask by MASK_GROW px (~7 km each) so coasts and small islands keep their rain.
  let cur = m;
  for (let pass = 0; pass < MASK_GROW; pass++) {
    const next = cur.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (cur[y * W + x]) continue;
      if ((x > 0 && cur[y * W + x - 1]) || (x < W - 1 && cur[y * W + x + 1]) ||
          (y > 0 && cur[(y - 1) * W + x]) || (y < H - 1 && cur[(y + 1) * W + x])) next[y * W + x] = 1;
    }
    cur = next;
  }
  return cur;
}
const MASK_GROW = 2;

function inIndia(latlng) {
  if (!indiaMask) return true;
  const { nlon } = meta, W = nlon * SUPERSAMPLE, H = rowLat.length;
  const [[south, west], [north, east]] = bounds;
  const x = Math.floor(((latlng.lng - west) / (east - west)) * W);
  const y = Math.floor(((mercY(north) - mercY(latlng.lat)) / (mercY(north) - mercY(south))) * H);
  return x >= 0 && x < W && y >= 0 && y < H && indiaMask[y * W + x] === 1;
}

// [min zoom, max labels, min spacing in degrees] - larger cities win; nearby smaller ones are skipped
const CITY_TIERS = [[0, 12, 1.5], [5.5, 40, 0.7], [7, 150, 0.25]];
function addCityLabels(cities) {
  const chosen = [];
  const layers = CITY_TIERS.map(([minZ, count, sep]) => {
    const picked = [];
    for (const c of cities) {
      if (chosen.length >= count) break;
      if (chosen.includes(c)) continue;
      if (chosen.some((o) => Math.hypot(o[2] - c[2], o[3] - c[3]) < sep)) continue;
      chosen.push(c); picked.push(c);
    }
    return [minZ, L.layerGroup(picked.map(([name, , lat, lon]) =>
      L.circleMarker([lat, lon], { pane: "labels", radius: 2, weight: 0, fillColor: "#d6e6ee", fillOpacity: 0.9, interactive: false })
        .bindTooltip(name, { permanent: true, direction: "right", offset: [4, 0], className: "city-label", pane: "labels" })))];
  });
  const markers = layers.flatMap(([, g]) => g.getLayers());   // largest cities first
  // Screen-space decluttering: walk cities largest-first and hide any label (and its dot)
  // that would overlap one already shown.
  function declutter() {
    const shown = [];
    for (const m of markers) {
      const tip = m.getTooltip()?.getElement(), dot = m.getElement();
      if (!tip || !dot) continue;
      tip.style.visibility = dot.style.visibility = "";
      const b = tip.getBoundingClientRect();
      const hit = shown.some((o) => b.left < o.right + 4 && o.left < b.right + 4 && b.top < o.bottom + 2 && o.top < b.bottom + 2);
      if (hit) tip.style.visibility = dot.style.visibility = "hidden";
      else shown.push(b);
    }
  }
  const update = () => {
    layers.forEach(([minZ, g]) => (map.getZoom() >= minZ ? g.addTo(map) : g.remove()));
    declutter();
  };
  map.on("zoomend", update);
  update();
}

// Fetch rain.bin with a progress bar. Size is known from meta.json, so progress works
// even when the server compresses the response (Content-Length is then the gzip size).
async function fetchBin(url, expected, onProgress) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  if (!r.body) return r.arrayBuffer();
  const out = new Uint8Array(expected), reader = r.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > expected) throw new Error("rain.bin is larger than meta.json says");
    out.set(value, got);
    got += value.length;
    onProgress(got / expected);
  }
  if (got !== expected) throw new Error("rain.bin is incomplete");
  return out.buffer;
}

function loader(msg, frac) {
  $("loader-msg").textContent = msg;
  if (frac !== undefined) $("loader-bar").style.width = `${Math.round(frac * 100)}%`;
}

async function main() {
  window.appStarted = true;
  initMap();
  loader("Fetching forecast metadata…", 0.02);
  const indiaReq = fetch("india.geojson", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const mr = await fetch("data/meta.json", { cache: "no-cache" });
  if (!mr.ok) throw new Error(`forecast data not found (meta.json: HTTP ${mr.status})`);
  meta = await mr.json();
  const n = meta.steps.length - 1, bytes = n * meta.nlat * meta.nlon * 2;
  rain = new Uint16Array(await fetchBin("data/rain.bin", bytes,
    (f) => loader(`Downloading rainfall grid… ${((f * bytes) / 1e6).toFixed(1)} / ${(bytes / 1e6).toFixed(1)} MB`, 0.05 + 0.85 * f)));
  loader("Rendering map…", 0.95);
  indiaGeo = await indiaReq;
  if (indiaGeo) addIndia(indiaGeo);

  $("run").textContent = `IFS run ${meta.run.slice(0, 16).replace("T", " ")} UTC`;
  setupGrid();
  layers = [0, 1].map(() => L.imageOverlay(renderFrame(0), bounds, { opacity: 0, className: "rain" }).addTo(map));

  const slider = $("slider");
  slider.max = meta.steps[n - 1];
  slider.step = 3;
  const intervalAt = (h) => { let t = 0; while (t < n - 1 && meta.steps[t + 1] <= h) t++; return t; };
  slider.addEventListener("input", () => { setPlaying(false); show(intervalAt(+slider.value)); });
  $("play").addEventListener("click", () => setPlaying(!timer));
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" && e.target !== slider) return;
    if (e.key === " ") { e.preventDefault(); setPlaying(!timer); }
    if (e.key === "ArrowRight" && e.target !== slider) show(Math.min(n - 1, current + 1));
    if (e.key === "ArrowLeft" && e.target !== slider) show(Math.max(0, current - 1));
  });
  buildLegend();
  buildTicks();
  show(0);
  document.body.classList.add("ready");
  map.invalidateSize();   // layout (controls, fonts) has settled: re-measure and refit India
  fitIndia();
  window.pointPanel = setupPointPanel(map, meta, rain, () => current);
  // City search is optional: if the list fails to load, the rest of the app still works.
  fetch("cities.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((cities) => { addCityLabels(cities); setupSearch(map, cities, window.pointPanel); })
    .catch(() => { $("finder").hidden = true; });
}

main().catch((e) => {
  console.error(e);
  window.loaderError(`Could not load the forecast: ${e.message}.`);
});
