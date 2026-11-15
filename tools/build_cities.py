"""Build site/cities.json (city search list) from GeoNames.

Source: https://download.geonames.org/export/dump/ (cities15000.zip, admin1CodesASCII.txt),
GeoNames, CC BY 4.0. Keeps Indian places inside the forecast box with population
>= MIN_POP, plus all state/UT capitals. Sorted by population (largest first).

Uses the ASCII name column (e.g. "Kolhapur", not "Kolhāpur").

Usage: python tools/build_cities.py cities15000.txt admin1CodesASCII.txt site/cities.json
"""

import json
import sys

LAT_S, LAT_N, LON_W, LON_E = 5.0, 38.0, 66.0, 100.0
MIN_POP = 100_000


def main(cities_path, admin1_path, out_path):
    states = {}
    with open(admin1_path, encoding="utf-8") as f:
        for line in f:
            code, name, *_ = line.rstrip("\n").split("\t")
            if code.startswith("IN."):
                states[code[3:]] = name

    rows = []
    with open(cities_path, encoding="utf-8") as f:
        for line in f:
            c = line.rstrip("\n").split("\t")
            name, lat, lon, fcode, country, admin1, pop = c[2], float(c[4]), float(c[5]), c[7], c[8], c[10], int(c[14] or 0)
            if country != "IN" or not (LAT_S <= lat <= LAT_N and LON_W <= lon <= LON_E):
                continue
            if pop < MIN_POP and fcode not in ("PPLC", "PPLA"):
                continue
            rows.append((pop, [name, states.get(admin1, ""), round(lat, 3), round(lon, 3)]))

    rows.sort(key=lambda r: -r[0])
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump([r[1] for r in rows], f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rows)} places -> {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
