# orbitFarm

**From orbit to your next season.** An interactive farm planner using NASA Earth observations to help farmers compare crops, explore rotations and record care and harvests.

[Open the application](https://orbitfarm.vercel.app) · [30-second demo](https://drive.google.com/file/d/1VRy5t0WxT--Cl0ZFYI2BOqABsTEwC6Uk/view?usp=sharing) · [Complete source branch](https://github.com/PanilDanov/Agriculture-problem/tree/codex/submission-ready) · [Team HaHaton](https://www.spaceappschallenge.org/2026/find-a-team/team-robert/?tab=project) · [Submission material](docs/submission/project.md)

Built for NASA Space Apps Challenge 2026: [Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/). The live application includes the website, field-analysis API and 38 trained model artifacts, hosted together on Vercel Container Runtime.

## What you can do

- Draw a field, provide its crop history and management constraints, and request an analysis using real source data.
- Compare two-season rotation scenarios with component evidence, water constraints and explicit missing-data statuses.
- Plant any of ten crops, record care and harvests, and advance the selected rotation. Farm records are saved in the browser.
- Inspect experimental yield estimates and their geography, source dates, model versions and validation against a last-observed-yield baseline.

**Crops:** wheat, barley, maize, sorghum, chickpea, lentil, faba bean, sunflower, potato and open-field tomato. Coverage varies by crop and location; ten crops does not mean worldwide model coverage.

## How NASA data is used

| Source | Implemented use | Scope |
| --- | --- | --- |
| [NASA POWER Daily](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) | Historical temperature screening and field weather evidence | Point data; historical climate scenarios are distinguished from forecasts |
| [NASA POWER Monthly](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/) | Weather features for 20 provincial models: ten crops × pre-season/mid-season | Actual monthly data at a fixed representative point in each supported Spanish province |
| [ISRIC SoilGrids](https://www.isric.org/explore/soilgrids), MAPA and FAO references | Soil estimates, published crop calendars, crop statistics and reference water calculations | Separate sources with their own resolution, dates and limitations |
| [IGN/CNIG administrative units](https://www.ign.es/wfs-inspire/unidades-administrativas?service=WFS&request=GetCapabilities) | Independently sourced Spanish province selection boundaries | CC BY 4.0; audited CRS conversion and simplification, not surveyed field boundaries |
| FAOSTAT / CY-Bench / Copernicus AgERA5 | Ten national annual-history models and eight original wheat/maize regional artifacts | National models use yield history; regional models require compatible crop-mask weather inputs |

NASA POWER is listed in the challenge's [official resources](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/?tab=resources). NASA data is used in analysis and provincial ML features; the project does not imply NASA endorsement.

## Try the complete flow

1. Open the [farm](https://orbitfarm.vercel.app), draw a boundary and enter the known field information.
2. For the fullest currently audited seasonal model coverage, choose a field in **Ciudad Real, Granada, Huesca, Lleida, Tarragona or Zaragoza, Spain**. In **Edit field information**, expand **Forecast settings & existing plan**, set **Harvest year** to **2026** and **Forecast mode** to **Regional pre-season**.
3. Analyze the field and inspect source evidence and experimental model validation. Repeat with **Regional mid-season** to compare the second model mode. The automatic setting can select national annual estimates instead. Missing soil, calendar or water inputs remain visible and can prevent a complete recommendation.
4. Compare a rotation, record a planting, then record its harvest to advance the plan. The [test benches](https://orbitfarm.vercel.app/#/lab) provide explicitly labelled synthetic demonstrations.

All 20 provincial crop/mode combinations have frozen 2026 coverage in those six provinces. Coverage elsewhere is checked per crop and mode. A province-level estimate is not a prediction validated for an individual field. Thirteen of the 20 provincial models beat their baseline in both the overall holdout and conservative label-age check; all 20 remain experimental. National sorghum, chickpea and tomato models also remain experimental after failing their holdout baseline comparison.

Irrigation calculations use FAO-56 reference formulas and require sourced local measurements for the current root-zone snapshot. The application does not substitute satellite soil moisture for a farmer's root-zone measurement. Missing inputs are never filled with demo values in live analysis.

## Run locally

Requirements: **Python 3.11** and **Node.js 22.12+**; CI uses Node.js 24.

```bash
python3 scripts/orbitFarm-local.py setup
python3 scripts/orbitFarm-local.py run
```

Open `http://127.0.0.1:8000/`. The launcher creates separate pinned API and ML environments, builds the website and checks model readiness. No CDS account is needed for the bundled NASA/MAPA and national forecasts. Fetching new compatible AgERA5 data requires a free Copernicus CDS account and acceptance of the dataset licence; credentials stay outside Git.

For frontend development, run `npm ci` and `npm run dev`. See [development](docs/orbitFarm-development.md) and [deployment](docs/orbitFarm-deployment.md) for full commands and configuration.

## Code, formulas and verification

| Area | Start here |
| --- | --- |
| NASA/soil acquisition and analysis API | [data_pipeline.py](data_pipeline.py), [agronomy](agronomy/README.md) |
| Crop scores, rotations and water formulas | [scoring and water evidence](agronomy/scoring-and-water.md), [rotation_planner.py](agronomy/rotation_planner.py), [assessment.py](agronomy/assessment.py) |
| NASA/MAPA provincial ML | [model methodology and validation](yield_prediction/docs/province_models.md) |
| National ML and original regional models | [national models](yield_prediction/docs/national_models.md), [ML service](yield_prediction/docs/inference_service.md) |
| UI, planting and harvest lifecycle | [src](src), [crop catalog](docs/orbitFarm-crop-catalog.md) |
| API inputs and units | [request guide](docs/orbitFarm-backend-request-guide.md), [example request](contracts/orbitFarm-analysis-request.example.json) |

Run `npm run verify` for frontend checks and browser tests; install Chromium first with `npx playwright install chromium`. API and ML checks run separately in their pinned environments and in [GitHub Actions](https://github.com/PanilDanov/Agriculture-problem/actions). See the development guide for exact commands. Source manifests, temporal evaluation reports and model checksums are committed with model artifacts.

## Credits and reuse

Original project code is licensed under [Apache 2.0](LICENSE). Third-party code, data, fonts and assets retain their own terms; see [third-party notices](THIRD_PARTY_NOTICES.md). Current Spanish selection boundaries use official IGN/CNIG data under CC BY 4.0; their source, transformation and retained NASA-point checks are [audited separately](yield_prediction/docs/ign_geography.md).

[AI usage disclosure](AI_USAGE.md) documents Codex assistance and generated artwork. Source prompts and provenance are retained. The observed NASA, MAPA and FAOSTAT datasets are not AI-generated. `AgroWise_crop_requirements_clean.csv` retains its legacy filename for compatibility; **orbitFarm** is the current product name.
