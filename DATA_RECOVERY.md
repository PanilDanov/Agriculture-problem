# Restore orbitFarm on another computer

The integrated checkout includes the frontend, field API, regional models and ten national models. Run `python3 scripts/orbitFarm-local.py setup` and `python3 scripts/orbitFarm-local.py run` from this checkout. The rest of this guide records how to restore the earlier separate branches and source datasets. The existing public deployment may predate the integrated changes. [orbitFarm](https://orbitfarm.vercel.app/)

The ten national models include a compact, checksum-addressed filtered FAOSTAT source snapshot and reproducible training script. Copy or regenerate regional caches and downloaded AgERA5 data using the documented source pipeline; they are not replaced with point weather. CDS credentials belong in the user's private `.cdsapirc` or environment variables and must not be copied into the repository.

## Get the source code

Run these commands from a new parent folder with Git installed. The sibling folder names match the default path used by the release script.

```bash
git clone --single-branch --branch feature/yield-prediction https://github.com/PanilDanov/Agriculture-problem.git Agriculture-problem
git clone --single-branch --branch frontend https://github.com/PanilDanov/Agriculture-problem.git orbitfarm-frontend
```

To update existing copies that are already on their corresponding branches, run `git -C Agriculture-problem pull --ff-only` and `git -C orbitfarm-frontend pull --ff-only` from the parent folder.

## Run the field analysis locally

Use Python 3.11 and Node.js 22.12 or newer. From `Agriculture-problem`, set up the field API in PowerShell.

```powershell
py -3.11 -m venv yield_prediction/data/processed/field_context/.venv
$fieldPython = "yield_prediction/data/processed/field_context/.venv/Scripts/python.exe"
& $fieldPython -m pip install -r agronomy/requirements-api.txt
& $fieldPython -m uvicorn agronomy.api:app --host 127.0.0.1 --port 8000
```

On macOS and Linux, create the same environment with `python3.11 -m venv` and run its `bin/python` with the same options. In a second terminal, open `orbitfarm-frontend` and start the frontend.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/#/lab`, enter `http://localhost:8000` under **API base URL**, and select **Use API**. Create a farm, enter a boundary, and select **Analyze my farm**. The API retrieves field observations as needed and returns the Save water and Improve soil plans. Follow the deployment guide to build the combined Vercel release. [API and example request](agronomy/analysis-api.md) · [Vercel release guide](https://github.com/PanilDanov/Agriculture-problem/blob/frontend/docs/orbitFarm-deployment.md)

## Restore field and calendar data

The field API fetches data using the checked-in source configuration. The sources include the NASA POWER daily API, SoilGrids WCS GeoTIFFs, Natural Earth boundaries, FAO regional calendars, and the Sacks and GGCMI NetCDF files. Generate a sample and populate the local source cache from the backend repository root.

```powershell
& $fieldPython -m agronomy.field_context agronomy/example_field.geojson --start 2024-09-01 --end 2024-09-07 --output yield_prediction/data/processed/field_context/example.json
```

To repeat the six-country validation, follow the [CropHarvest validation commands](agronomy/field-data-validation.md#reproduce-the-check). They download the pinned boundary file and document its SHA-256. Each collector result records the source URL, retrieval time, response hash, and cache filename for traceability. [Field sources and coverage](agronomy/field-data.md) · [Source settings](agronomy/field_sources.json)

To replay the exact provider responses from another machine, copy its `yield_prediction/data/processed/field_context/cache/` and any separate cache used by the run. Pass `--offline --cache-dir <copied-cache>` to the collector, or set `ORBITFARM_OFFLINE=1` and `ORBITFARM_CACHE_DIR` for the API. Online retrieval can reflect later provider revisions.

The audited ten-crop CSV and crop profiles come with Git. The original team workbooks and point export are archived in `yield_prediction/data/raw/team/` on the machine that recovered them. Copy these originals from that checkout or the team archive when repeating the source audit. The audit lists filenames and SHA-256 fingerprints. [Team source inventory](agronomy/data-audit.md#review-of-the-team-data)

## Restore the wheat and maize datasets

Git includes the four regional model artifacts and sample prediction inputs. Run the sample below to check the installation and prepare a small public dataset. Use a separate Python 3.11 environment for the yield module and work from `Agriculture-problem/yield_prediction`.

```powershell
py -3.11 -m venv .venv
$yieldPython = ".venv/Scripts/python.exe"
& $yieldPython -m pip install -r requirements-train.txt
& $yieldPython -m pip install -e .
& $yieldPython predict_example.py --crop wheat --mode mid_season
& $yieldPython download_data.py sample
& $yieldPython prepare_data.py --source sample
```

On macOS and Linux, the corresponding interpreter is `.venv/bin/python`. Run the reference-data commands from the same directory to restore the original country selection from CY-Bench 1.10 and regenerate the corrected feature table.

```powershell
& $yieldPython download_data.py zenodo --max-span-mib 1400
& $yieldPython prepare_data.py --source zenodo --output data/processed/continuation/reference_corrected.csv
```

The downloader requests selected crop and country files from the pinned archive. If partial downloads fail, download the complete `cybench-data.zip` from Zenodo and pass that file to `prepare_data.py --input` to prepare the full archive. Use the selected-group commands above for the reference experiment. The expected reference table has 40,618 regional observations. The generated JSON manifest lists the input hashes and the prepared CSV hash. [CY-Bench 1.10](https://zenodo.org/records/17279151) · [Yield model guide](yield_prediction/README.md)

Follow the [external validation reproduction commands](yield_prediction/reports/external_validation.md#reproduction) to restore the ten independent CY-Bench bundles, Brazil's IBGE SIDRA labels, and the corrected mid-season candidate models. The report records results and the reference CSV checksums. The source archive and model configuration determine whether results match those reports.

## Files stored outside Git

Generated source caches, downloads, prepared training tables, and experiment outputs use `yield_prediction/data/raw/` and `yield_prediction/data/processed/`. Copy those directories when migrating a completed run or recreate the public inputs using the commands above. Browser-created farms, layouts, and journals are stored in browser local storage for each origin and profile.
