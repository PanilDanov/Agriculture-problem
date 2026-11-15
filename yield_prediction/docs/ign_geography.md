# Official IGN selection geography

The current province lookup and ES112 selection boundaries are derived from
Spain's official IGN *Unidades Administrativas* WFS, retrieved on 15 November
2026. They replace the former GISCO polygons. The [IGN data policy](https://www.ign.es/web/ign/portal/politica-datos)
and [use licence](https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf)
provide CC BY 4.0 terms. The service's actual `AccessConstraints` reads
`CC BY 4.0 ign.es`.

**Obra derivada de Unidades Administrativas (IGN), consulta 2026-11-15,
CC-BY 4.0 ign.es.** Transformation, simplification and conversion into the
project's JSON registries are adaptations by orbitFarm, not an IGN product or
endorsement. Preserve this attribution in the interface and redistribution.

## Actual source and crosswalk

The [official WFS capabilities](https://www.ign.es/wfs-inspire/unidades-administrativas?service=WFS&request=GetCapabilities)
identify `au:AdministrativeUnit`. A WFS 2.0 FES filter on
`au:nationalLevel/@xlink:href` selects `3rdOrder`. The actual response contains
53 administrative units, 31,439,603 bytes, SHA-256
`76e6d1ab823f43ee216f975eaffc5007e9c68ad4c5cf4a6ce6b8f8f4c23bb42a`.
The exact encoded request, response timestamp and checksums are recorded in
[`artifacts/reference/ign_geometry_audit.json`](../artifacts/reference/ign_geometry_audit.json).
The original GML stays under ignored `.data/license-audit/`, outside Git.

Every official `nationalCode` has country `34`, two autonomous-community digits,
two INE province digits and municipal suffix `00000`. Codes `01`–`50` map exactly
to the already reviewed MAPA province keys. The three excluded records are
`51` Ceuta, `52` Melilla and `54` territories not assigned to a province; these
are outside this model's 50-province training scope. Their names/codes/reasons
remain in the audit. Island provinces are taken directly from IGN's province
units rather than reconstructed using GISCO island polygons. Original MAPA
labels and official IGN names are both retained for review.

The GML explicitly uses EPSG:4258 with latitude/longitude axis order. The script
decodes that order, transforms ETRS89 to WGS84 using pyproj with `always_xy=True`
and writes GeoJSON longitude/latitude. It rejects unexpected CRS, counts,
source feature identity, malformed rings and invalid original geometry.

## Precision and point audit

All 50 original geometries were valid. Each is simplified with GEOS/Shapely
`preserve_topology=True`, tolerance **0.0001 degree**, then coordinates are
rounded to six decimal places and validity is checked again. No `buffer(0)`,
`make_valid` or other geometry repair is performed. The released polygons
contain 273,284 vertices. This is generalized lookup geography, not a cadastral
survey or field-area measurement; a field at the simplified administrative
edge may require a more precise boundary check.

The audit retains original/released ellipsoidal areas, vertex counts and
validity per province. The maximum absolute area-change fraction is
`0.00002225319976223826`, or **0.00222532%**, below the release's explicit 0.1%
limit. Area is calculated with the WGS84 ellipsoid and consistently oriented
exterior/interior rings. The simplification tolerance is an angular setting,
not a claim of uniform metre accuracy at every latitude.

Every fixed NASA POWER point is inside both its original IGN polygon and the
released simplified polygon. All **50 coordinate pairs are unchanged**. The
points were originally selected once using the earlier GISCO geometry; they
are retained as fixed sampling sites, not relabelled as IGN-derived centroids
or crop-area averages. Their historical definition remains in `point_provenance`.

## Separate selection from training support

`agronomy/province_inputs/registry.json` now uses the IGN polygons, with the
unchanged monthly NASA archive and its original SHA-256. Provincial model
bundles must be released again because geography identity contributes to their
version fingerprint. The source labels, monthly weather, calendar scenarios,
sampling coordinates and feature values do not change. The model release
records the actual comparison against the earlier estimators.

ES112 is the original CY-Bench Lugo statistical unit. Its runtime selection
polygon now uses official IGN **province 27, Lugo**, with its own source/hash
and precision audit. This is an independent administrative selection boundary;
it is not a claim that CY-Bench's historical crop-mask weather was reaggregated
with IGN. The original ES112 model region, daily weather, soil, calendar,
availability dates and source hashes remain unchanged. The earlier source
polygon/GISCO comparison remains under `historicalCybenchBoundary` as historical
verification, without redistributing that polygon as current selection geometry.

## Reproduce or review a new release

From the repository root:

```bash
.venv-api/bin/python -m pip install -r yield_prediction/requirements-geography.txt
.venv-api/bin/python yield_prediction/prepare_ign_geography.py --input .data/license-audit/ign-au-provinces-2026-11-15.gml
.venv-api/bin/python yield_prediction/prepare_ign_geography.py --input .data/license-audit/ign-au-provinces-2026-11-15.gml --publish
```

`--download` retrieves the official filtered WFS response into `--input`, using
system `curl` with certificate verification and bounded time/response size. It
writes a local receipt with the actual UTC access time, source URL and response
hash. This script intentionally releases only the reviewed 15 November 2026
snapshot: a later download is refused rather than assigned a backdated access
date. The known original byte hash retains its reviewed access date; another
response requires its matching actual-date receipt and a new reviewed release
if collected after that date.
The feature-set semantic checksum binds all 53 complete source features after
XML canonicalization; only the WFS envelope's changing request timestamp is
outside that semantic identity. A changed feature set fails before publishing.
The exact response byte hash is always recorded too. A freshly downloaded
response can therefore have a new byte hash and requires a new model/source
release even when the canonical geometries match. Keep the original source GML
if exact byte-for-byte reproduction of this release is required.

Run this geography preparation **after** restoring the legacy CY-Bench regional
release, whose original reproduction script necessarily documents the old
source geography. Then retrain the twenty provincial models and publish their
new versions using the frozen weather snapshot as described in
[the model guide](province_models.md). Do not patch a model's sidecar hash while
leaving incompatible provenance inside its joblib bundle.

The actual source/point/area and Zaragoza/Lugo lookup checks run with:

```bash
.venv-api/bin/python -m unittest agronomy.tests.test_ign_geography -v
```
