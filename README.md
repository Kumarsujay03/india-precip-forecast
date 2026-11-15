# India Precipitation Forecast

A static web app that shows the latest ECMWF IFS open-data precipitation forecast over India
(about 5–38°N, 66–100°E): a map with a rain layer and a time slider, and a rain timeline for any point you click.

> Status: work in progress. Each section below is filled in as its step lands.

## Data source

ECMWF IFS open data (`ecmwf-opendata` package), parameter `tp` (total precipitation),
00/12 UTC runs, steps 0–240 h. Licensed **CC-BY-4.0**. © ECMWF.

## Processing

_To be added._

## Verification

_To be added._

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

ecCodes comes from the `eccodeslib` pip wheel, so no system package is needed.

## Known limitations

_To be added._
