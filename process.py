"""Turn a downloaded IFS tp GRIB file into compact per-step rainfall for the web app.

tp is *accumulated since the run start* in metres. Rain in each forecast interval
is the difference between consecutive steps, converted to millimetres.

Outputs (in --out-dir, default site/data):
  meta.json  run time, step hours, grid definition, scale factor
  rain.bin   uint16 little-endian, shape (n_intervals, n_lat, n_lon), value = mm * SCALE
"""

import argparse
import json
from pathlib import Path

import numpy as np
import xarray as xr

# India bounding box (inclusive), degrees.
LAT_N, LAT_S = 38.0, 5.0
LON_W, LON_E = 66.0, 100.0
SCALE = 10  # store 0.1 mm resolution in uint16 (max 6553.5 mm per interval)


def deaccumulate_mm(acc_m: np.ndarray, axis: int = 0) -> np.ndarray:
    """Accumulated precipitation in metres -> rainfall per interval in mm.

    GRIB packing can make an accumulated series dip by a tiny amount between
    steps, which would give negative rain. Taking the running maximum first
    makes the series non-decreasing, so every interval is >= 0 and the
    intervals still sum exactly to the final (max) accumulation.
    Returns an array with one fewer element along `axis`.
    """
    acc = np.maximum.accumulate(np.asarray(acc_m, dtype=np.float64), axis=axis)
    return np.diff(acc, axis=axis) * 1000.0


def load_india(grib: Path) -> xr.DataArray:
    ds = xr.open_dataset(grib, engine="cfgrib", backend_kwargs={"indexpath": ""})
    tp = ds["tp"]
    # latitude runs north -> south in the file, so slice from N to S.
    return tp.sel(latitude=slice(LAT_N, LAT_S), longitude=slice(LON_W, LON_E)).load()


def process(data_dir: Path, out_dir: Path) -> dict:
    latest = json.loads((data_dir / "latest.json").read_text())
    tp = load_india(data_dir / latest["grib"])

    steps_h = (tp.step.values / np.timedelta64(1, "h")).astype(int).tolist()
    rain = deaccumulate_mm(tp.values, axis=0)  # (n_intervals, lat, lon), mm

    packed = np.clip(np.rint(rain * SCALE), 0, np.iinfo(np.uint16).max).astype("<u2")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "rain.bin").write_bytes(packed.tobytes())

    lat, lon = tp.latitude.values, tp.longitude.values
    meta = {
        "run": latest["run"],
        "steps": steps_h,  # interval i covers steps[i] .. steps[i+1] hours after run
        "lat0": float(lat[0]), "lon0": float(lon[0]),
        "dlat": float(lat[1] - lat[0]), "dlon": float(lon[1] - lon[0]),
        "nlat": int(lat.size), "nlon": int(lon.size),
        "scale": SCALE, "units": "mm per interval",
        "source": "ECMWF IFS open data (CC-BY-4.0)",
    }
    (out_dir / "meta.json").write_text(json.dumps(meta))
    return {"tp": tp, "rain": rain, "packed": packed, "meta": meta}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", type=Path, default=Path("data"))
    ap.add_argument("--out-dir", type=Path, default=Path("site/data"))
    args = ap.parse_args()
    r = process(args.data_dir, args.out_dir)
    m = r["meta"]
    print(f"run {m['run']}: {len(m['steps']) - 1} intervals x {m['nlat']} x {m['nlon']} "
          f"-> {args.out_dir}/rain.bin ({r['packed'].nbytes / 1e6:.1f} MB)")
