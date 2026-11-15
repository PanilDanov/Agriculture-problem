# Cold-start pre-season evaluation

The model forecasts regional yield without regional yield history. Inputs include season length, historical seasonal climate and available soil predictors. Coordinates are evaluated by a separate ablation. Country code, administrative ID and all target-yield aggregates are excluded from the predictor matrix. Shared two-crop models use one-hot crop encoding. [Artifacts](../src/yield_prediction/candidate_models) · [Metrics and splits](../artifacts/generalization/cold_start_metrics.json).

## Nested country and temporal evaluation

The source table contains 40,618 CY-Bench 1.10 records from 23 countries: 20,249 maize and 20,369 wheat rows. Pre-season eligibility retains 12,584 and 13,124 rows respectively. Each of four outer splits excludes entire countries for both crops. Outer predictions cover harvests in 2018-2020. The earliest issue date in a block restricts training labels, using July 1 of the following year as the assumed publication date. The latest eligible training labels in every outer fold are from 2016.

Two inner group folds select estimator family, coordinates, separate/shared architecture and a bounded parameter set. Ranking uses equally weighted country MAE, then fraction of country wins and absolute bias. Validation years 2015 and 2017 are bounded by the outer cutoff. The measured outer protocol tuned on 2015, with training labels through 2013. A separate inner search using 2015 and 2017 selected the experimental release artifacts. Candidates include Ridge, HistGradientBoosting, CatBoost, XGBoost and LightGBM. The baseline is the crop median from training countries in the same fold.

| Crop | Rows / countries | Row MAE | RMSE | R² | Bias | Crop-median MAE | Country median MAE | Mean country MAE | Mean country baseline MAE | Country wins |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Maize | 1,578 / 16 | 2.274 | 2.845 | -0.092 | -0.810 | 2.531 | 2.072 | 2.393 | 2.506 | 8/16 |
| Wheat | 2,107 / 17 | 1.220 | 1.531 | 0.479 | -0.201 | 2.539 | 1.206 | 1.276 | 2.460 | 17/17 |

Errors are in t/ha. Each outer group receives a model selected exclusively within its training data. These numbers evaluate the selection procedure; saved artifacts are subsequently trained on all eligible original countries through 2019. The saved maize estimator is a separate XGBoost with coordinates, fitted on 11,810 rows from 19 countries. Wheat uses a separate CatBoost with coordinates, fitted on 12,012 rows from 17 countries. JSON records list fold composition and final training countries.

## Architecture comparison

The table reports the best inner mean country MAE for each estimator/coordinate combination, considering both separate and shared training. These results selected the release artifacts.

| Model | Maize without coordinates | Maize with coordinates | Wheat without coordinates | Wheat with coordinates |
| --- | ---: | ---: | ---: | ---: |
| Ridge | 2.419 | 2.558 | 1.825 | 2.178 |
| HistGradientBoosting | 2.169 | 2.222 | 1.269 | 1.245 |
| CatBoost | 2.286 | 2.118 | 1.235 | 1.118 |
| XGBoost | 2.156 | 1.902 | 1.321 | 1.205 |
| LightGBM | 2.187 | 1.956 | 1.309 | 1.194 |

The best shared estimators achieved 2.149 and 1.258 respectively. Coordinates improved the best trees on inner splits and worsened Ridge. Outer folds selected different models, so their benefit depends on crop, estimator and geography. An ensemble was unnecessary for the separate cold-start candidate.

The nested evaluation supports continuing the wheat pilot. Maize improves mean country MAE modestly, with negative R² and substantial mean bias. For example, South Africa MAE reached 5.007 t/ha with bias -5.007; Spain MAE was 4.135 with bias -2.842. Wheat in Australia had MAE 2.845 and bias +2.710. Climate, coordinates and yield distributions describe domain shift. The archive has no observed irrigation, fertilizer or management fields, so those contributions cannot be identified quantitatively. These models remain experimental for transfer. [Distributions and paired diagnostics](midseason_revalidation.md).

## Additional evaluation outside training countries

Published pre-season and new cold-start models were compared on common rows. Specifications were chosen before inspecting these diagnostic forecasts. These countries and the Brazilian IBGE labels had already been examined, so this tests robustness on known problematic data rather than constituting a new independent final test.

| Crop and coverage | n | Previous MAE | Cold-start MAE | RMSE | R² | Bias | Median baseline MAE | Cold-start mean country MAE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Maize, AR / LS / MW / MZ / NE / US | 5,213 | 3.247 | 2.525 | 2.960 | 0.034 | -1.352 | 3.172 | 2.433 |
| Wheat, AR / BR / US and IBGE 2023-2025 | 8,606 | 2.507 | 0.919 | 1.203 | 0.182 | +0.037 | 3.146 | 1.020 |

US maize MAE fell from 3.504 to 2.664; bias improved from -3.073 to -1.758 t/ha. The US median for the evaluated 2021+ yield labels is 10.444 t/ha, compared with 7.461 in training. Evaluated US regions are also warmer and wetter than the original sample on common mid-season rows: 20.77°C and 657 mm versus 17.47°C and 496 mm. Brazilian wheat MAE fell from 2.670 to 0.754 and bias from +2.661 to -0.020 t/ha. Its original Brazilian labels have median yield 3.00 t/ha versus 6.35 in training. Seasonal calendars and administrative-statistics levels differ across countries. Brazilian maize is excluded because SIDRA comparison confirms reporting-year ambiguity. [Country/year metrics](../artifacts/generalization/transfer_comparison.json) · [Label audit](../artifacts/generalization/transfer_label_audit.json).

A geographically independent check preselected BF, DK, IN, ML and SN for maize; IE, IN, LT and LV for wheat. Those countries were excluded from selection and training, and early issue dates restricted training labels through 2017. Applying issue dates from July 1, 2018 and the coverage requirements leaves **one** maize row from BF and **22** wheat rows from IE/LT. Wheat MAE is 0.718, RMSE 0.928 and R² 0.666, versus crop-median MAE 1.911 t/ha. One maize case cannot support a conclusion. This small new independent sample leaves final validation open for both crops.

## Reproduction

From `yield_prediction`, install `requirements-train.txt` and the package with `python -m pip install -e .`. After preparing the corrected CSV, run:

```bash
python revalidate.py cold --corrected data/processed/continuation/reference_corrected.csv --output data/processed/generalization
```

Row-level predictions are written to the selected local output directory. Model and summary paths are controlled separately by `--models` and `--artifacts`. Original artifacts remain in their existing directories.
