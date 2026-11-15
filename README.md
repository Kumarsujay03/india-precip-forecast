# India Precipitation Forecast

A static web app that shows the latest ECMWF IFS open-data precipitation forecast over India
(about 5–38°N, 66–100°E): a map with a rain layer and a time slider, and a rain timeline for any point you click.

> Status: work in progress. Each section below is filled in as its step lands.

## Data source

ECMWF IFS open data (`ecmwf-opendata` package), parameter `tp` (total precipitation),
00/12 UTC runs, steps 0–240 h. Licensed **CC-BY-4.0**. © ECMWF.

## Processing

1. **Fetch** (`fetch.py`): finds the newest 00/12 UTC run whose 240 h file is already published.
   That file is published last, so a run still in progress is skipped and the previous run is used instead.
   It downloads `tp` for all 65 steps (3-hourly to 144 h, 6-hourly to 240 h) into `data/tp_YYYYMMDDHH.grib2`, about 25 MB (global 0.25°),
   and writes `data/latest.json` with the run time. A run that is already downloaded is reused, so `--force` is needed to re-download.

## Verification

_To be added._

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

ecCodes comes from the `eccodeslib` pip wheel, so no system package is needed.

```bash
.venv/bin/python fetch.py          # downloads latest run to data/ (cached)
```

## Known limitations

_To be added._
