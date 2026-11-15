# Published regional data installed with the application

The application includes a real pre-season 2026 input release for **ES112,
Lugo, Spain**, for maize and wheat. The field boundary must fit wholly inside
the matched region, and the request must select harvest year 2026. Geometry,
daily observations, crop calendars and static soil come from the same official
[CY-Bench 1.10 release](https://zenodo.org/records/17279151). No NASA point or
unrelated example is substituted for this regional data.

## Availability and scope

The source record was published October 6, 2025 and last updated December 19,
2025. The input assigns the conservative **December 19, 2025 availability date**
to this frozen snapshot. Both 2026 pre-season issue dates follow that date.
The later GitHub sample commit was published April 16, 2026, so its publication
date is deliberately not used to claim availability at January/early-April
issue dates. The preparation command instead reads the original Zenodo tables
and verifies their SHA-256 values and member CRCs.

The regional weather archive ends in 2023. Five eligible completed seasons,
**2019-2023**, provide pre-season climatology within the model's seven-year
lookback. This is not an assertion that 2026 mid-season weather is available.
The current calendar is the recurring static crop-mask calendar supplied by
CY-Bench, not a measured 2026 planting date. The response preserves data cutoff,
issue date, model version, frozen-history warnings and regional scale.

Requests calculated after the nominal issue date are explicitly **historical
replays** (`is_replay: true`, `temporal_status: retrospective_estimate`). The
`forecast_date` is the calendar-defined scenario date; `calculated_at` records
when the service actually ran. These estimates are not evidence that the model
issued a forecast in January or April 2026. `inputAsOf` describes the prepared
input snapshot and must not replace the actual 2023 climatology cutoff.

| Crop | Pre-season issue date | Latest climatology observation | Reference prediction, t/ha |
| --- | --- | --- | ---: |
| Maize | 2026-04-14 | 2023-10-28 | 7.142389983443048 |
| Wheat | 2026-01-22 | 2023-07-08 | 2.3605019775066585 |

These saved values are regression references. The running application calls the
actual estimator again; it does not return a stored reference prediction.
Field-level accuracy and a calibrated uncertainty interval remain unverified.

## Boundary audit and attribution

The original `polygons.zip` file has publisher MD5
`815d0e94f6746f15febb99b627142a04`. Its ES shapefile declares WGS84 and the exact
`adm_id=ES112`. The geometry is checked against the official GISCO **NUTS 2016,
03M, EPSG:4326** region, whose name is Lugo. Normalized geometries agree within
1e-6 degrees, accounting for the original shapefile's coordinate rounding.
The measured Hausdorff difference is about 6.47e-7 degrees. The verified region
identifier is retained in the same model/data namespace; no NUTS 2021 crosswalk
is invented. The source map is generalized statistical geography, not a survey
of a field boundary.

**© EuroGeographics for the administrative boundaries.**

Source and license references:

- [CY-Bench release and attribution](https://zenodo.org/records/17279151).
- [CY-Bench GISCO boundary documentation](https://github.com/WUR-AI/AgML-CY-Bench/blob/main/data_preparation/shapefiles_EU/README.md).
- [Official GISCO NUTS reference geography](https://ec.europa.eu/eurostat/web/gisco/geodata/reference-data/administrative-units-statistical-units/nuts).

Retain the boundary attribution when displaying the regional geography. Review
the source's reuse terms for the intended deployment. The crop statistics also
require the CY-Bench/JRC citations described in the original release.

## Reproduce the release

In the pinned Python 3.11 environment:

```bash
python -m pip install './yield_prediction[candidates,regional-data]'
python yield_prediction/prepare_published_region.py --download --harvest-year 2026 --as-of 2026-11-15
```

The original ES crop bundles are downloaded by verified byte ranges (about
32 MiB), and the exact published polygon ZIP is about 105 MB. The full 6.2 GB
weather archive is not downloaded. Reviewed source checksums reject changed
tables or boundaries before writing an operational registry.

The command writes `agronomy/regional_inputs/registry.json`, two raw daily-input
files and `source_provenance.json`. These compact release files are included in
the checkout and API/container/Vercel packages, so operational inference does
not need to redownload source archives. The original source ZIPs remain under
ignored data/cache directories. An explicit `ORBITFARM_REGIONAL_INPUT_DIR` can
select another audited registry without changing the bundled release.

The illustrative field in `deployment/smoke-regional-field.json` lies completely
inside this region. A `pre_season`, 2026 analysis returns two regional forecasts.
Mid-season or other-region/year requests remain unavailable unless compatible
datasets for those requests have been installed. Automatic mode may choose the
separately labelled national history models when regional coverage is absent.
