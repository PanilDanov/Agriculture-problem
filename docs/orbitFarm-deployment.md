# Run and deploy orbitFarm

The website, field API and all 38 yield estimators run in one Vercel Container
Runtime image. `Dockerfile.vercel` and `vercel.json` at the repository root are
the canonical deployment configuration. Docker Compose builds that same image
for local use. There is no separate ML server to provision or external
`ORBITFARM_ML_URL` to configure.

## Local development

Use Python 3.11 and Node.js 22.12 or newer; Node 24 is used in CI. The existing
launcher creates separate API and ML environments without changing global
packages:

```bash
python3 scripts/orbitFarm-local.py setup
python3 scripts/orbitFarm-local.py check
python3 scripts/orbitFarm-local.py run
```

Open `http://127.0.0.1:8000/`. An optional Python 3.12 can run the field API;
the ML environment requires Python 3.11 and its exact numerical versions.
The launcher can detect an official Node distribution under `.runtime/`.
Apple Silicon uses a checksum-verified OpenMP library under `.runtime/native`.

## The same container locally and on Vercel

The image builds the live same-origin website with Node 24. Its Python 3.11
runtime contains independent `/opt/api` and `/opt/ml` environments, native
Expat/OpenMP libraries and all frozen model artifacts. Node and training-source
archives are not copied into the final runtime. The image build checks all 38
artifacts and eight real native-estimator predictions against their references.

`deployment/run-container.py` starts private ML on loopback port 8001, waits for
readiness and then serves the API and built website on `0.0.0.0:$PORT`, default
8000. A child failure stops the whole instance; SIGTERM stops both children.
Caches use `/tmp` and disappear when the cloud instance scales down.

With Docker installed:

```bash
docker compose up --build --detach --wait --wait-timeout 120
curl --fail http://127.0.0.1:8000/ready
node scripts/orbitFarm-smoke-release.mjs http://127.0.0.1:8000
docker compose down
```

Compose publishes only the website/API port to local loopback. The API and ML
share the container, and the ML port is not published. This uses the production
image and ephemeral cache policy rather than a separate development stack.

## Deploy to Vercel

