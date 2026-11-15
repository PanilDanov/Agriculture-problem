# Independent yield model evaluation

The original release `1.0.0+b09d15d5ef` was trained on 40,618 rows prepared from CY-Bench 1.10. The local `data/processed/zenodo.csv` matches the original manifest at SHA-256 `b09d15d5ef1d31c1c98a7ff271f9f6e83dab1c0f152a08685f73b396bfaa2609`. [Original manifest](../artifacts/metrics/data_manifest.json) · [Original evaluation](model_evaluation.md)

## Team materials

Originals are archived locally under `yield_prediction/data/raw/team/`. The irrigation and rotation catalog records reviewed sources and how to acquire local observations. [Agronomy data audit](../../agronomy/data-audit.md)

| File | Contents and use |
| --- | --- |
| `AgroWise_crop_requirements_clean.csv` from Telegram | 10 crops and 21 fields. A strict CSV parser reads every row. The table documents the team's original suitability and rotation assumptions. |
| `AgroWise_crop_requirements_clean.csv` in the Git root | Originally malformed. The restored copy matches the verified Telegram export byte for byte and preserves the legacy data. |
| `AgroWise_10x14_crop_requirements.xlsx` | 14 groups of requirements for 10 crops, with a separate source sheet. It preserves qualitative conditions, threshold origins, and caveats lost in the numeric CSV. It distinguishes seasonal crop water use from rainfall totals. |
| Original farm data dictionary workbook | Reference units and sources for climate, soil, and agronomy fields. Its storage guide describes daily weather records, soil measurements grouped by source, and seasonal crop history. |
| `farm_data_lat42.0_lon-93.5_2016_2025.csv` | 10 annual records at one point. Surface and root-zone soil moisture are missing in all rows. Annual data support a unit and missing-data check. The regional model requires an administrative unit identifier and seasonal features for its weather windows. |
| `orbitFarm-backend-request-guide.md` | The interface contract covers field boundaries, dates, pH, texture, irrigation access, the water budget, and crop history. The provided year-by-year cropping history has no observed yield values. |

The local cache contains daily NASA POWER observations at the field point for 2016–2025. Applying the model requires comparability with AgERA5 aggregated over the region's harvested areas, as well as a full set of seasonal features including VPD, ET₀, and climatic water balance. When re-exporting site data, account for the fact that `data_pipeline.py` computes `extreme_temperature_days` and the current `OUTPUT_COLUMNS` omits that field. [Model inputs and dates of availability](../README.md#input-data)

## Independent data selection

