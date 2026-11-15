"""Chronological evaluation with an explicit label availability embargo."""

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error

from .features import TARGET
from .models import YieldHistory

DATE_COLUMNS = [
    "season_start", "season_end", "pre_forecast_date", "midpoint", "mid_weather_cutoff",
    "mid_weather_through", "climate_through",
]


def read_prepared(path):
    frame = pd.read_csv(path, dtype={"adm_id": str}, parse_dates=DATE_COLUMNS)
    # pandas returns object when a date column is entirely missing.
    for column in DATE_COLUMNS:
        frame[column] = pd.to_datetime(frame[column])
    return frame


def eligible(data, mode):
    mask = data.climate_seasons.ge(2)
    if mode == "mid_season":
        mask &= data.mid_weather_through.notna()
    return data.loc[mask].copy()


def make_fold(raw, mode, test, training_cap=None, excluded_country=None, learning_size=None,
              fit_countries=None):
    if test.empty:
        raise ValueError("Empty evaluation window")
    date = "pre_forecast_date" if mode == "pre_season" else "midpoint"
    origin = test[date].min()
    max_year = min(int(test.harvest_year.min()) - 1, origin.year - 1 - (origin.month < 7))
    if training_cap is not None:
        max_year = min(max_year, training_cap)
    past = raw.loc[raw.harvest_year.le(max_year) & raw.country_code.ne(excluded_country)]
    if fit_countries is not None:
        past = past.loc[past.country_code.isin(fit_countries)]
    training = eligible(past, mode)
    if learning_size is not None:
        # Interleave crop strata so every shared model and member sees both crops.
        training = training.sort_values(["harvest_year", "country_code", "adm_id"],
                                        ascending=[False, True, True])
        strata = training.groupby("crop")
        priority = (strata.cumcount() + 1) / strata.crop.transform("size")
        training = training.loc[priority.sort_values(kind="stable").index].head(learning_size)
    if training.empty:
        raise ValueError("Empty embargoed training window")
    # The learning curve changes the fitted sample size, while the label archive
    # available as of the forecast origin is held fixed.
    history = YieldHistory(past)
    return history.add(training, mode), history.add(test, mode), history


def score(observed, predicted):
    observed = np.asarray(observed)
    predicted = np.asarray(predicted)
    if not len(observed):
        raise ValueError("No evaluation rows")
    r2 = None if len(observed) < 2 or np.all(observed == observed[0]) else r2_score(observed, predicted)
    return {
        "n": len(observed), "mae_t_ha": mean_absolute_error(observed, predicted),
        "rmse_t_ha": root_mean_squared_error(observed, predicted), "r2": r2,
        "bias_t_ha": float(np.mean(predicted - observed)),
    }


def scores_by_group(predictions, by):
    rows = []
    for value, partition in predictions.groupby(by):
        rows.append({by: value, **score(partition[TARGET], partition.predicted_yield_t_ha)})
    return rows
