"""Fold-local yield history and model construction."""

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .features import GEO, MODE_FEATURES, TARGET

HISTORY = ["regional_median_t_ha", "regional_recent_t_ha", "regional_history_count"]


class RegionalHistorySnapshot:
    """Sufficient regional statistics available at the model’s serving origin."""

    def __init__(self, records, crop_medians):
        self.records = records
        self.crop_medians = crop_medians

    def at(self, crop, country, region, forecast_date):
        return self.records.get((crop, country, region), [np.nan, np.nan, 0])


class YieldHistory:
    """Observed labels with an assumed release date of July 1 after harvest year."""

    def __init__(self, training):
        ordered = training.sort_values("harvest_year")
        self.groups = {}
        for row in ordered.itertuples():
            key = (row.crop, row.country_code, row.adm_id)
            self.groups.setdefault(key, []).append((row.harvest_year, getattr(row, TARGET)))
        self.crop_medians = ordered.groupby("crop")[TARGET].median().to_dict()

    def at(self, crop, country, region, forecast_date):
        # Current crop and year are excluded by construction. July is a proxy, not a release archive.
        year_limit = forecast_date.year - 1 - (forecast_date.month < 7)
        rows = self.groups.get((crop, country, region), ())
        values = [value for year, value in rows if year <= year_limit]
        if not values:
            return [np.nan, np.nan, 0]
        return [float(np.median(values)), float(np.median(values[-5:])), len(values)]

    def add(self, data, mode):
        date_col = "pre_forecast_date" if mode == "pre_season" else "midpoint"
        rows = [
            self.at(crop, country, region, date)
            for crop, country, region, date in data[["crop", "country_code", "adm_id", date_col]].itertuples(
                index=False, name=None
            )
        ]
        return data.assign(**dict(zip(HISTORY, np.asarray(rows).reshape(-1, len(HISTORY)).T)))

    def snapshot(self, origin, crop):
        return RegionalHistorySnapshot(
            {key: self.at(*key, origin) for key in self.groups if key[0] == crop},
            {crop: self.crop_medians[crop]},
        )


def columns_for(spec, mode):
    columns = list(MODE_FEATURES[mode])
    if not spec.get("geo", False):
        columns = [column for column in columns if column not in GEO]
    if spec.get("history", False):
        columns += HISTORY
    if spec.get("shared", False):
        columns += ["crop"]
    return [column for column in columns if column not in spec.get("omit", ())]


def make_estimator(family, params, seed):
    if family == "ridge":
        return Ridge(**{"alpha": 10, **params})
    if family == "hist":
        return HistGradientBoostingRegressor(**{
            "max_iter": 180, "max_leaf_nodes": 15, "learning_rate": 0.055,
            "min_samples_leaf": 25, "l2_regularization": 4, "early_stopping": False,
            "random_state": seed, **params,
        })
    if family == "cat":
        from catboost import CatBoostRegressor

        return CatBoostRegressor(**{
            "iterations": 320, "depth": 6, "learning_rate": 0.06, "l2_leaf_reg": 6,
            "loss_function": "MAE", "verbose": False, "thread_count": 2,
            "allow_writing_files": False, "random_seed": seed, **params,
        })
    if family == "xgb":
        from xgboost import XGBRegressor

        return XGBRegressor(**{
            "n_estimators": 280, "max_depth": 5, "learning_rate": 0.055, "reg_lambda": 5,
            "subsample": 0.85, "colsample_bytree": 0.85, "objective": "reg:absoluteerror",
            "tree_method": "hist", "n_jobs": 2, "random_state": seed, **params,
        })
    if family == "lgbm":
        from lightgbm import LGBMRegressor

        return LGBMRegressor(**{
            "n_estimators": 260, "num_leaves": 23, "max_depth": 6, "learning_rate": 0.055,
            "reg_lambda": 5, "subsample": 0.85, "subsample_freq": 1,
            "objective": "regression_l1", "verbosity": -1, "n_jobs": 2,
            "random_state": seed, "deterministic": True, "force_col_wise": True, **params,
        })
    raise ValueError(f"Unknown family {family}")


def fit_model(spec, data, mode, seed, crop):
    family = spec["family"]
    if family == "crop_median":
        estimator = DummyRegressor(strategy="median")
        estimator.fit(data[["season_days"]], data[TARGET])
        return {"spec": spec, "pipeline": estimator, "columns": ["season_days"], "fit_rows": len(data)}
    if family == "region_median":
        return {"spec": spec, "pipeline": None, "columns": [HISTORY[0]], "fit_rows": len(data)}
    if family == "ensemble":
        members = [
            fit_model(member, data if member.get("shared") else data.loc[data.crop.eq(crop)], mode, seed, crop)
            for member in spec["members"]
        ]
        return {"spec": spec, "members": members, "fit_rows": len(data),
                "columns": sorted({col for member in members for col in member["columns"]})}
    columns = columns_for(spec, mode)
    numeric = [col for col in columns if col != "crop"]
    numeric_pipeline = [("impute", SimpleImputer(strategy="median", keep_empty_features=True))]
    if family == "ridge":
        numeric_pipeline.append(("scale", StandardScaler()))
    transformers = [("numeric", Pipeline(numeric_pipeline), numeric)]
    if "crop" in columns:
        transformers.append(("crop", OneHotEncoder(handle_unknown="ignore", sparse_output=False), ["crop"]))
    preprocessor = ColumnTransformer(transformers, verbose_feature_names_out=False)
    # Preserve column names for LightGBM model validation and debugging.
    preprocessor.set_output(transform="pandas")
    estimator = Pipeline([
        ("preprocess", preprocessor), ("regressor", make_estimator(family, spec.get("params", {}), seed)),
    ])
    training = data
    if spec.get("residual", False):
        training = data.dropna(subset=[HISTORY[0]])
        target = training[TARGET] - training[HISTORY[0]]
        fallback = fit_model({"family": family, "geo": spec.get("geo", False),
                              "params": spec.get("params", {})}, data, mode, seed, crop)
        if training.empty:
            fallback["fit_rows"] = len(data)
            return fallback
    else:
        target = data[TARGET]
        fallback = None
    estimator.fit(training[columns], target)
    return {"spec": spec, "pipeline": estimator, "columns": columns,
            "fallback": fallback, "fit_rows": len(training)}


def forecast(model, data, crop_medians):
    spec = model["spec"]
    family = spec["family"]
    if family == "region_median":
        return data[HISTORY[0]].fillna(data.crop.map(crop_medians)).to_numpy()
    if family == "ensemble":
        return sum(weight * forecast(member, data, crop_medians)
                   for weight, member in zip(spec["weights"], model["members"]))
    if not spec.get("residual"):
        return np.maximum(0, model["pipeline"].predict(data[model["columns"]]))
    available = data[HISTORY[0]].notna()
    predictions = np.empty(len(data))
    if available.any():
        rows = data.loc[available]
        predictions[available] = model["pipeline"].predict(rows[model["columns"]]) + rows[HISTORY[0]]
    if (~available).any():
        predictions[~available] = forecast(model["fallback"], data.loc[~available], crop_medians)
    return np.maximum(0, predictions)
