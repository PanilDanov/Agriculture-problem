# Mid-season revalidation

The experiment uses official CY-Bench 1.10 and unchanged original artifacts. The corrected CSV was reconstructed from 36 local archives and matches the previously reported SHA-256 `ca8da91570a8d42593720cd08ffb40aa5f9e45e0e0d5fd8384f781afcfc06251`. The original CSV SHA-256 is `b09d15d5ef1d31c1c98a7ff271f9f6e83dab1c0f152a08685f73b396bfaa2609`. [Previous evaluation](external_validation.md) · [Automated data integrity report](../artifacts/generalization/data_integrity.json).

## Data integrity

All 40,618 unique crop-country-region-year keys, targets, calendars and pre-season fields are preserved. Mid-season values or missingness change in 1,159 rows: 541 Ethiopian maize and 618 Spanish wheat records. Joining on `adm_id` and `harvest_year` within a country/crop preserves row identity despite index gaps. Duplicate dates are checked within and across CSV chunks. Every populated weather date is checked against season start and midpoint-minus-14-day cutoff. The revised aggregation reproduces the corrected CSV byte for byte. Tests cover identical raw IDs across countries, cross-year seasons, shuffled rows, gaps, duplicates and late-weather exclusion.

## Late temporal test in familiar countries

Comparisons use identical regions, targets and eligible issue dates. Original and revised searches independently use historical validation years 2013, 2015 and 2017. Late holdout 2021-2024 is excluded from candidate selection. Label publication lag limits final training through 2019. Comparators include the historical regional median, Ridge, HistGradientBoosting, CatBoost, XGBoost, LightGBM and residual HistGradientBoosting.

| Crop | Historical-median MAE | Old published MAE | Retrained original procedure | New candidate | MAE | RMSE | R² | Test n |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| Maize | 1.527 | 0.787 | 0.772 | HistGradientBoosting without current weather | 1.117 | 1.592 | 0.565 | 215 |
| Wheat | 0.640 | 0.511 | 0.533 | XGBoost | 0.576 | 0.774 | 0.848 | 393 |

The revised search ranks by equally weighted country MAE on validation. For maize it selected the no-current-weather candidate because validation MAE was 0.978 versus 1.007 for the same HistGradientBoosting with weather. On late holdout, including weather reduced MAE from 1.117 to 0.927. Wheat changed from 0.563 to 0.575 on the same test, indicating unstable weather benefit. Removing regional yield history increased wheat HistGB MAE to 0.662; removing historical climate gave 0.567. Parameters, validation, other ablations and country metrics are retained. [Temporal evaluation](../artifacts/generalization/midseason_metrics.json).

[Original-specification metric reproduction](../artifacts/generalization/reference_midseason_reproduction.json).

## Nested transfer evaluation

Four outer and two inner temporal/group folds exclude held-out-country labels from both training and history. Inner search compares five families with/without coordinates and HistGB without current weather. Selection minimizes mean country MAE.

| Crop | n | MAE | RMSE | R² | Bias | Crop-median MAE | Mean country MAE | Country wins |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Maize | 1,578 | 2.148 | 2.642 | 0.058 | -0.727 | 2.531 | 2.304 | 9/16 |
| Wheat | 2,107 | 1.286 | 1.703 | 0.355 | -0.274 | 2.539 | 1.543 | 15/17 |

Case keys match the nested pre-season evaluation. In this protocol, the revised wheat mid-season search worsens transfer mean country MAE from 1.276 to 1.543. This compares selection procedures with different inputs, including the weather block. [Nested folds and results](../artifacts/generalization/midseason_spatial_metrics.json).

## Explaining weaker wheat transfer

All variants receive identical corrected features, dates and a crop-median baseline MAE of 3.033 t/ha on 6,274 common Argentina/Brazil/US rows. Brazil includes CY-Bench 2021-2022 and municipal IBGE SIDRA 2023 labels. These SIDRA labels are diagnostic and were used in earlier evaluation.

| Training inputs | Specification | MAE | RMSE | R² | Bias |
| --- | --- | ---: | ---: | ---: | ---: |
| Original | Old published | 1.403 | 1.653 | -0.331 | +0.729 |
| Corrected | Old frozen specification | 1.321 | 1.563 | -0.189 | +0.610 |
| Original | Specification selected by the previous corrected run | 1.908 | 2.214 | -1.387 | +1.658 |
| Corrected | Specification selected by the previous corrected run | 1.864 | 2.164 | -1.280 | +1.593 |
| Corrected | New temporal XGBoost candidate | 1.446 | 1.700 | -0.407 | +0.905 |

