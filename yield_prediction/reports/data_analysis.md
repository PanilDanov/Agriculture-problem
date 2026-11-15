# CY-Bench data analysis

The experiment used yield observations and predictors from 36 crop–country pairs in the official 1.10 release. The official sample supported the integration experiment and reproduction of the earlier benchmark. The loader reads regional data and processes daily CSVs in chunks of 100,000 rows. Of 48,503 source rows, 190 failed validation because of invalid keys, values, areas, or ambiguous duplicates. Another 7,695 could not be matched to a valid crop calendar. The prepared dataset contains 40,618 observations across 23 countries and 1,098 unique country–region pairs. [Source and licence](https://zenodo.org/records/17279151) · [Data hashes and preparation log](../artifacts/metrics/data_manifest.json)

| Crop | Records | Countries | Regions | Years | Median, t/ha | Pre-season | Mid-season |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| Maize | 20,249 | 19 | 983 | 1990–2022 | 7.27 | 12,584 | 12,571 |
| Wheat | 20,369 | 17 | 862 | 1990–2024 | 6.29 | 13,124 | 13,097 |

The last two columns show eligible records before the time split. Most CY-Bench weather records start in 2001. Earlier yield observations contribute to yield history. Rows without climatology are ineligible for fitting the models. `awc` is missing in 44 rows. Missing seasonal features reflect incomplete daily coverage, unavailable observations, or the minimum season-history requirement. [Feature missingness](../artifacts/metrics/data_missingness.csv) · [Missingness chart](../artifacts/figures/missingness.png)

Observed yields range from 0.001 to 23.333 t/ha for maize and from 0 to 33.696 t/ha for wheat. The audit flags 741 observations above the CY-Bench reference limits of 14 and 9 t/ha respectively. The pipeline retains those positive official values. Applying the reference limits as cutoffs would alter the target distribution. [Yield distributions and annual medians](../artifacts/figures/yield_eda.png) · [CY-Bench configuration](https://raw.githubusercontent.com/WUR-AI/AgML-CY-Bench/main/cybench/config.py)

In the available climatology, median seasonal maize rainfall by country ranges from about 206 mm in Portugal to 1,205 mm in Madagascar. For wheat it ranges from about 220 mm in Australia to 481 mm in Czechia. These figures describe the observed sample and its crop calendars. The country and region mix changes over time, particularly after 2020, so annual pooled medians combine geographic composition and temporal variation. [Observations and country summaries](../artifacts/metrics/data_by_country.csv)

Pre-season forecasts use static features, weather from completed past seasons, and yield history published by the forecast date. Mid-season forecasts also use current-season weather with a 14-day delay. CY-Bench includes NDVI, fPAR, and GLDAS. Using them requires separate checks for coverage dates, publication lags, and the effect of smoothing. Relative humidity, pH, organic carbon, measured irrigation, and fertilizer applications were outside the features used for this release. [Source methodology](https://doi.org/10.5194/essd-18-3997-2026)
