"""Build site/india.geojson (India outline used to frame the map and clip the rain layer).

Source: Natural Earth 1:10m Admin 0 countries, India point of view
(ne_10m_admin_0_countries_ind, public domain), i.e. boundaries as claimed by India.
The polygon is simplified (topology-preserving) to keep the file small.

Needs: pip install pyshp shapely  (tool-only; not part of requirements.txt)
Usage: python tools/build_india.py ne_10m_admin_0_countries_ind.shp site/india.geojson
"""

import json
import sys

import shapefile
from shapely.geometry import mapping, shape

TOLERANCE = 0.01   # degrees (~1 km); enough detail for zoom <= 8


def main(shp_path, out_path):
    r = shapefile.Reader(shp_path)
    fields = [f[0] for f in r.fields[1:]]
    k = next(i for i, rec in enumerate(r.records()) if rec[fields.index("ADM0_A3")] == "IND")
    geom = shape(r.shape(k).__geo_interface__)
    simple = geom.simplify(TOLERANCE, preserve_topology=True)
    # drop specks smaller than ~1 km^2 that cannot be seen at our zoom levels
    if simple.geom_type == "MultiPolygon":
        simple = type(simple)([p for p in simple.geoms if p.area > 1e-4])

    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 3), round(c[1], 3)]

    g = mapping(simple)
    g = {"type": g["type"], "coordinates": rnd(g["coordinates"])}
    fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"name": "India"}, "geometry": g}]}
    with open(out_path, "w") as f:
        json.dump(fc, f, separators=(",", ":"))
    print(f"area kept {simple.area / geom.area:.4f}, parts {len(getattr(simple, 'geoms', [simple]))}, "
          f"bbox {tuple(round(v, 2) for v in simple.bounds)} -> {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
