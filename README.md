# India Precipitation Forecast

A static web app that shows the latest ECMWF IFS open-data precipitation forecast over India
(about 5–38°N, 66–100°E): a map with a rain layer and a time slider, and a rain timeline for any point you click.

**Live:** https://kumarsujay03.github.io/india-precip-forecast/ (updated daily)

## Data source

ECMWF IFS open data (`ecmwf-opendata` package), parameter `tp` (total precipitation),
00/12 UTC runs, steps 0–240 h. Licensed **CC-BY-4.0**. © ECMWF.

## Processing

1. **Fetch** (`fetch.py`): finds the newest 00/12 UTC run whose 240 h file is already published.
   That file is published last, so a run still in progress is skipped and the previous run is used instead.
   It downloads `tp` for all 65 steps (3-hourly to 144 h, 6-hourly to 240 h) into `data/tp_YYYYMMDDHH.grib2`, about 25 MB (global 0.25°),
   and writes `data/latest.json` with the run time. A run that is already downloaded is reused, so `--force` is needed to re-download.
2. **Process** (`process.py`):
   - **Crop:** keeps the India box 38→5°N, 66→100°E, a 133×137 grid at 0.25°.
   - **De-accumulate:** `tp` is the total *since the run started*, in metres, not the rain in each step.
     Rain in interval *i* is `tp[i+1] − tp[i]`, multiplied by 1000 to get mm.
     GRIB packing makes some accumulated series dip slightly, by up to 0.24 mm in a real run.
     Applying a running maximum first stops those dips from producing negative rain, and the intervals still add up exactly to the final total.
   - **Pack:** writes `site/data/rain.bin` as uint16 mm×10, shaped (64 intervals, lat, lon), about 2.3 MB.
     `site/data/meta.json` holds the run time, step hours and grid. Intervals are 3 h up to 144 h, then 6 h.

## Front end

`site/` is plain HTML/JS with Leaflet 1.9.4 and no build step.
`rain.bin` is loaded into a `Uint16Array`. Each interval is drawn to a canvas and shown as a Leaflet image overlay.
The canvas rows are spaced evenly in Web Mercator y, so the 0.25° lat/lon grid lines up with the basemap; a plain lat/lon image would drift north–south.
Colours show the **mean rain rate in mm/h** over the interval, so 3 h and 6 h intervals are comparable.
Times are shown in IST.

- **Smooth field:** each frame is drawn at 4× the grid resolution with bilinear interpolation.
  Colours blend continuously, on a log scale, through stops from 0.1 to 32 mm/h. Drizzle fades in instead of starting at a hard edge.
- **Animation:**
  - Two image overlays crossfade over 280 ms when the time changes.
  - The play/pause button (or Space) steps through about 1.5 frames per second, and the ← → keys step one frame.
  - Each frame is rendered once (about 10 ms) and cached, and the next frame is rendered ahead during idle time.
- **Time slider:** proportional to forecast hours, so the 6-hourly days after 144 h are not squeezed. It has IST day ticks.

## Deployment

`.github/workflows/deploy.yml` runs daily at 09:30 UTC, when the 00 UTC run is fully published. It also runs on manual dispatch and on every push to `main`.
It runs in this order: `pytest`, then `fetch.py`, then `process.py`, then the `site/` folder is uploaded and deployed to GitHub Pages.
Forecast data is built inside the job and never committed.
If any step fails, the deploy job doesn't run, so the last good site stays live.
Pull requests run the build only.

## Verification

- `pytest`: a known accumulated series in metres gives the expected mm per step.
  A packing dip gives no negatives and keeps the total, and the per-interval values sum back to the total on a grid.
- Real run, 2026-11-15 00 UTC:
  - `tp` at step 0 is 0.
  - 3,177 of 1.17 M raw differences were negative, the worst at −0.24 mm. After processing the minimum is 0 and there are no NaNs.
  - The per-interval values sum back to the running-maximum total exactly (difference 0).
  - Packing to 0.1 mm changes the 10-day totals by a mean of 0.10 mm and at most 0.78 mm.
- Chennai (13.0°N, 80.25°E), daily totals against Open-Meteo's `ecmwf_ifs025` model: 10-day total of 107.9 mm here vs 108.9 mm there, and every day within 0.5 mm.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

ecCodes comes from the `eccodeslib` pip wheel, so no system package is needed.

```bash
.venv/bin/python fetch.py          # downloads latest run to data/ (cached)
.venv/bin/python process.py        # writes site/data/meta.json + rain.bin
.venv/bin/pytest -q                # de-accumulation / unit tests
python3 -m http.server 8765 -d site   # open http://localhost:8765
```

## Known limitations

- Bilinear smoothing is for display only. It can make rain appear slightly beyond the 0.25° cells that actually had it.
- The map uses whole zoom levels to avoid tile seams. Faint seams can still show on displays with fractional scaling (for example 1.67×) in Chromium.
