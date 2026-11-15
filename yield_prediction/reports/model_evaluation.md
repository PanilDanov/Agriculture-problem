# Model evaluation

Model selection used historical temporal validation. The 2021–2022 maize test covers China, Germany, and South Africa. The wheat test covers Australia, China, and Germany in 2021–2024 for pre-season and through 2023 for mid-season, where weather coverage is sufficient. Results aggregate regional observations.

| Crop | Mode | Test, n | MAE, t/ha | RMSE, t/ha | R² | Regional median MAE | MAE reduction |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Maize | Pre-season | 215 | 1.314 | 1.846 | 0.415 | 1.527 | 13.9% |
| Maize | Mid-season | 215 | 0.787 | 1.073 | 0.802 | 1.527 | 48.4% |
| Wheat | Pre-season | 413 | 0.634 | 0.811 | 0.850 | 0.645 | 1.6% |
| Wheat | Mid-season | 393 | 0.511 | 0.705 | 0.874 | 0.640 | 20.2% |

For pre-season maize, the MAE improvement accompanied an increase in RMSE from 1.826 to 1.846 and a drop in R² from 0.428 to 0.415. Ridge had MAE 0.850 on that same test and warrants an independent evaluation. On the same 393 wheat rows, MAE drops from 0.636 to 0.511 between the two issue dates. [All candidates](../artifacts/metrics/test_comparison.csv) · [Paired comparison of forecasting modes](../artifacts/metrics/paired_modes.csv)

## Transfer to new countries

For each held-out country, the evaluation used its last three available seasons ending no later than 2020. Training included only earlier harvests from other countries and withheld the held-out country's labels and yield history. The table shows the median of the per-country MAEs, with equal weight per country. Test periods may vary across countries.

| Crop | Mode | Countries | Crop median | Ridge without coordinates | HistGB without coordinates | HistGB with coordinates |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Maize | Pre-season | 19 | 2.309 | 1.845 | 1.877 | 1.992 |
| Maize | Mid-season | 19 | 2.311 | 1.821 | 1.797 | 2.059 |
| Wheat | Pre-season | 17 | 2.321 | 1.482 | 1.343 | 0.965 |
| Wheat | Mid-season | 17 | 2.321 | 1.476 | 1.269 | 0.908 |

Coordinates improved HistGB transfer for wheat and worsened the median transfer error for maize. For pre-season maize, HistGB without coordinates has MAE 0.91 in Zambia and 3.01 in Spain. These leave-one-country-out models measure transfer without regional history. When regional history is missing, the packaged API uses an imputed prediction or a separate component without history for residual models. [Breakdown by country](../artifacts/figures/leave_one_country_out.png)

## Training sample size

The learning curve uses one late holdout per mode. As training size increases, earlier eligible observations are added while the available history remains a fixed input. Shared models keep the crop proportions approximately constant.

| Crop | Mode | 500 | 1,000 | 2,000 | 5,000 | 10,000 | All |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Maize | Pre-season | 1.618 | 1.632 | 1.558 | 1.427 | 1.255 | 1.314 |
| Maize | Mid-season | 1.341 | 1.058 | 0.792 | 0.880 | 0.799 | 0.787 |
| Wheat | Pre-season | 0.784 | 0.854 | 1.656 | 0.609 | 0.650 | 0.634 |
| Wheat | Mid-season | 0.622 | 0.600 | 0.597 | 0.567 | 0.518 | 0.511 |

Mid-season wheat improves at every measured step. For the other tasks, the effect depends on the mix of added years and countries. The training sample size was set independently of this curve. [Learning curves](../artifacts/figures/learning_curves.png)

## Errors and feature importance

The historical regional median and the median of the five latest available harvests have the largest permutation importance in all four runs. Among climate features, within-season temperature variability stands out for pre-season maize. Mean temperature and precipitation stand out for pre-season wheat. Frost and minimum temperatures are prominent in mid-season. Features are interdependent. Permutations within years measure the sensitivity of predictions to inputs. Causal effects require a separate investigation. [Permutation importance](../artifacts/figures/permutation_importance.png)

Pre-season maize errors were particularly high in Germany, with MAE 1.88 t/ha and bias −1.66 t/ha. Mean bias was −1.88 t/ha in the top yield quintile and −1.63 t/ha in the dry quintile. For mid-season wheat, Australia had MAE 0.86 and bias −0.65 t/ha. Overprediction at low yields varied across groups, and pre-season wheat was nearly unbiased in the lowest yield quintile. [Residual distribution](../artifacts/figures/heldout_predictions.png) · [Errors by group](../artifacts/figures/heldout_mae.png)

## Uncertainty

The descriptive estimate used the 90th percentile of absolute errors, giving equal total weight to each of the three retrospective seasons from 2018 to 2020. Maize calibration excluded Spain. On the late holdout, observed coverage across the four tasks was 87.0%, 98.1%, 95.9%, and 95.4% in the order of the first table. Mean widths were approximately 6.00, 6.01, 3.22, and 3.02 t/ha, respectively. Shared errors within countries and seasons and the limited calibration sample leave 90% coverage uncertain. The intervals are reported here for evaluation only. Country and year coverage is in the JSON output for each run. [Detailed metrics](../artifacts/metrics)
