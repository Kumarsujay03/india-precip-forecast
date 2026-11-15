"""Download the latest complete ECMWF IFS open-data run of total precipitation (tp).

Only 00 and 12 UTC runs go out to 240 h. A run counts as available when its
step-240 file exists (it is published last), so if the newest run is still
being published we automatically fall back to the previous one.
"""

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

from ecmwf.opendata import Client

# IFS HRES open data: 3-hourly to 144 h, then 6-hourly to 240 h.
STEPS = list(range(0, 145, 3)) + list(range(150, 241, 6))
PARAM = "tp"


def latest_run(client: Client) -> dt.datetime:
    """Newest 00/12 UTC run whose final (240 h) step is published."""
    found = []
    for hour in (0, 12):
        try:
            found.append(client.latest(type="fc", stream="oper", param=PARAM, step=240, time=hour))
        except ValueError:
            pass
    if not found:
        raise RuntimeError("no complete 00/12 UTC run found in the last 2 days")
    return max(found)


def fetch(out_dir: Path, force: bool = False) -> Path:
    client = Client(source="ecmwf", model="ifs", resol="0p25")
    run = latest_run(client)
    stamp = run.strftime("%Y%m%d%H")
    target = out_dir / f"tp_{stamp}.grib2"
    out_dir.mkdir(parents=True, exist_ok=True)

    if target.exists() and not force:
        print(f"cached: {target} (run {run:%Y-%m-%d %H} UTC)")
    else:
        print(f"downloading run {run:%Y-%m-%d %H} UTC, {len(STEPS)} steps -> {target}")
        tmp = target.with_suffix(".part")
        client.retrieve(
            type="fc", stream="oper", param=PARAM, step=STEPS,
            date=run.strftime("%Y%m%d"), time=run.hour, target=str(tmp),
        )
        tmp.rename(target)

    meta = {"run": run.strftime("%Y-%m-%dT%H:00:00Z"), "steps": STEPS, "grib": target.name}
    (out_dir / "latest.json").write_text(json.dumps(meta))
    return target


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-dir", type=Path, default=Path("data"))
    ap.add_argument("--force", action="store_true", help="re-download even if cached")
    args = ap.parse_args()
    try:
        fetch(args.out_dir, args.force)
    except Exception as e:  # noqa: BLE001 - surface any failure as a non-zero exit
        print(f"fetch failed: {e}", file=sys.stderr)
        sys.exit(1)
