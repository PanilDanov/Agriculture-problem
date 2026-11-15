# Experimental provincial forecasts with NASA monthly weather

This release adds a separate model family for the ten product crops and both
`pre_season` and `mid_season`. Its geography is an audited Spanish INE province.
It uses MAPA statistical production per reported hectare, MAPA monthly crop
calendars and NASA POWER monthly observations at a fixed interior representative
point. The point is not a crop-mask or province-wide weather average. This
family neither modifies nor supplies NASA point values to the CY-Bench models.

Coverage depends on real positive annual crop statistics, five consecutive
preceding yields, a complete published monthly calendar and complete historical
weather. An unsupported province/crop remains unavailable. Country models and
crop-mask models keep their separate geography and input contracts.

## Features and temporal cutoffs

For nine crops the target is `production_t / reported_area_ha`. Source rows preserve their
reported area definition; older and newer table definitions differ. The target
therefore cannot establish a uniform individual-field harvested-area yield.
Tomato labels instead use area-weighted official rainfed and open-irrigated
kg/ha yields, converted to t/ha; protected cultivation is excluded. Its published
monthly calendar still mixes open-field and protected systems, which remains
an explicit timing limitation.

The model takes five log-transformed preceding observed yields, their means,
variation and trend, the age of the latest label, target year, province identity,
and five complete preceding seasons of monthly weather. Weather aggregation is:

- Temperature: sum of monthly mean temperature times days, divided by days.
- Precipitation: sum of monthly mean mm/day times days, producing mm/season.
- Radiation: sum of monthly mean MJ/m²/day times days, producing MJ/m²/season.
- Climatology: mean and standard deviation across five complete past seasons.

Pre-season inference excludes target-season weather. Mid-season inference adds
only complete target-season months ending at least 14 days before the nominal
calendar midpoint and before the input archive date. Future months, annual
NASA month `13`, fill values and incomplete months are not substituted.
The 14-day margin is a modelling policy, not a documented NASA release promise.

Dates are scenarios derived from the modal published sowing and harvest months:
first day of the sowing month, last day of the harvest month, previous sowing
year for winter crops, earliest month on a tie. Provincial marginal sowing and
harvest distributions are not matched crop cohorts or observed planting dates.
The calendar reference period is 2014–2016. A workbook's 2019 file properties
do not prove its publication date; unknown publication dates remain null and
actual retrieval supplies a conservative verified availability date.

Live inference uses labels no later than target year minus two. Winter
pre-season uses target year minus three. It neither invents a missing annual
yield nor silently uses the target yield. Older unsupported histories fail.
The audited 2004–2024 snapshot contains 8,885 targets and no explicit numeric
zero-yield cases with positive area. This version uses positive log targets;
the trainer explicitly rejects a future real zero label rather than dropping
it. Supporting such a new snapshot requires a versioned nonnegative target
transform and a repeated evaluation.

## Training and validation

The trainer creates explicitly retrospective label-age 1, 2 and 3 cases to
expose stale-history behaviour. All versions of the same harvest year stay in
the same temporal partition. The last three usable harvest years form the
untouched final holdout; two earlier years select among scaled Ridge models
and histogram gradient boosting. The baseline is the latest observed yield
available to each case. The final serving model is refitted using the complete
frozen data after the evaluation is recorded.

The report preserves overall metrics, separate label-age metrics and metrics
matching the conservative inference policy. A failure to beat the baseline
remains explicit. Every model is experimental, including those that beat it.
Retrospective revised source snapshots do not reconstruct publication-time
availability. Historical scenario dates are labelled replays and remain
separate from the actual calculation timestamp. No calibrated prediction
interval or field-level validation is claimed.

For the frozen 2026 scenarios, all twenty crop/mode combinations have actual
coverage in **Ciudad Real (13), Granada (18), Huesca (22), Lleida (25),
Tarragona (43) and Zaragoza (50)**. Coverage elsewhere varies by crop and mode;
this is not a promise of complete Spanish or worldwide coverage.

Thirteen models beat the last-observed-yield baseline in both the aggregate
holdout and the conservative label-age policy check. Seven do not pass every
check: wheat pre-season, maize mid-season, both sorghum modes, sunflower
pre-season and both tomato modes. Each response includes both checks, so a
better policy-specific error must not be described as a failure of that
particular check. All twenty remain experimental.

`artifacts/provincial/evaluation.json` preserves the complete errors, baseline
errors, model selection, source/code hashes and actual current coverage.

## Reproduction and HTTP contract

Actual source archives are extracted by `extract_mapa_calendars.py` and the
MAPA provincial label ingester. Verified GISCO geometry and source coordinates
are recorded in `artifacts/provincial/provinces.json`. Collect weather with
`scripts/orbitFarm-province-weather.py` using the separate API environment.
Then, in the pinned Python 3.11 ML environment:

```bash
PYTHONPATH=yield_prediction/src .venv-ml/bin/python yield_prediction/train_province.py
```

The trainer writes twenty separate `.joblib` models and SHA-256 manifests to
`src/yield_prediction/province_models`, plus the temporal evaluation report.
Existing national, candidate and CY-Bench artifacts are preserved.

The default command uses the tracked, SHA-256-verified
`agronomy/province_inputs/weather.json.gz` and its frozen registry date, so
retraining needs no private `.data` directory or network download. For a newly
collected snapshot, pass `--weather /path/to/monthly-directory --as-of YYYY-MM-DD`.
Canonical normalized weather JSON and trainer/feature-code hashes enter the
model version. A test retrains actual barley models from the portable snapshot
in a temporary directory and compares their complete artifact hashes.

`POST /v1/yield` accepts exactly one input kind. For this family:

```json
{
  "crop": "barley",
  "mode": "mid_season",
  "provinceInput": {
    "countryCode": "ES",
    "regionId": "02",
    "harvestYear": 2026,
    "asOf": "2026-11-15",
    "weather": "the normalized, provenance-bearing NASA monthly object"
  }
}
```

The string above denotes an object, not a valid operational weather value.
The weather object includes product, version, LST time standard, representative
point support and coordinates, actual monthly observations and source URL,
retrieval timestamp and response SHA-256. Coordinates must match the trusted
model manifest. Calendars, histories and province identity come from the frozen
model bundle, not client-supplied arbitrary features.

Responses preserve `spatial_level: administrative_region`,
`weather_support: representative_point`, `release_status: experimental`, crop,
province, target year, model hash/version, scenario and calculation dates,
weather and label cutoffs, age, validation metrics and source provenance.
Diagnostics additionally say `weatherSupport: point_proxy` and
`availabilityInterpretation: retrospective_observation_cutoff`.