[Vercel Container Runtime](https://vercel.com/docs/functions/runtimes/container)
builds the image remotely; local Docker is not required for deployment. It is a
Beta platform feature, and platform quotas and billing apply. A cold instance
loads the models and may download external field sources again.

Use Node 22.12+ and an authenticated Vercel account. Link a clean reviewed clone
to the intended project once:

```bash
npx --yes vercel@65.16.0 login
npx --yes vercel@65.16.0 link
npm run deploy:preview -- --dry-run
npm run deploy:preview
```

The dry run prints the planned command and current revision without deploying.
Actual deployment requires a clean Git working tree, records `orbitFarmCommit`,
sets `PORT=8000` and verifies the exact new deployment URL. No temporary
Dockerfile copy, prebuilt static release directory or alternate Python runtime
is used. Project IDs can also be supplied through `VERCEL_ORG_ID` and
`VERCEL_PROJECT_ID`; automation supplies `VERCEL_TOKEN` as a secret.

The smoke check verifies HTML caching/assets, readiness for 8 crop-mask,
10 national and 20 provincial estimators, actual NASA field context, ten
national forecasts and both seasonal modes for all ten crops in Zaragoza.
For protected deployment URLs, supply an existing automation bypass secret as
`VERCEL_AUTOMATION_BYPASS_SECRET`. This also applies to immutable production URLs
when the project protects every domain except custom domains. The secret is sent
only to the verified deployment's own origin; keep it outside Git.

After inspecting the verified preview, publish the reviewed revision:

```bash
npm run deploy:production
```

The production command runs the same checks against the new immutable
production deployment URL. Verify the public project alias separately after
publishing. The complete application was publicly checked at
[orbitfarm.vercel.app](https://orbitfarm.vercel.app) on November 15, 2026;
that observation does not establish the state of a later deployment.

## GitHub Actions

The workflow runs frontend/browser checks, Python API checks, all pinned ML and
source tests, and real HTTP inference through an isolated API environment. It
then builds the canonical container, checks its 38-model readiness and exercises
real NASA plus all forecast families through that container.

Pushes to `main`, `frontend` and `codex/**`, and pull requests targeting `main`
or `frontend`, run verification. Automatic publication runs only after checks
pass on a push to `main` and the repository has a `VERCEL_PROJECT_ID` variable.
Configure these repository settings to enable it:

- Variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
- Secret: `VERCEL_TOKEN`.
- Secret for checking protected deployment URLs: `VERCEL_AUTOMATION_BYPASS_SECRET`.

The job verifies a preview before creating and verifying production. Without a
configured project, tests still run and the deployment job is skipped. A green
test run by itself does not claim that a deployment was published. The job
summary records the revision and both verified URLs. No external ML URL secret
or account-specific deployment-URL pattern is required.

## Data, model coverage and reproduction

`/health` checks the API process. `/ready` verifies the connected ML runtime,
model hashes and exact library versions. Neither endpoint by itself proves that
external NASA or soil providers are currently available; the release smoke
performs actual analysis requests as well.

Ten national annual-history models use frozen FAOSTAT yield histories, not
current-season weather. Country/crop coverage differs and unavailable histories
remain unavailable. Twenty separate experimental NASA/MAPA province models
provide both seasonal modes where real statistics, verified Spanish geometry,
monthly calendars and NASA representative-point weather support them. All
models preserve scale, sources, data cutoffs, holdout errors, baseline results
and historical-replay labels. Aggregate statistics and point weather do not
establish individual-field accuracy.

The original wheat/maize models retain their crop-mask AgERA5 contract. The
bundled ES112/Lugo release supports pre-season 2026 historical replay using
five 2019-2023 seasons. NASA point observations never substitute for that
regional aggregation. The Zaragoza field in
`deployment/smoke-province-field.json` supports all twenty experimental seasonal
crop/mode combinations for the frozen 2026 scenarios. Other requests may have
coverage gaps; no neighbouring region's labels are borrowed.

The repository includes frozen model weights, filtered FAOSTAT/MAPA labels,
calendar references, province geometry, compressed NASA monthly weather and
source/code hashes. Provincial retraining defaults to the tracked weather
release rather than ignored private `.data` files. Cross-platform reproducibility
checks require matching inputs/versions and close numerical predictions and
metrics; each artifact separately retains strict checksum verification.

To collect a new auditable monthly weather snapshot:

```bash
.venv-api/bin/python scripts/orbitFarm-province-weather.py
.venv-api/bin/python scripts/orbitFarm-publish-province-inputs.py
```

Newer provider responses can contain revisions and are a new input release.
Copernicus CDS is optional for the national and NASA/MAPA paths; new compatible
AgERA5 ingestion requires an account, accepted dataset licence and private
credentials. Never include credentials or raw caches in the repository.

Relevant contracts and source details:

- [ML service](../yield_prediction/docs/inference_service.md).
- [NASA/MAPA province models](../yield_prediction/docs/province_models.md).
- [National models](../yield_prediction/docs/national_models.md).
- [Published crop-mask inputs](../yield_prediction/docs/published_regional_inputs.md).
- [Regional ingestion](../yield_prediction/docs/data_engineer_contract.md).

## Re-run the checks

```bash
python -m unittest discover -s agronomy/tests -v
npm run test:deploy
npm run verify
```

Use the API interpreter for API tests. In the separate ML environment, fetch the
pinned real sample with `python yield_prediction/download_data.py sample`, then
run `python -m pytest -q` from `yield_prediction`. Its checked ZIP SHA-256 is
`0c84fd65f06acb3c7224f3fc512de83019dd97734506a5018b253ccbdba0d4ed`.
The deterministic HTTP integration check identifies its field-weather fixture
explicitly while using real packaged estimators:

```bash
.venv-api/bin/python scripts/orbitFarm-smoke-ml-stack.py --ml-url http://127.0.0.1:8001
```
