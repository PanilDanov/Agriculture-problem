# AgroWise yield prediction

This module forecasts maize (`maize`) and wheat (`wheat`) yield in t/ha at the administrative-region level. Each crop has two trained models. `pre_season` forecasts on the day before the season starts. `mid_season` forecasts at the calendar midpoint using weather available by then after the AgERA5 publication lag.

## Run a forecast

Use Python 3.11. Install the module from the repository root and run an example on a held-out CY-Bench record.

```bash
python -m pip install ./yield_prediction
python yield_prediction/predict_example.py --crop maize --mode pre_season
python yield_prediction/predict_example.py --crop wheat --mode mid_season
```

```python
import json
from pathlib import Path

from yield_prediction import predict_yield

record = json.loads(
    Path("yield_prediction/artifacts/examples/maize_pre_season.json").read_text(encoding="utf-8")
)
result = predict_yield(record["features"], crop="maize", mode="pre_season")
print(result["predicted_yield_t_ha"])
```

The package includes the models, input transformations, and frozen yield-history summaries. The function validates the schema, calendar, units, and ranges and checks geographic coverage. It returns a JSON-compatible dictionary with the estimate, model version, level of aggregation, and warnings. Invalid inputs raise `ValueError` or `TypeError`. The value of `prediction_interval_t_ha` is `null`. A normal prediction uses the installed package without network access or training.

## Input data

- Provide a two-letter CY-Bench `country_code`, string `adm_id`, `harvest_year`, and ISO dates `season_start` and `season_end`. `season_days` counts both boundary dates.
- Provide `climate_` aggregates, `climate_seasons` from two to five, and the last observation date as `climate_through`. Use up to five of the most recent completed seasons for the same crop and region within the preceding seven harvest years. The historical season must end at least 14 days before the forecast date. Historical and current windows require at least 95% complete daily records.
- For `mid_season`, add the `mid_` aggregates, `mid_weather_through`, and `mid_weather_coverage`. The window begins at `season_start` and ends 14 days before the midpoint. The midpoint is `season_start + (season_days - 1) // 2` days.
- `awc` and `bulk_density` in CY-Bench units, and `latitude` and `longitude` in degrees, may be `null`. Imputation uses training statistics. `adm_id` is used to look up eligible yield history and produce geographic warnings.

| Suffix | Aggregate and unit |
| --- | --- |
| `temperature_c`, `min_temperature_c`, `max_temperature_c`, `temperature_sd_c` | Mean and standard deviation of daily mean temperature, minimum of daily minima, and maximum of daily maxima, in °C |
| `precipitation_mm`, `precipitation_mm_day` | Total and mean over observed days, in mm and mm/day |
| `radiation_mj_m2_day` | Mean daily radiation, in MJ/m²/day |
| `et0_mm`, `water_balance_mm` | Total reference ET and climatic water balance, in mm |
| `vpd_kpa` | Mean vapour pressure deficit at the daily maximum temperature, in kPa |
| `hot_days`, `frost_days`, `dry_days` | Counts of days with Tmax ≥ 35 °C, Tmin < 0 °C, and precipitation < 1 mm, respectively |
| `climate_precipitation_sd_mm`, `climate_temperature_interannual_sd_c` | Sample standard deviations of seasonal precipitation totals and mean temperatures, in mm and °C |

The `climate_` aggregates use the selected historical seasons. The request validates the supplied dates and values. Data providers must ensure spatial alignment and verify when the observations became available. Four complete requests are in [the examples directory](artifacts/examples). AgERA5 units are documented by [Copernicus](https://cds.climate.copernicus.eu/datasets/sis-agrometeorological-indicators?tab=overview).

## Reproduce the experiments

```bash
cd yield_prediction
python -m pip install -r requirements-train.txt
python -m pip install -e .
python download_data.py sample
python prepare_data.py --source sample
python reproduce_es.py
python -m pytest -q
python download_data.py zenodo
python prepare_data.py --source zenodo
python train.py
python evaluate.py
```

For a quick check, use the sample, its own configuration, and separate output paths.

```bash
python train.py --dataset data/processed/sample.csv --config configs/sample.json --mode pre_season --crop maize --family ridge --output data/processed/quick_run --models data/processed/quick_models --skip-diagnostics
```

Use `--mode`, `--crop`, `--trials`, and `--family` to configure a run. Optuna selects parameters across historical time splits. To update a model, supply the new data, define a new independent test period, and regenerate the reports. The package pins the dependencies used by the released models, including LightGBM. If retraining selects CatBoost or XGBoost, check the versions in the metadata and install the corresponding dependency from `requirements-train.txt`.

`download_data.py zenodo` retrieves the necessary CSV files from pinned release 1.10. For selected countries, use `--countries FR IT DE` and optionally `--crop wheat`. For large countries or a full local copy, download `cybench-data.zip` and run `python prepare_data.py --input /path/to/cybench-data.zip --output data/processed/full.csv`. An extracted directory is also accepted. The new data must provide one `yield`, `crop_calendar`, `meteo`, `soil`, and `location` file per crop–country pair with compatible region IDs. For an added country, verify the target region, label quality, calendar, and leave-one-country-out performance before updating the artifacts. [CY-Bench v1.10](https://zenodo.org/records/17279151) · [Official sample](https://github.com/WUR-AI/sample_data/tree/b55e6918de1e1fa1b998966f6014b578cd36b83b)

## Results and limitations

- [Data analysis](reports/data_analysis.md)
- [Experiments](reports/experiments.md) and [model evaluation](reports/model_evaluation.md)
- [Independent validation in new countries and on IBGE data](reports/external_validation.md)
- [Held-out test comparison](artifacts/metrics/test_comparison.csv), [tuning runs](artifacts/metrics/validation_comparison.csv), and [figures](artifacts/figures)
- [Model limitations](reports/limitations.md) and [trained models and schemas](src/yield_prediction/models)

Cite Kallenberg et al., *CY-Bench: a comprehensive benchmark dataset for sub-national crop yield forecasting*, and the source of the corresponding national statistics. The Zenodo release lists EUPL-1.2 and the citation requirements for the included sources. [Paper](https://doi.org/10.5194/essd-18-3997-2026) · [Release and licence](https://zenodo.org/records/17279151)