Correcting training data improves MAE for both frozen-specification pairs. The earlier error increase is primarily associated with changed ensemble components after selection on familiar countries. Fixed-specification data effects are smaller. Both corrected versions still face transfer without regional history. Argentina and Brazil are warmer at mid-season: country medians 12.74 and 15.20°C versus 5.96°C in training. Argentina is drier in mid-season precipitation (50 versus 128 mm); Brazil is wetter (167 versus 128 mm). Median observed yields on these evaluated rows are 2.37 and 2.70 versus 6.35 t/ha in training. The US median is 4.33 t/ha with a different climate balance. These shifts are consistent with transferred bias; irrigation and fertilizer effects cannot be identified without measurements.

For Brazilian wheat, all 1,016 common municipal observations match SIDRA 2022 after kg/ha-to-t/ha conversion with tolerance 0.001. SIDRA 2023 changes the sample composition. The old mid-season model has bias +1.677 t/ha on it, the corrected model with the same components +1.581, and the reselected model +2.469. The archive lacks mid-season weather for SIDRA 2024-2025. For Brazilian maize, same-year matching agrees in 1,175 of 10,152 rows; aligning CY-Bench 2023 to SIDRA 2022 agrees in 4,965 of 5,110. Brazilian maize is consequently excluded from forecast comparison until the reporting calendar is resolved. [Source-label audit](../artifacts/generalization/transfer_label_audit.json) · [IBGE SIDRA](https://sidra.ibge.gov.br/tabela/1612).

The next independently evaluated wheat candidate should be the frozen specification refitted on corrected data. The existing published artifact remains unchanged for reproducibility. None of the evaluated mid-season versions receives a production recommendation in new countries. The API explicitly marks `mid_season_v2` as an experimental temporal-search candidate; the adapter rejects mid-season without verified regional history.

On 5,351 common maize rows excluding Brazil, original MAE is 2.825, corrected frozen-specification MAE 2.788, previous-procedure reselected MAE 2.790, and new temporal-candidate MAE 3.024 t/ha. The crop-median baseline MAE is 3.123. Conclusions depend on weighting: 4,413 rows are from the US; on equally weighted country MAE the new candidate improves to 2.480 versus 3.452 t/ha for the frozen specification.

Very few geographically new-country labels have sufficient eligible weather. Issue-date filtering leaves two maize rows in BF and 22 wheat rows in IE/LT. The new temporal wheat candidate has MAE 1.060 and RMSE 1.417 t/ha versus crop-median MAE 1.911. Mean country MAE is 1.943 t/ha, including 3.022 on two Irish rows. This reinforces the need for geographic weighting and independent future seasons. [Paired estimates and countries](../artifacts/generalization/transfer_comparison.json).

## Reproduction

```bash
python prepare_data.py --source zenodo --output data/processed/continuation/reference_corrected.csv
python revalidate.py integrity --original data/processed/zenodo.csv --corrected data/processed/continuation/reference_corrected.csv --output data/processed/generalization
python revalidate.py mid --corrected data/processed/continuation/reference_corrected.csv --output data/processed/generalization
python revalidate.py mid_spatial --corrected data/processed/continuation/reference_corrected.csv --output data/processed/generalization
python train.py --dataset data/processed/continuation/reference_corrected.csv --mode mid_season --output data/processed/continuation/midseason_retrained/artifacts --models data/processed/continuation/midseason_retrained/models --skip-diagnostics
```

Retain the original CSV separately for integrity reproduction; it must match the original hash. New files in `candidate_models` do not overwrite published artifacts. `mid_season_v2` provides explicit candidate access.

Prepare paired-evaluation archives following [external validation](external_validation.md#reproduction). Additional CY-Bench 1.10 countries are BF, DK, IN, ML, SN for maize and IE, IN, LT, LV for wheat. `prepare_sidra_wheat.py --include-benchmark` can prepare Brazilian wheat in one invocation; do not also supply a duplicate Brazilian CY-Bench CSV. Prepare the remaining countries with `prepare_data.py --input`. Pass non-overlapping CSVs to `compare_transfer.py --external ...`. Diagnostic-country years 2021+ have already been examined. Geographically new-country tests use harvests through 2020 and issue dates from July 1, 2018, when all model-selection labels were available under the assumed publication rule.

```bash
python compare_transfer.py --original data/processed/zenodo.csv --corrected data/processed/continuation/reference_corrected.csv --external data/processed/continuation/external_cybench.csv data/processed/continuation/brazil_benchmark_and_sidra.csv --previous-models data/processed/continuation/midseason_retrained/models --output data/processed/generalization/paired
```

The script saves row-level forecasts and frozen-specification models trained on corrected inputs under `frozen_spec_corrected_models`. `audit_transfer_labels.py` reproduces the additional audit using the SIDRA 1612 export and four small CY-Bench tables.
