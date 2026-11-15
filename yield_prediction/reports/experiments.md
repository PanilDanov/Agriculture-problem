# Experiments

Training and tuning were separate for each mode. For each crop and mode combination, the experiment evaluated the crop median, regional median, Ridge, HistGradientBoosting, CatBoost, XGBoost, and LightGBM. Five model families were also trained jointly on both crops with one-hot encoding for crop. The comparisons included models without coordinates, models without yield history, and models trained on residuals from the historical median. [All test metrics](../artifacts/metrics/test_comparison.csv) · [All validation and Optuna runs](../artifacts/metrics/validation_comparison.csv)

Three expanding temporal validation windows evaluated 2013, 2015, and 2017. The runs used seed 42 and four Optuna configurations for each of the two most accurate model families on validation. Tuning compared MAE across the pooled predictions from all three windows. An ensemble qualified for selection after improving by at least 0.5% and winning in at least two windows. Models with variable iteration counts ran with stochastic early stopping disabled. The results record parameters, runtimes, sample sizes, and feature counts for every window.

Harvest years 2021–2024 were reserved for final evaluation before model selection. Given the assumed publication date of July 1 in the following year and the early starts of some seasons, the most recent training labels available in all four runs were from 2019. The regional history available to each training row respects its own issue date. In validation and testing, that history is restricted to the corresponding training split. The feature matrix excludes country and region identifiers. A separate ablation evaluated coordinates. Regional yield history represents the statistics available at issue time.

| Crop | Mode | Selected model | Validation MAE | Final training rows |
| --- | --- | --- | ---: | ---: |
| Maize | Pre-season | Optuna-tuned HistGradientBoosting | 0.898 | 11,810 |
| Maize | Mid-season | 50% residual HistGradientBoosting and 50% Ridge | 0.961 | 11,798 |
| Wheat | Pre-season | 75% Ridge and 25% HistGradientBoosting | 0.606 | 12,012 |
| Wheat | Mid-season | 50% HistGradientBoosting without coordinates and 50% shared LightGBM | 0.604 | 23,804 for the shared component |

The shared model contributed to the selected wheat mid-season ensemble. On the late holdout, shared HistGradientBoosting gave a pre-season wheat MAE of 0.582 versus 0.589 for the crop-specific version. For pre-season maize, the crop-specific Ridge gave 0.850 versus 0.874 for the shared model. For mid-season maize, residual learning improved HistGradientBoosting validation MAE and qualified for the ensemble. The crop-specific Ridge tied that ensemble at the rounded MAE on the late holdout. Pre-season HistGradientBoosting with climate history and soil alone, without historical regional yields, gave MAEs of 1.384 for maize and 0.766 for wheat. Adding coordinates gave 1.206 and 0.661, respectively.

## Maize in Spain, 2018–2020

| Spanish holdout, 144 observations | MAE, t/ha | RMSE, t/ha | R² |
| --- | ---: | ---: | ---: |
| Reproduced original HistGradientBoosting | 1.863 | 2.334 | 0.622 |
| Reproduced original regional median | 1.523 | 1.985 | 0.727 |
| New multi-country pre-season HistGradientBoosting | 1.048 | 1.343 | 0.875 |
| New multi-country mid-season ensemble | 1.231 | 1.604 | 0.821 |
| Regional median with the new label availability restriction | 1.745 | 2.249 | 0.649 |

The first run used 806 training observations from 2001–2017 and 144 holdout observations. The new models use a different set of training countries, new features, and a restriction based on when the official statistics become available. Spanish labels for 2018–2020 were reserved from tuning. The original boosting model underestimated yield by an average of 1.54 t/ha, and the median by 1.31 t/ha. The model without history captured persistent differences between regions less well. Ablation and feature importance provide evidence for the role of prior yield. Estimating the effect of irrigation requires a separate analysis. [Reproduction results](../artifacts/metrics/legacy_spain_maize.json) · [New run metrics](../artifacts/metrics)
