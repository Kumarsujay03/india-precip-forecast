// Minimal viewer: rain layer for one forecast interval + time slider.
// Data: data/meta.json + data/rain.bin (uint16 LE, mm*scale, [interval][lat][lon]).

// Colour by mean rain rate (mm/h) so 3 h and 6 h intervals are comparable.
const LEVELS = [0.1, 0.5, 1, 2, 4, 8, 16, 32];          // mm/h thresholds
const COLORS = [
  [160, 230, 255], [90, 200, 250], [40, 150, 240], [30, 90, 220],
  [60, 200, 120], [250, 220, 50], [250, 120, 30], [230, 30, 60],
];

// Keyless dark basemap (CARTO dark tiles now return an "API key required" placeholder).
const map = L.map("map", { zoomSnap: 0.25, minZoom: 3, maxZoom: 10 });
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
  maxZoom: 10,
}).addTo(map);
map.fitBounds([[5, 66], [38, 100]]);

let meta, rain, overlay;

function colorFor(rate) {
  let k = -1;
  for (let i = 0; i < LEVELS.length; i++) if (rate >= LEVELS[i]) k = i;
  return k < 0 ? null : COLORS[k];
}

// Web Mercator y for a latitude (for reprojecting the lat/lon grid).
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

function render(t) {
  const { nlat, nlon, lat0, lon0, dlat, dlon, scale, steps } = meta;
  const hours = steps[t + 1] - steps[t];
  const north = lat0 - dlat / 2, south = lat0 + dlat * (nlat - 0.5);  // dlat < 0
  const west = lon0 - dlon / 2, east = lon0 + dlon * (nlon - 0.5);

  // Canvas rows are evenly spaced in Mercator y, so the image overlay
  // (which Leaflet stretches linearly in projected space) lands correctly.
  const W = nlon, H = 300;
  const yN = mercY(north), yS = mercY(south);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(W, H);
  const base = t * nlat * nlon;
  for (let r = 0; r < H; r++) {
    const y = yN + ((r + 0.5) / H) * (yS - yN);
    const lat = (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;
    const i = Math.min(nlat - 1, Math.max(0, Math.round((lat - lat0) / dlat)));
    for (let j = 0; j < W; j++) {
      const rate = rain[base + i * nlon + j] / scale / hours;
      const c = colorFor(rate);
      if (!c) continue;
      const p = (r * W + j) * 4;
      img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2]; img.data[p + 3] = 190;
    }
  }
  ctx.putImageData(img, 0, 0);

  const bounds = [[south, west], [north, east]];
  if (overlay) overlay.setUrl(canvas.toDataURL());
  else overlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: 0.85, className: "rain" }).addTo(map);

  const run = new Date(meta.run);
  const start = new Date(run.getTime() + steps[t] * 3600e3);
  const end = new Date(run.getTime() + steps[t + 1] * 3600e3);
  document.getElementById("valid").textContent = `${fmtIST(start)} → ${fmtIST(end, true)} IST`;
  document.getElementById("lead").textContent = `(+${steps[t]}–${steps[t + 1]} h, ${hours} h interval)`;
}

function fmtIST(d, timeOnly = false) {
  const opts = { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false };
  if (!timeOnly) Object.assign(opts, { weekday: "short", day: "numeric", month: "short" });
  return d.toLocaleString("en-IN", opts);
}

function buildLegend() {
  const ramp = COLORS.map((c) => `<span style="background:rgb(${c})"></span>`).join("");
  document.getElementById("legend").innerHTML =
    `<span>mm/h</span><span class="ramp">${ramp}</span><span>${LEVELS.join(" · ")}+</span>`;
}

async function main() {
  meta = await (await fetch("data/meta.json", { cache: "no-cache" })).json();
  const buf = await (await fetch("data/rain.bin", { cache: "no-cache" })).arrayBuffer();
  rain = new Uint16Array(buf);
  const n = meta.steps.length - 1;
  if (rain.length !== n * meta.nlat * meta.nlon) throw new Error("rain.bin size does not match meta.json");

  const run = new Date(meta.run);
  document.getElementById("run").textContent =
    `ECMWF IFS run ${run.toISOString().slice(0, 16).replace("T", " ")} UTC`;

  const slider = document.getElementById("slider");
  slider.max = n - 1;
  slider.addEventListener("input", () => render(+slider.value));
  buildLegend();
  render(0);
}

main().catch((e) => {
  document.getElementById("run").textContent = `Failed to load forecast: ${e.message}`;
  console.error(e);
});
