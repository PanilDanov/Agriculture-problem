# Regional yield forecast data contract

Version 1.0. Regional ML accepts one crop, one harvest season and one administrative region. Supported crops are `maize` and `wheat`. Estimates in t/ha refer to the administrative unit and carry `spatial_level: "administrative_region"`. Individual-field yield accuracy has not been validated.

## Schema A: Raw Environmental Input

[JSON Schema](../src/yield_prediction/schemas/raw_environmental_input.schema.json) · [Structural example](examples/raw_synthetic.json) · [Annual-input rejection example](examples/annual_unsupported.json).

| Field | Requirement |
| --- | --- |
| `schema_version`, `as_of`, `harvest_year` | Required: version `"1.0"`, actual data cutoff as YYYY-MM-DD, and the year in which the target season ends. |
| `region` | Required: `aggregation`, `match`, boundary source and version. `cybench_verified` requires `country_code` and the exact `adm_id`. These identifiers may be absent for `unmapped`. Optional WGS84 latitude/longitude describe the region centroid. |
| `calendar` | Required source and `seasons` list. Each harvest year needs `start`, `end` and `available_on`. Supply one season per year with inclusive boundaries; a season may begin in the preceding year. |
| `weather` | Required product, version, `time_standard`, all parameter units and daily observations. Accepted products are `AgERA5` 2.0 and `CY-Bench AgERA5` 1.10, aggregated over the administrative region and crop mask with documented `LST` days. |
| `weather.observations[]` | `date`, actual `available_on`, `tmin`, `tavg`, `tmax`, `prec`, `rad`, `et0`, `vpd` and `cwb`. Missing measurements remain JSON `null`. Duplicate dates and publication before observation are rejected. |
| `soil` | Optional source, version and `available_on`. `CY-Bench WISE` supports `awc` in `CY-Bench WISE` units and `bulk_density` in kg/dm³. Leave these predictors absent for incompatible products. |

Each source block may contain `source_reference` and `artifact_sha256`. The data cutoff must reach the forecast issue date: the calendar day before the season starts for `pre_season`/`cold_start_pre_season`, or `start + floor((end - start) / 2)` days for `mid_season`/`mid_season_v2`. The current calendar must have been known by the pre-season issue date. Overlapping seasons are rejected.

Climatology uses up to five latest eligible completed seasons from the preceding seven harvest years, with at least two seasons required. Their calendar boundaries must have been known before the pre-season issue date. Weather must be at least 14 days old at issue, and its `available_on` date must have elapsed. Climatology remains fixed at the pre-season cutoff even for mid-season forecasts. Current-season weather spans season start through midpoint minus 14 days, inclusive. A complete day contains eight weather values. Each window needs at least 95% complete days; mid-season additionally requires at least 10 expected days. Late observations are excluded and counted in diagnostics. Unknown publication dates cannot be asserted to have been available.

## Schema B: Model Features

[JSON Schema](../src/yield_prediction/schemas/model_features.schema.json) · [Converted example](examples/model_features_synthetic.json) · [Real CY-Bench examples](../artifacts/examples) · [Formulas and units](feature_mapping.md).

Install all experimental estimator dependencies from `yield_prediction` with `python -m pip install ".[candidates]"`.

Required inputs are `country_code`, seasonal dates, harvest year, season length, historical aggregates, historical season count and `climate_through`. Standard modes require `adm_id`; cold-start permits its absence. Unknown-country cold-start uses `ZZ` only as metadata. Mid-season also requires all `mid_*` values, the latest accepted weather date and coverage. `awc`, `bulk_density` and coordinates may be `null`. Frozen yield history is read from the model artifact using a verified key; this input schema has no field for target yield labels.

```python
from yield_prediction import build_model_features, predict_yield

prepared = build_model_features(environment, "maize", "pre_season")
if prepared["status"] == "ready":
    result = predict_yield(prepared["features"], "maize", prepared["recommended_mode"])
else:
    diagnostics = prepared["diagnostics"]
```

The adapter returns `ready` or `rejected`, features or `null`, requested/recommended modes, and available issue-date, coverage and diagnostic fields. Cold-start `ready` establishes format compatibility and the possibility of experimental inference. Mid-season without verified regional history is rejected with a suggestion to issue a separate pre-season request. Insufficient weather is rejected. Missing soil moisture does not affect these models; incompatible or absent static soil uses the documented imputation. Annual CSVs, point inputs, invalid units, missing dates and inadequate coverage produce diagnostic rejection.

## Spatial mapping

1. Normalize WGS84 geometry and intersect it with administrative polygons at the yield-statistics level. Point-in-polygon must detect ambiguity; polygon matching retains intersection fractions. Boundary-straddling or multi-region fields require explicit selection or separate regional estimates.
2. Existing countries use CY-Bench 1.10 polygons and IDs. New regions may use versioned official boundaries at the published yield-statistics level. Version changes require a verified crosswalk or spatial intersection. Natural Earth Admin 0 can identify a candidate country; it cannot identify a NUTS unit, county, province or municipality. [CY-Bench polygons](https://zenodo.org/records/17279151).
3. Aggregate AgERA5 grid cells over the same administrative geometry and crop areas. Retain crop-mask version, weights, geometry and day convention with the source data. Matching a weather point to a region does not make its measurements a regional aggregate.
4. Unknown CY-Bench IDs use `unmapped` with a verifiable administrative boundary source. If regional aggregation is available the adapter can suggest cold-start; field/point geometry alone is insufficient. The adapter accepts the prepared mapping; the calling service retains the spatial evidence.

## Data engineering tasks

1. Preserve a daily export alongside the annual table, including ISO dates, day convention, original/normalized units, product version, earliest publication date and source links/hashes. Download time for a current revision does not prove historical availability.
2. Add a regional AgERA5/CY-Bench input stream containing Tmin/Tavg/Tmax, precipitation, radiation, reference ET₀, VPD at Tmax and CWB. NASA POWER remains part of field weather and water assessments. Replacing the training weather product requires paired evaluation on common regions and seasons.
3. Export the selected production calendar for each year, including seasons crossing December 31. Distinguish harvest dates from reporting years. Live-horizon forecasts also need archived yield-publication dates to replace the current July 1 next-year proxy.
4. Include soil depth, units and source. Volumetric moisture, pH, SOC and texture do not substitute for `awc` or `bulk_density`. Leave incompatible WISE predictors unknown.
5. Preserve coverage and geometry-mapping diagnostics. Field-level expansion needs observed field yields, management predictors and independent field validation. Cold-start remains a pilot. [Field collection](../../agronomy/field-data.md) · [Field analysis contract](../../agronomy/analysis-api.md).
