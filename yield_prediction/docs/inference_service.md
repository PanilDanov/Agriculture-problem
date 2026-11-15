# Yield inference service

The field API and inference process run in separate environments. The released
estimators require Python 3.11 and the exact library versions in
`requirements.txt`. The field API uses a newer NumPy/Pandas stack. Installing
both sets into one environment is unsupported.

From the repository root:

```bash
python3.11 -m venv .venv-ml
.venv-ml/bin/python -m pip install './yield_prediction[candidates]'
.venv-ml/bin/python -m yield_prediction.service --host 127.0.0.1 --port 8001
```

On Windows, use `.venv-ml/Scripts/python.exe`. Linux containers need the OpenMP
runtime (`libgomp1` on Debian/Ubuntu). On Apple Silicon macOS, the optional
checksum-pinned local installer avoids changing any system directories:

```bash
.venv-ml/bin/python yield_prediction/install_native.py
export ORBITFARM_NATIVE_LIB_DIR="$PWD/.runtime/native"
.venv-ml/bin/python -m yield_prediction.service --port 8001
```

The installer retains the conda-forge LLVM OpenMP license and archive/library
SHA-256 values. It verifies TLS through the system `curl` and verifies the pinned
archive hash before extracting the library. Standard Homebrew `libomp` is also
supported by the upstream native libraries. The source of the local package is
recorded in `install_native.py`.

Configure the field API with `ORBITFARM_ML_URL=http://127.0.0.1:8001`. If
`ORBITFARM_ML_TOKEN` is set, prediction requests must include
`Authorization: Bearer <token>`. Keep the process bound to its private interface
or internal container network. Model features and observations are not logged.

## Health and readiness

- `GET /health` returns 200 while the process runs.
- `GET /ready` verifies hashes, pinned dependency versions and native loading for
  all eight crop-mask artifacts, ten national models and twenty experimental
  NASA/MAPA provincial models. It returns
  200 only when all models are ready, otherwise 503 with per-model diagnostics.
- `python -m yield_prediction.service --check` performs the same check and exits
  nonzero when a model is unavailable.

A health response alone does not establish that model inference works.

## Single forecast

`POST /v1/yield` accepts `crop`, optional `mode`, and exactly one input object:

| Input | Purpose |
| --- | --- |
| `environmentalInput` | The versioned regional daily input contract. Its source, spatial aggregation, calendar and data coverage are validated by `build_model_features()`. |
| `features` | Already prepared regional seasonal features. The service checks their schema, dates and ranges, but cannot verify the upstream spatial aggregation. This input is labelled client supplied. |
| `nationalInput` | `{countryCode, harvestYear?, asOf?}` for annual country yield-history forecasts across ten crops. The only mode for this input is `annual_history`. |
| `provinceInput` | An audited Spanish INE province, target year, current archive date and provenance-bearing NASA monthly representative-point weather; experimental `pre_season` / `mid_season` models. See [provincial models](province_models.md). |

Example national request:

```json
{
  "crop": "barley",
  "mode": "annual_history",
  "nationalInput": {"countryCode": "US", "asOf": "2026-11-15", "harvestYear": 2027}
}
```

Regional `crop` is `maize` or `wheat`, and its modes are `pre_season`,
`mid_season`, `cold_start_pre_season`, and `mid_season_v2`. Candidate modes are
marked experimental. Point NASA POWER data cannot be labelled AgERA5 or passed
off as a crop-mask regional observation. NASA continues to support the separate
field weather, suitability and water assessments.

Success is HTTP 200:

```json
{
  "status": "ready",
  "forecast": {"predicted_yield_t_ha": 0.0, "spatial_level": "country"},
  "diagnostics": {"inputKind": "nationalInput", "usesCurrentSeasonWeather": false}
}
```

The displayed zero above illustrates the response shape, not a model result.
Actual responses include the model version, source and data dates, warnings and
an input SHA-256. National annual history does not provide a current-weather
mid-season update. A country estimate does not establish individual-field
accuracy. Missing data never becomes a synthetic numeric forecast.

`forecast_date` is the nominal scenario issue date, while `calculated_at` is the
actual UTC execution timestamp. If the nominal date precedes the execution
date, `is_replay` is true and `temporal_status` is `retrospective_estimate`.
These historical replays are not evidence that a forecast was issued in the
past. Diagnostics repeat these fields in camelCase. Regional `inputAsOf`
records input preparation; `dataThrough` retains the last observation actually
used by the model. The bundled Lugo 2026 release consequently has January/April
scenario dates, a current calculation timestamp and a 2023 climate-data cutoff.

Invalid input returns 422; malformed JSON returns 400; excessive bodies return
413; missing dependencies or model artifacts return 503. Errors contain
`status`, `code`, `message` and optional diagnostics. The default body limit is
4 MiB, body reads time out after 15 seconds, and at most four inference requests
execute concurrently. Busy workers return 503 for a controlled retry.

## Batch forecast

`POST /v1/yields` accepts `{requests: [<single forecast request>, ...]}` with
1–20 requests. It returns `{status: "ready" | "partial", results: [...]}`.
Every result contains its `crop`; individual failures remain structured and do
not remove valid forecasts for other crops. The field API uses this route for
the ten-crop comparison.

## Verification

```bash
cd yield_prediction
ORBITFARM_NATIVE_LIB_DIR="$PWD/../.runtime/native" ../.venv-ml/bin/python -m pytest -q
```

The service tests exercise real HTTP requests, actual saved model forecasts,
native dependencies, malformed/ambiguous inputs, batch association, token and
concurrency limits, and incompatible weather sources. The original model tests
check temporal leakage, crop/region identity, frozen yield history and units.
Real-data reconstruction tests require the pinned CY-Bench sample archive.
