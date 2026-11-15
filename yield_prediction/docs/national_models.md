# National annual-yield models for the ten product crops

The project includes ten genuinely fitted models using observed FAOSTAT yields. They complement the separate wheat and maize regional models. The `annual_history` mode predicts **country-level annual yield in t/ha**. It does not claim field-level accuracy, use current weather, or provide a mid-season update. NASA POWER remains part of the field weather, suitability and irrigation assessments in the main application.

## Source and target identity

The source is FAO's [Crops and livestock products (QCL) official bulk download](https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip). The reviewed archive is 33,921,825 bytes, SHA-256 `c5835418c18f9322e7decbd6800f93a216eaae3cdfa31acb08f0518c0c6d6853`; its server Last-Modified is December 31, 2025. It contains records through harvest year 2024. The training command refuses a changed upstream archive until its identity and publication date have been reviewed.

The publisher's yield unit in this release is **kg/ha**, converted to t/ha by division by **1,000**. Only finite positive yield labels are modeled; 18 nonpositive/nonfinite rows were excluded. Official, estimated and external-source flags are counted in the training report. Source revisions and the absence of historical release vintages limit interpretation of retrospective tests.

Attribution: FAO. 2025. FAOSTAT: Crops and livestock products (QCL). Accessed November 15, 2026. https://www.fao.org/faostat/en/#data/QCL. CC BY 4.0, subject to the [FAO Statistical Database Terms of Use](https://www.fao.org/contact-us/terms/db-terms-of-use/en/). Derived training snapshots and model artifacts are produced by this project; FAO does not endorse the predictions.

| Product crop ID | FAOSTAT item | Target product |
| --- | --- | --- |
| wheat | 15 | Wheat |
| barley | 44 | Barley |
| maize | 56 | Maize (corn) |
| sorghum | 83 | Sorghum |
| chickpea | 191 | Chick peas, dry |
| lentil | 201 | Lentils, dry |
| faba-bean | 181 | Broad beans and horse beans, dry |
| sunflower | 267 | Sunflower seed |
| potato | 116 | Potatoes |
| tomato | 388 | Tomatoes, production systems combined |

Tomato labels do not distinguish open-field from protected production. Pulse targets describe dry harvested seeds, not fresh pods. These distinctions are also returned as inference warnings.

National FAO M49 identifiers are mapped to ISO2 using the pinned [Natural Earth 5.1.2 map](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson), SHA-256 `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`. Unmapped historical areas and regional/world aggregates are excluded. No neighboring country or world average replaces a missing country.

## Model and temporal checks

Each supervised row uses five consecutive **preceding** national yields. Predictors are log yield lags, three/five-year means, five-year standard deviation and trend, and target year. The target is log t/ha. Each crop selects among standardized Ridge (`alpha=1,10,100`) and a bounded HistGradientBoosting absolute-error model by macro-country MAE in 2019–2021, with initial training through 2018. The selected specification is fitted through 2021 and evaluated on untouched 2022–2024 labels. Final operational artifacts are then fitted on all available eligible rows through 2024.

The 2022–2024 check is a retrospective harvest-year test with preceding yield inputs. It is **not** a claim that revised FAOSTAT labels were available at those historical forecast dates. The operational interface only accepts `as_of` dates on or after publication of this frozen source snapshot. No target-year label is included in a feature row. Missing years break the history and are not interpolated.

| Crop | Supervised rows | Countries with complete history | Held-out MAE, t/ha | Last-yield baseline MAE, t/ha | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| wheat | 4,918 | 124 | 0.318 | 0.390 | Beats baseline |
| barley | 3,920 | 103 | 0.401 | 0.463 | Beats baseline |
| maize | 6,165 | 154 | 0.623 | 0.667 | Beats baseline |
| sorghum | 4,263 | 111 | 0.509 | 0.437 | Experimental |
| chickpea | 1,924 | 56 | 0.228 | 0.184 | Experimental |
| lentil | 1,947 | 56 | 0.163 | 0.169 | Beats baseline |
| faba-bean | 2,197 | 68 | 0.272 | 0.292 | Beats baseline |
| sunflower | 2,715 | 77 | 0.189 | 0.211 | Beats baseline |
| potato | 5,876 | 147 | 1.159 | 1.237 | Beats baseline |
| tomato | 5,858 | 149 | 4.772 | 4.463 | Experimental |

Full metrics, per-country errors, flags, validation alternatives, hashes and runtime versions are in each `national_models/<crop>.json` and [training_report.json](../artifacts/national/training_report.json). All ten models are operationally loadable; that does not imply all beat a simple baseline. Sorghum, chickpea and tomato explicitly report their experimental status.

## Inference

```python
from yield_prediction.national import predict_national_yield

forecast = predict_national_yield(
    crop="barley", country_code="FR", harvest_year=2027, as_of="2026-11-15"
)
```

The model recursively forecasts missing intervening years, with a maximum of five years after the country's latest reported yield. The response reports the horizon, intervening predictions, country and target-product identity, source and data cutoff, quality status, held-out metrics and warnings. No calibrated uncertainty interval is available (`null`). Increasing recursive horizons have not been separately calibrated.

Invalid country codes, absent production histories, gaps in the last five observations, past replay dates, future issue dates and excessive horizons produce a clear error. No ready-made number is substituted for a failed model call. Runtime versions and every artifact SHA-256 are checked on load. `national_readiness()` reports actual load readiness for all ten crop artifacts.

## Reproduce

Use the same Python 3.11 environment and exact runtime dependencies as the regional package. Downloading can use `certifi` when installed; otherwise the system trust store must be configured.

```bash
python yield_prediction/train_national.py
python yield_prediction/train_national.py --download
python -m pytest yield_prediction/tests/test_national.py -q
```

The default training command uses the released, checksum-verified 262 KiB filtered source snapshot in `artifacts/national/faostat_history.json.gz`; its manifest retains the original source hashes. It therefore remains reproducible if FAO later replaces its mutable bulk URL. `--download` instead retrieves and checks the original reviewed bulk source before recreating the prepared snapshot. The 34 MB source ZIP and country map are stored under ignored `yield_prediction/data/raw/faostat/`. The released ten models plus their ten manifests occupy less than 400 KiB and are committed under `yield_prediction/src/yield_prediction/national_models/`. The national forecast package runs without a network connection after installation. Updating the data requires reviewing the new source checksum/date, rerunning preparation and temporal validation, and releasing new model manifests.
