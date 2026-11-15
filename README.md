# orbitFarm

**From orbit to your next season.**

[Open orbitFarm](https://orbitfarm.vercel.app/) · [Test benches](https://orbitfarm.vercel.app/#/lab)

A cozy 16-bit farm companion that turns Earth observations and local knowledge into explainable crop rotations and everyday care reminders.

This integrated checkout contains the website, the NASA field-analysis API and the independently pinned yield-model runtime. Product content, code, comments, and interface copy are in English.

## Run the complete application

Use Python 3.11 and Node.js 22.12 or newer. The launcher also detects an official Node distribution under `.runtime/`.

```bash
python3 scripts/orbitFarm-local.py setup
python3 scripts/orbitFarm-local.py run
```

Open `http://127.0.0.1:8000/`. The launcher builds the live website, starts the ML runtime separately, checks model readiness, and starts FastAPI on the same origin. It creates separate `.venv-api` and `.venv-ml` environments; it does not replace system Python or Node.

The complete flow uses NASA POWER historical and recent weather, SoilGrids estimates, published calendars, ten-crop suitability and measured irrigation calculations, and ten actual FAOSTAT national annual-history yield models. Compatible registered regional data enable the separate wheat/maize models. National yield, regional yield, historical water screens and suitability scores retain their distinct units and spatial support. An absent input is reported rather than filled with an example.

Source and model coverage vary by crop and country. Sorghum, chickpea and tomato national models did not improve on their last-yield holdout baselines and are explicitly experimental. No model claims verified accuracy for an individual field.

Copernicus CDS is optional for national forecasts and required for new compatible AgERA5 regional weather ingestion. After manually creating a CDS account and accepting the dataset licence, use `python3 scripts/orbitFarm-copernicus.py configure` to save a token outside Git. [Copernicus data pipeline](agronomy/copernicus-data.md) · [National models, real data and validation](yield_prediction/docs/national_models.md) · [Scoring and water evidence](agronomy/scoring-and-water.md) · [ML service](yield_prediction/docs/inference_service.md)

- [Project overview](orbitFarm.md)
- [Product specification](docs/orbitFarm-product.md)
- [24-hour delivery plan](docs/orbitFarm-delivery-plan.md)
- [Local development and test benches](docs/orbitFarm-development.md)
- [Restore both branches and their data on another computer](https://github.com/PanilDanov/Agriculture-problem/blob/feature/yield-prediction/DATA_RECOVERY.md)
- [Vercel deployment and updates](docs/orbitFarm-deployment.md)
- [Proposed analysis request contract](docs/orbitFarm-analysis-contract.md)
- [Backend request guide: current fields, allowed values, and examples](docs/orbitFarm-backend-request-guide.md)
- [Example analysis request](contracts/orbitFarm-analysis-request.example.json)
- [Brandbook](brand/orbitFarm-brandbook.md)
- [Crop sprite pack · 10 crops, 4 images each](brand/sprites/crops-v1/README.md)
- [Plantable crop catalog · IDs and demo behavior](docs/orbitFarm-crop-catalog.md)
- [Editable Figma design](https://www.figma.com/design/ZD6mSeYogRklG9vO6eMUCJ)

The analysis request sends no planting date, season end, or timezone. The backend chooses recommended crop planting dates and the planning horizon. Planting, care, reminder, and journal dates use `YYYY-MM-DD` without timezone conversion.

The public site calls the Vercel field API on the same origin. The API retrieves NASA POWER weather, soil data, and planting calendars for the selected field. Test benches provide labeled demo scenarios for local development.

## Run the website

Use Node.js 22.12 or newer; CI uses Node.js 24.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/#/farm` for the application or `http://127.0.0.1:5173/#/lab` for test benches. Run `npm run verify` for type checks, domain tests, a production build, and browser tests. Before the first browser test run, install Chromium with `npx playwright install chromium`. Check actual command and GitHub Actions results before treating a revision as verified.
