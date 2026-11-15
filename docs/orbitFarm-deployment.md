# Run and deploy the complete orbitFarm application

The integrated checkout contains the website, NASA field API, crop assessments and all yield-model artifacts. The field API and ML process use **separate Python environments**: the field service supports Python 3.11/3.12, while the released ML package requires Python 3.11 and exact model-library versions. National annual-history forecasts cover all ten crops. Separate experimental NASA/MAPA models cover both seasonal modes for all ten crops in verified Spanish provinces. The original wheat/maize models retain their AgERA5 crop-mask contract.

## Local setup and run

Install Python 3.11 and Node.js 22.12 or newer; Node 24 LTS is recommended. An optional Python 3.12 can run the field API. No global Python package installation is needed.

```bash
python3 scripts/orbitFarm-local.py setup
python3 scripts/orbitFarm-local.py check
python3 scripts/orbitFarm-local.py run
```

The setup command creates `.venv-api` and `.venv-ml`, installs the frontend lockfile, Copernicus downloader and exact model dependencies, and verifies all 38 model artifacts. On Apple Silicon it installs a checksum-verified OpenMP library only under `.runtime/native`, retaining its license. Linux hosts need their native OpenMP runtime; the containers below install it explicitly. The launcher can use an official Node distribution already extracted under `.runtime/node-v*/` when the global Node is too old.

`run` builds the website with same-origin real API enabled, starts inference on port 8001 and serves the API plus built website at **http://127.0.0.1:8000**. It waits for actual model readiness and stops its own child processes on Ctrl+C. Use `--no-build` for an existing verified build, or `--reuse-ml` to connect to an already running inference service. Ports and optional service token are configurable through `.env`; copy `.env.example` to see supported settings. Shell environment values take precedence. Tokens are not printed.

Explicit interpreter and environment paths are supported:

```bash
python3 scripts/orbitFarm-local.py setup --ml-python /path/to/python3.11 --api-python /path/to/python3.12
python3 scripts/orbitFarm-local.py check --api-env /path/to/api-venv --ml-env /path/to/ml-venv
```

Windows can invoke the script with its installed Python interpreter and supply full interpreter paths when `python3.11` is not a command. The corresponding environment executables are under `Scripts/`. Native model dependencies must be available for that platform.

## Complete container deployment

Docker Compose builds the website and two independent services. The API image uses Python 3.12 plus Expat; the ML image uses Python 3.11, OpenMP and pinned regional/candidate/national model dependencies.

```bash
mkdir -p .runtime/regional-inputs
docker compose up --build --detach --wait --wait-timeout 120
curl --fail http://127.0.0.1:8000/ready
```

The website is available at **http://127.0.0.1:8000**. Only the API port is published to loopback; ML stays on the internal service network at `http://ml:8001`. A host reverse proxy can expose the website over HTTPS. Source responses persist in the named `field-cache` volume. The API image includes both the audited ES112 crop-mask registry and the 50-province NASA point archive. Crop, mode, year and history coverage remain explicit. National forecasts still operate where FAOSTAT country histories are available. Additional audited registries can be installed in a custom image or mounted with a Compose override and `ORBITFARM_REGIONAL_INPUT_DIR` or `ORBITFARM_PROVINCE_INPUT_DIR`.

Use `docker compose logs --follow` for diagnostics and `docker compose down` to stop the stack. Avoid deleting the cache volume when a source replay is needed. Source caches and regional datasets have separate provenance and data dates.

## Data and model readiness

`GET /health` checks process availability. **`GET /ready` checks the connected inference service and its actual model artifacts.** A successful health response alone does not establish model readiness.

The national models and filtered reproducible FAOSTAT source snapshot are included in Git. Country coverage differs by crop; absent production histories remain unavailable rather than borrowing another country's estimate. Source dates, versions, forecast horizon and experimental quality status are returned. See [national data and models](../yield_prediction/docs/national_models.md) for retraining and label units.

Regional models require daily AgERA5 aggregated over the correct administrative crop mask, a verified boundary/ID crosswalk, publication dates and eligible calendars. A real [ES112/Lugo 2026 pre-season release](../yield_prediction/docs/published_regional_inputs.md) for wheat and maize is included by default, using five published 2019-2023 seasons and original verified 2025 source availability. These estimates are explicitly historical replays: their January/April nominal forecast dates remain distinct from the actual calculation timestamp and 2023 climate cutoff. NASA POWER remains the real source for field weather, water and suitability assessments; a NASA point is never relabelled a regional AgERA5 aggregate. See [regional data contract](../yield_prediction/docs/data_engineer_contract.md) and [ML service contract](../yield_prediction/docs/inference_service.md).

Explicit `pre_season` and `mid_season` requests can additionally select the separate [NASA/MAPA province model family](../yield_prediction/docs/province_models.md). It uses fixed representative-point monthly weather, historical provincial statistics and modal-month calendar scenarios. All twenty models remain experimental; their metrics and baseline comparisons are returned. The original crop-mask model is preferred where its exact data are installed. Automatic mode retains the established crop-mask/national routing. No request outside verified province geometry borrows a neighbouring province's weather or labels.

