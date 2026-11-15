# Copernicus AgERA5: secure setup and verified regional inputs

The field analysis continues to use NASA POWER. This pipeline adds the separate regional AgERA5 inputs required by the existing wheat/maize yield models. It never substitutes a field point, national average, or unrelated example for a regional crop-mask aggregate.

## Account and local token

1. Register or sign in at the [Copernicus Climate Data Store](https://cds.climate.copernicus.eu/).
2. On the [AgERA5 download page](https://cds.climate.copernicus.eu/datasets/sis-agrometeorological-indicators?tab=download), manually accept the **CC-BY licence**. An authenticated account still receives HTTP 403 until the required dataset licence is accepted.
3. Obtain the Personal Access Token from the [CDS API setup page](https://cds.climate.copernicus.eu/how-to-api).
4. From the repository root, run:

```bash
python3 scripts/orbitFarm-copernicus.py configure
python3 scripts/orbitFarm-copernicus.py status
```

`configure` prompts using hidden `getpass` input and writes the official URL/token format to `~/.cdsapirc` with mode **0600**. The token is not a command argument, printed result, project file or Git artifact. Existing configuration is replaced only with the explicit `--replace` flag. Do not paste a token into an issue, README or command line. Configure/status use only the Python standard library and work before scientific dependencies are installed.

Status reports configuration and SDK availability for the interpreter that runs it. It does not claim to verify the account or licence remotely. The complete application setup installs the downloader into `.venv-api`. If that setup was skipped, install it into the same environment:

```bash
.venv-api/bin/python -m pip install -r agronomy/requirements-copernicus.txt
.venv-api/bin/python scripts/orbitFarm-copernicus.py status
```

The SDK requirement follows the [official CDS setup guide](https://cds.climate.copernicus.eu/how-to-api): `cdsapi>=0.7.7`.

## Bounded daily NetCDF downloads

The current gridded CDS form was checked on November 15, 2026 through its [official catalogue/form metadata](https://cds.climate.copernicus.eu/api/catalogue/v1/collections/sis-agrometeorological-indicators). The dataset ID is `sis-agrometeorological-indicators`, version `2_0`. Requests use:

- `2m_temperature` with `24_hour_minimum`, `24_hour_mean`, `24_hour_maximum`;
- `precipitation_flux`;
- `solar_radiation_flux`;
- `reference_evapotranspiration`;
- `vapour_pressure_deficit_at_maximum_temperature`.

Climatic water balance is derived from compatible daily precipitation minus reference ET0. Source temperature is in K, radiation in J/m2/day, precipitation/ET0 in mm/day and VPD in hPa. The source daily convention is local time, recorded as LST; it is not silently replaced with UTC.

Preview requests without a token or a download:

```bash
python3 scripts/orbitFarm-copernicus.py plan \
  --start 2025-01-01 --end 2025-01-01 --area 31.1 30.9 30.9 31.1
```

Download a small actual source check after accepting the licence:

```bash
.venv-api/bin/python scripts/orbitFarm-copernicus.py download \
  --start 2025-01-01 --end 2025-01-01 --area 31.1 30.9 30.9 31.1 \
  --directory .data/copernicus-smoke-egypt --max-jobs 5
```

The area order is **north, west, south, east**. This small bbox is a source connectivity check, not an installed regional ML dataset. Production requests must cover the complete administrative region and its crop mask. Each month needs five bounded requests; valid calendar days are selected, including leap days. The tool rejects global/dateline boxes, spans above 30 degrees, intervals above eight years, and dates newer than the conservative 14-day cutoff. A maximum of ten uncached jobs runs per invocation by default. Rerun to resume; files with matching request/hash metadata are reused. CDS queue time is external and is not an interactive API request deadline.

Downloads must be ZIP archives containing NetCDF. CRCs and SHA-256 are checked, files are published atomically, and manifests record exact requests, product/version, source, hash and actual retrieval date. Provider exceptions are reported without dumping authenticated headers or credentials.

## Regional boundary, crop mask and calendar

Installing a regional input requires a source-reviewed JSON manifest with:

- `countryCode`: ISO2 and `regionId`: the verified CY-Bench administrative key;
- `boundary`: complete valid administrative WGS84 Polygon/MultiPolygon, `boundarySource`, `boundaryVersion`, `crosswalkSource`, and `crosswalkVerified: true` only after the source crosswalk has been checked;
- `cropMask`: `cropId`, `path` to a GeoTIFF, its `sha256`, `source`, `version`, and `unit` (`m2` or `ha` harvested area per source pixel);
- `calendar`: the raw model contract's source and dated `seasons` for the target year and historical years, including actual `available_on` metadata;
- optional compatible WISE `soil` in the raw model contract's units. SoilGrids pH or a point water balance must not be called WISE AWC.

The cropped harvested-area mask is summed onto the AgERA5 grid. Source pixels whose centers fall inside the administrative geometry contribute to the weights; this boundary approximation is explicitly recorded. Each weather mean is weighted by harvested area and requires at least 95% valid crop-area weight. At least two meteorological cells are required; a point does not become regional by relabeling it. Unit mismatches, wrong product versions, overlapping/duplicated weather and corrupt files are rejected.

## Availability and installation

An observation date is not a publication date. By default, the pipeline uses the **actual successful retrieval date** as the date on which a downloaded value is known to be available. Reusing a cache preserves its recorded retrieval date. An optional audited `--availability-ledger` can supply source-supported first-availability dates; these must never be guessed to force a historical forecast to work.

Consequently, downloading a historical archive today does not prove it was available before an old forecast date. The installer rejects fewer than two eligible historical seasons with 95% complete weather, unavailable calendars, future issue dates, and inadequate mid-season observations. Mid-season requires at least ten expected days and 95% complete weather through the calendar midpoint minus 14 days. A new deployment may need an audited availability archive or to accumulate observations for a future issue date.

```bash
.venv-api/bin/python scripts/orbitFarm-copernicus.py install \
  --directory .data/copernicus-region \
  --region-manifest /absolute/path/to/reviewed-region.json \
  --crop wheat --harvest-year 2026 --mode mid_season \
  --regional-directory .data/regional \
  --availability-ledger /absolute/path/to/audited-availability.json
```

The output is a validated raw model input with source/weighting provenance, plus an atomic `registry.json` compatible with `RegionalInputStore`. The model service subsequently performs its own raw-adapter, schema, geographic-history, runtime and artifact checks. Unsupported data do not produce a numeric regional forecast. All ten national annual-history models remain a separate explicitly labeled path.

## Checks and current live status

Unit checks cover hidden/private token storage, leap-day requests, bounded areas, unit conversion, crop-area weighting, missing spatial coverage, actual NetCDF+GeoTIFF aggregation and refusal to backdate retrievals. Synthetic grids exist only in unit tests and are not installed as source data.

```bash
.venv-api/bin/python -m unittest agronomy.tests.test_copernicus -v
```

On November 15, 2026 the initial request returned HTTP 403 until the user manually accepted the dataset licence. The repeated real retrieval then completed all five requests for January 1, 2025 over the small Egypt bbox above. All seven required meteorological variables were opened from the actual NetCDF files and their units and CF dates verified. ET0 ranged from 1.796 to 1.864 mm/day and precipitation from 0.020 to 0.080 mm/day in the 2-by-2 grid. Hashes, sizes, variable names, units and values are recorded in [the live-source check](../yield_prediction/artifacts/copernicus/live-smoke-2026-11-15.json). It contains no credentials.

This proves account/licence access and actual source retrieval. It does not provide a complete historical regional ML dataset: a verified administrative crosswalk, real harvested-area crop mask, calendars, sufficient daily history and availability metadata are still required before installing an entry in the regional registry.