The CY-Bench 1.10 archive contains 71 crop and country bundles with a yield table. The country is absent from the full 23-country original training dataset for 32 of those bundles. Ten of the 32 have harvests from 2021 onward and were included before calculating errors. For maize they are AR, BR, LS, MW, MZ, NE, and US. For wheat they are AR, BR, and US. The downloader extracts `yield`, `crop_calendar`, `meteo`, `soil`, and `location` and checks the CRC for each component. Brazilian yield tables use the mapping `BRA` → `BR`. [CY-Bench 1.10 release](https://zenodo.org/records/17279151)

The evaluation loads the published models and frozen history from the original pull request. For new countries, the comparison baseline uses only the crop median from the frozen history. Batch calculations are checked against `predict_yield()` for one observation of each mode and crop. Saved predictions include reasons for skipping rows. Aggregates include the overall error and the mean of per-country MAEs with equal weight for each country. [Original pull request](https://github.com/PanilDanov/Agriculture-problem/pull/1)

## Results in new countries

Of 26,481 raw rows with harvests from 2021 onward, 23,751 passed label and calendar checks. Preparation produced 300,920 rows across all years, of which 277,169 predated the test period. The prepared dataset for this evaluation has SHA-256 `ab0bcb7148e13249214cf1258c00788948f6991ec454cdbeba1df3e487875663`.

| Crop | Mode | Predictions | Model MAE, t/ha | Crop median MAE, t/ha | RMSE, t/ha | R² |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Maize | Pre-season | 18,132 | 2.299 | 3.411 | 2.868 | 0.352 |
| Maize | Mid-season | 18,280 | 2.204 | 3.396 | 2.626 | 0.454 |
| Wheat | Pre-season | 5,451 | 2.331 | 2.870 | 2.657 | −2.367 |
| Wheat | Mid-season | 5,205 | 1.329 | 2.827 | 1.583 | −0.218 |

The forecast date preceded the earliest supported issue date for 148 pre-season maize observations, 20 pre-season wheat observations, and 5 mid-season wheat observations. A further 261 wheat observations had insufficient weather data by mid-season. The dates of all populated mid-season weather summaries are within their calendar windows.

Brazil accounts for 12,919 of the 18,132 pre-season maize predictions. The reporting year discrepancy described below motivates checking results with Brazil excluded. In the other countries, pre-season maize had MAE **3.247 t/ha** over 5,213 rows, compared with **3.172 t/ha** for the crop median. In the US, 4,413 rows had MAE 3.504 versus 3.313 t/ha, with mean bias of −3.073 t/ha. For mid-season maize without Brazil, MAE was 2.825 versus 3.123 t/ha across 5,351 rows.

## Weather feature correction

Removing invalid season windows left gaps in the calendar table index. The joined weather table had a new index, so `mid_*` values could be assigned to an adjacent region or year. The calculation now restores the calendar index on the joined weather summaries. A regression test with a skipped row checks two different temperatures and both observation end dates. [Feature extraction](../src/yield_prediction/features.py) · [Tests](../tests/test_pipeline.py)

Reprocessing the original 36 archives changed mid-season features for 541 Ethiopian maize rows and 618 Spanish wheat rows. Keys, targets, and pre-season fields matched exactly across all 40,618 rows. The corrected dataset is in `data/processed/continuation/reference_corrected.csv` with SHA-256 `ca8da91570a8d42593720cd08ffb40aa5f9e45e0e0d5fd8384f781afcfc06251`.

## Mid-season model retraining

The corrected dataset was used to rerun model selection on the historical validation windows and train both `mid_season` models. The rows and values in the existing holdout matched exactly. Both models in the new candidate version `1.0.0+ca8da91570` reproduced the reference forecast through `predict_yield()`.

| Crop | Test rows | Original MAE, t/ha | Corrected and retrained MAE, t/ha |
| --- | ---: | ---: | ---: |
| Maize | 215 | 0.787 | 0.772 |
| Wheat | 393 | 0.511 | 0.533 |

Models and their metrics are stored under `data/processed/continuation/midseason_retrained/`. The table uses the same countries, seasons, and inputs as the original holdout.

The same rows in new countries were evaluated before and after retraining. For maize without Brazil, MAE changed from 2.825 to 2.790 t/ha across 5,351 rows. For wheat, MAE increased from 1.329 to 1.734 t/ha across 5,205 rows. Paired predictions and metrics are in `external_paired_predictions.csv` and `external_paired_metrics.json` in the retraining directory.

## Cross-check against IBGE SIDRA

The original municipal export of table 1612 for 2022–2025 is stored locally. The API measures yield in kg/ha. Municipality identifiers match CY-Bench keys after adding the `BR` prefix. For Brazilian wheat, all 1,016 matched 2022 values agree after division by 1,000. For maize in 2022–2023, 1,131 of 10,152 values agree within the same year. Comparing the CY-Bench 2023 harvest with SIDRA reporting year 2022 gives 4,961 matches out of 5,110. This discrepancy requires checking season definitions and harvest dates before joining new labels for Brazilian maize. [IBGE SIDRA table 1612](https://sidra.ibge.gov.br/tabela/1612) · [CY-Bench Brazil label documentation](https://github.com/WUR-AI/AgML-CY-Bench/blob/main/data_preparation/crop_statistics_BR/README.md)

## Brazilian wheat with new labels

Three of 3,156 numeric IBGE records for 2023–2025 could not be matched to the CY-Bench calendar. Pre-season predictions were generated for the other 3,153 records. The weather window for mid-season prediction is available for 1,067 records in 2023. The archive has insufficient mid-season weather for 2024 and 2025.

| Mode | Year | Predictions | Model MAE, t/ha | Crop median MAE, t/ha | R² |
| --- | --- | ---: | ---: | ---: | ---: |
| Pre-season | 2023 | 1,067 | 3.128 | 4.035 | −14.033 |
| Pre-season | 2024 | 1,057 | 2.863 | 3.631 | −10.900 |
| Pre-season | 2025 | 1,029 | 2.423 | 3.185 | −10.499 |
| Mid-season | 2023 | 1,067 | 1.759 | 4.035 | −4.456 |

The average pre-season bias for 2023–2025 was **+2.798 t/ha**. Systematic yield overprediction limits this version's transfer to Brazil.

## Next experiment

Evaluate a dedicated mode for regions without yield history. Select features and models on temporal windows holding out entire countries, compare with the crop median on the same rows, and track per-country bias. Reserve previously unused countries or seasons for the final evaluation. The groups in this report have already been used for diagnostic analysis.

## Reproduction

Run from `yield_prediction` in PowerShell with a Python 3.11 environment active.

```powershell
python download_data.py zenodo --crop maize --countries AR BR LS MW MZ NE US --output-dir data/raw/independent/cybench --max-span-mib 1400
python download_data.py zenodo --crop wheat --countries AR BR US --output-dir data/raw/independent/cybench --max-span-mib 1400
$archives = (Get-ChildItem data/raw/independent/cybench -Filter '*.zip').FullName
python prepare_data.py --input $archives --output data/processed/continuation/independent.csv
python validate_external.py --dataset data/processed/continuation/independent.csv --output data/processed/continuation/external

$sidra = 'data/raw/independent/ibge_sidra/sidra1612_2022_2025_raw.json'
New-Item -ItemType Directory -Force (Split-Path $sidra) | Out-Null
Invoke-WebRequest -Uri 'https://apisidra.ibge.gov.br/values/t/1612/n6/all/v/112/p/2022,2023,2024,2025/c81/2711,2716' -OutFile $sidra
python prepare_sidra_wheat.py --archive data/raw/independent/cybench/wheat_BR.zip --sidra $sidra --output data/processed/continuation/sidra_wheat.csv
python validate_external.py --dataset data/processed/continuation/sidra_wheat.csv --first-year 2023 --output data/processed/continuation/external_sidra_wheat

python prepare_data.py --source zenodo --output data/processed/continuation/reference_corrected.csv
python train.py --dataset data/processed/continuation/reference_corrected.csv --mode mid_season --output data/processed/continuation/midseason_retrained/artifacts --models data/processed/continuation/midseason_retrained/models --skip-diagnostics
```

Both evaluations save `metrics.json` with model hashes and breakdowns by country and year. They also save `predictions.csv` with a prediction or a skip reason for each prepared test-period row. The prepared CSV manifests describe the source archives and counts of rejected rows. The SIDRA export may change after official revisions.
