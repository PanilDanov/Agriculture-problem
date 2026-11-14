# AgroWise · прогноз урожайности

Модуль прогнозирует урожайность кукурузы (`maize`) и пшеницы (`wheat`) в т/га на уровне административного региона. Для каждой культуры включены две обученные модели. `pre_season` рассчитывает прогноз на день перед началом сезона. `mid_season` прогнозирует на середину календарного сезона по погоде, доступной к этой дате с учётом задержки AgERA5.

## Прогноз

Рекомендуем Python 3.11. Из корня репозитория установите модуль и запустите пример на отложенной записи CY-Bench.

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

Модели, преобразования входов и замороженные сводки истории урожайности поставляются в пакете. Функция проверяет схему, календарь, единицы, диапазоны и принадлежность к обучающей географии. Она возвращает JSON-совместимый словарь с оценкой, версией, уровнем агрегации и предупреждениями. При ошибке входа возвращается исключение `ValueError` или `TypeError`. Значение `prediction_interval_t_ha` равно `null`. Загрузка выполняется из локального пакета, обычный вызов не требует сети или обучения.

## Входные данные

- Укажите двухбуквенный `country_code` CY-Bench, строковый `adm_id`, год сбора `harvest_year` и даты сезона `season_start`, `season_end` в формате ISO. `season_days` включает обе границы.
- Передайте сезонные агрегаты с префиксом `climate_`, число использованных сезонов `climate_seasons` от 2 до 5 и дату последнего принятого наблюдения `climate_through`. Используйте до пяти последних завершённых сезонов той же культуры и региона в пределах предыдущих семи лет сбора. Исторический сезон должен закончиться как минимум за 14 дней до даты прогноза. Для исторического и текущего окна требуется не менее 95% полных дневных записей.
- Для `mid_season` добавьте агрегаты с префиксом `mid_`, дату `mid_weather_through` и долю полных дней `mid_weather_coverage`. Окно начинается в `season_start` и заканчивается за 14 дней до середины сезона. Середина равна `season_start + (season_days - 1) // 2` суток.
- `awc` и `bulk_density` в шкале CY-Bench, а также `latitude` и `longitude` в градусах допускают `null`. Импутация использует обучающие статистики. `adm_id` используется для поиска разрешённой истории и географических предупреждений.

| Суффикс | Агрегат и единица |
| --- | --- |
| `temperature_c`, `min_temperature_c`, `max_temperature_c`, `temperature_sd_c` | Среднее и стандартное отклонение дневной средней температуры, минимум дневных минимумов, максимум дневных максимумов, °C |
| `precipitation_mm`, `precipitation_mm_day` | Сумма и среднее за наблюдавшиеся дни, мм и мм/сут |
| `radiation_mj_m2_day` | Средняя суточная радиация, МДж/м²/сут |
| `et0_mm`, `water_balance_mm` | Суммарные ET₀ и климатический водный баланс, мм |
| `vpd_kpa` | Средний дефицит давления водяного пара при дневном максимуме температуры, кПа |
| `hot_days`, `frost_days`, `dry_days` | Число дней с Tmax ≥ 35 °C, Tmin < 0 °C и осадками < 1 мм соответственно |
| `climate_precipitation_sd_mm`, `climate_temperature_interannual_sd_c` | Выборочное стандартное отклонение сезонных сумм осадков и средних температур, мм и °C |

Каждый `climate_`-агрегат усредняется по выбранным сезонам. Контракт проверяет указанные даты и значения. Источник должен обеспечить пространственное соответствие и фактическую доступность погодных наблюдений. Четыре полных запроса находятся в [artifacts/examples](artifacts/examples). Сведения о шкалах AgERA5 приведены в [документации Copernicus](https://cds.climate.copernicus.eu/datasets/sis-agrometeorological-indicators?tab=overview).

## Воспроизведение экспериментов

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

Для быстрой повторной проверки используйте sample, отдельную конфигурацию и отдельные пути вывода.

```bash
python train.py --dataset data/processed/sample.csv --config configs/sample.json --mode pre_season --crop maize --family ridge --output data/processed/quick_run --models data/processed/quick_models --skip-diagnostics
```

Для настройки одного режима доступны параметры `--mode`, `--crop`, `--trials` и `--family`. Optuna выбирает параметры на нескольких прошлых временных разбиениях. При обновлении модели подайте новую выборку, задайте новый период независимой проверки и перерассчитайте отчёты. Пакет фиксирует версии библиотек, нужные выпущенным моделям, включая LightGBM. Если после переобучения выбрана модель CatBoost или XGBoost, проверьте её версию в метаданных и установите соответствующую библиотеку из `requirements-train.txt`.

`download_data.py zenodo` получает только нужные CSV из закреплённого релиза 1.10. Для отдельных стран укажите `--countries FR IT DE` и при необходимости `--crop wheat`. Для крупных стран или полной копии вручную скачайте `cybench-data.zip` и передайте архив через `python prepare_data.py --input /path/to/cybench-data.zip --output data/processed/full.csv`. Допускается также путь к распакованной структуре. Новый набор должен содержать по одному файлу `yield`, `crop_calendar`, `meteo`, `soil` и `location` для пары «культура–страна» с совместимыми идентификаторами регионов. При добавлении страны проверьте целевой регион, качество меток, календарь и LOCO, затем обновите артефакты. [CY-Bench v1.10](https://zenodo.org/records/17279151) · [официальный sample](https://github.com/WUR-AI/sample_data/tree/b55e6918de1e1fa1b998966f6014b578cd36b83b).

## Результаты и ограничения

- [Анализ данных](reports/data_analysis.md).
- [Эксперименты](reports/experiments.md) и [оценка моделей](reports/model_evaluation.md).
- [Сравнение на независимом тесте](artifacts/metrics/test_comparison.csv), [все запуски настройки](artifacts/metrics/validation_comparison.csv), [графики](artifacts/figures).
- [Ограничения модели](reports/limitations.md), [артефакты моделей и схемы](src/yield_prediction/models).

Цитируйте Kallenberg et al., *CY-Bench: a comprehensive benchmark dataset for sub-national crop yield forecasting* и источник соответствующей национальной статистики. Релиз Zenodo указывает EUPL-1.2 и условия цитирования включённых источников. [Статья](https://doi.org/10.5194/essd-18-3997-2026) · [Релиз и лицензия](https://zenodo.org/records/17279151).