`deployment/smoke-province-field.json` is an illustrative Zaragoza field for checking both seasonal modes for harvest 2026. Actual crop and year eligibility is checked again by the model. To update the NASA archive and publish verified inputs:

```bash
.venv-api/bin/python scripts/orbitFarm-province-weather.py
.venv-api/bin/python scripts/orbitFarm-publish-province-inputs.py
```

The frozen compressed weather release, filtered MAPA labels, calendar source records and model evaluation are included in Git. Reproducing the trained models uses that frozen release; downloading newer revised weather creates a new input snapshot.

## Verification before publishing

```bash
python -m unittest discover -s agronomy/tests -v
# In the separate ML environment, from yield_prediction:
python -m pytest -q
# From the repository root with Node 24:
npm run verify
```

The full ML tests use the real pinned CY-Bench sample; fetch it with `python yield_prediction/download_data.py sample`. The checked source ZIP SHA-256 is `0c84fd65f06acb3c7224f3fc512de83019dd97734506a5018b253ccbdba0d4ed`. This exercises the actual data preparation/training route rather than skipping it.

The deterministic cross-process check uses an explicitly identified weather test fixture and real ML inference:

```bash
# Start the ML service, then use the field API environment:
python scripts/orbitFarm-smoke-ml-stack.py --ml-url http://127.0.0.1:8001
```

The release smoke check additionally uses real external NASA/source retrieval for the illustrative Nile Delta polygon in `deployment/smoke-field.json`. It checks readiness, uncached HTML behavior, referenced assets, all ten crops, three plans and ten real country-model forecasts:

```bash
node scripts/orbitFarm-smoke-release.mjs https://your-deployment.example
```

## GitHub checks

The workflow tests the frontend, Python field API and all real ML artifacts/data independently. It then exercises HTTP inference through an isolated field API environment, builds both containers and checks their readiness and served website. The Vercel publishing job waits for these checks.

The integrated release uses the **current tested checkout** for both frontend and backend. It no longer packages the old pinned `7d36975` backend. Future release metadata records the current commit for both halves.

## Vercel website and field API

### Complete application on Vercel Container Runtime

The complete application was deployed and publicly checked at **https://orbitfarm.vercel.app** on November 15, 2026. It runs all 38 estimators, the field API and website in one cloud container. Both seasonal modes returned all ten real NASA/MAPA forecasts for the illustrative Zaragoza field. No separate server or running developer computer is required.

The [Vercel Container Runtime](https://vercel.com/docs/functions/runtimes/container) builds the Docker image remotely. `deployment/fullstack.Dockerfile` retains Python 3.11 and two independent scientific environments. Node.js only builds the website. The image build checks all 38 model artifacts and eight native-estimator reference predictions on Linux. The supervisor keeps ML on private loopback, serves the API and website on `PORT`, and stops both processes on termination. Model weights and their numerical runtime pins remain unchanged.

Deploy from a clean, reviewed checkout using Node.js 22.12+ and an authenticated Vercel CLI:

```bash
cp deployment/fullstack.Dockerfile Dockerfile.vercel
npx vercel@65.16.0 deploy --local-config deployment/vercel-container.json --env PORT=8000 --yes
```

Check the preview's `/ready` and actual analysis before publishing with the same command plus `--prod`. The project must already be linked to the intended Vercel account/project. `PORT=8000` is configured for this project's preview and production environments and is also explicit in the command. Runtime caches use `/tmp`; scale-down discards them. A cold instance reloads the models and may fetch external sources again. Platform quotas and billing still apply.

This container path does not require an external `ORBITFARM_ML_URL`. The existing GitHub publishing job below packages the alternative split Python deployment; until that job is migrated, use the container command for this complete deployment.

### Alternative split Python deployment

Vercel can also host only the frontend and field API. In that alternative, the ML service runs separately in its Python 3.11 environment; set **`ORBITFARM_ML_URL` to its reachable HTTPS URL**. A localhost address cannot connect separate cloud deployments. An optional shared `ORBITFARM_ML_TOKEN` is passed by the field API. Regional input files must also be available to the field API when regional forecasting is enabled.

Build a combined release from the integrated checkout:

```bash
npm ci
npm run deploy:stage
```

Release staging uses Node 24. The script builds Vite with the real same-origin API, includes all current agronomy modules and source/catalog JSON files, and prints a release path under `.vercel/`. An optional positional backend checkout remains supported for legacy split repositories. The staged field package uses Python 3.12. The script verifies the pinned Expat RPM SHA-256 and retains the library license required by Rasterio on Vercel Linux. Node's built-in Zstandard decoder extracts only the named files; no separate tar/zstd installation is required.

To use the existing GitHub publishing workflow, configure `VERCEL_TOKEN` and `ORBITFARM_ML_URL` as Actions secrets, plus `ORBITFARM_ML_TOKEN` when the inference service uses a token. The workflow builds and tests the release but does not publish a partially configured application when the token or ML URL is absent. It supplies the service settings at runtime, checks `/ready`, and performs the complete public release smoke check after publication.

For either deployment path, verify the public `/ready` response and actual source/model inference after publication. A local build alone does not establish the state of the public deployment.
