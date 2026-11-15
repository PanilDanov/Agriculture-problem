"""Country-and-time blocked comparisons for preseason and midseason forecasts."""

from time import perf_counter

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from .features import CLIMATE, GEO, KEY, MID, MODE_FEATURES, TARGET
from .models import HISTORY, fit_model, forecast
from .validation import eligible, make_fold, score

CROPS = ("maize", "wheat")
COLD = "cold_start_pre_season"
PRE = "pre_season"
MID_MODE = "mid_season"
FAMILIES = ("ridge", "hist", "cat", "xgb", "lgbm")
SMALL = {
    "ridge": {"alpha": 40},
    "hist": {"max_iter": 110, "max_leaf_nodes": 15},
    "cat": {"iterations": 130, "depth": 5},
    "xgb": {"n_estimators": 120, "max_depth": 4},
    "lgbm": {"n_estimators": 120, "max_depth": 5},
}
REGULAR = {
    "ridge": {"alpha": 150},
    "hist": {"max_iter": 190, "max_leaf_nodes": 23, "l2_regularization": 9},
    "cat": {"iterations": 220, "depth": 6},
    "xgb": {"n_estimators": 200, "max_depth": 5},
    "lgbm": {"n_estimators": 200, "max_depth": 6},
}


def temporal_upper_bound(date, first_year):
    return min(first_year - 1, date.year - 1 - (date.month < 7))


def group_splits(data, evaluation, folds, mode):
    for _, index in GroupKFold(folds).split(evaluation, groups=evaluation.country_code):
        test = evaluation.iloc[index]
        countries = sorted(test.country_code.unique())
        # Remove every row for a held-out country from both crop tasks and history.
        raw_train = data.loc[~data.country_code.isin(countries)]
        date_column = "pre_forecast_date" if mode == PRE else "midpoint"
        cutoff = temporal_upper_bound(test[date_column].min(), int(test.harvest_year.min()))
        allowed = raw_train.loc[raw_train.harvest_year.le(cutoff)]
        train = eligible(allowed, mode)
        if train.empty or test.crop.nunique() != 2 or train.crop.nunique() != 2:
            raise ValueError("The split must cover both crops in train and evaluation")
        yield train, test, {"fit_max_year": cutoff, "countries": countries,
                           "train_countries": sorted(train.country_code.unique()), "train_rows": len(train),
                           "first_forecast": test[date_column].min().date().isoformat(),
                           "evaluation_rows": len(test)}


def spec(family, geo=False, shared=False, params=None, **kw):
    name = family + ("_geo" if geo else "_no_geo") + ("_shared" if shared else "_separate")
    return {"name": name, "family": family, "geo": geo, "shared": shared,
            "params": dict(params or {}), **kw}


def cold_candidates():
    return [spec(f, geo, shared, SMALL[f]) for f in FAMILIES for geo in (False, True)
            for shared in (False, True)]


def attach_prediction(test, predicted, medians):
    return test[KEY + [TARGET, "climate_precipitation_mm", "climate_temperature_c"]].assign(
        prediction=predicted, baseline=test.crop.map(medians),
    )


def compare(train, test, candidate, mode, seed, baseline=None):
    blocks, fits = [], {}
    medians = train.groupby("crop")[TARGET].median()
    shared_fit = None
    for crop, cases in test.groupby("crop"):
        labels = train if candidate.get("shared") else train.loc[train.crop.eq(crop)]
        start = perf_counter()
        if shared_fit is None:
            model = fit_model(candidate, labels, mode, seed, crop)
            if candidate.get("shared"):
                shared_fit = model
        else:
            model = shared_fit
        duration = perf_counter() - start
        result = attach_prediction(cases, forecast(model, cases, medians), medians)
        if baseline is not None:
            result["baseline"] = baseline.loc[cases.index]
        blocks.append(result.assign(fit_seconds=duration))
        fits[crop] = model
    return pd.concat(blocks).sort_index(), fits


def summarize(predictions):
    groups = []
    for country, group in predictions.groupby("country_code"):
        result = score(group[TARGET], group.prediction)
        baseline = score(group[TARGET], group.baseline)
        groups.append({"country_code": country, **result, "baseline_mae_t_ha": baseline["mae_t_ha"],
                       "gain_t_ha": baseline["mae_t_ha"] - result["mae_t_ha"]})
    summary = score(predictions[TARGET], predictions.prediction)
    errors = np.asarray([row["mae_t_ha"] for row in groups])
    gains = np.asarray([row["gain_t_ha"] for row in groups])
    return {**summary, "baseline_mae_t_ha": score(predictions[TARGET], predictions.baseline)["mae_t_ha"],
            "country_median_mae_t_ha": np.median(errors), "country_mean_mae_t_ha": np.mean(errors),
            "country_mean_baseline_mae_t_ha": np.mean([r["baseline_mae_t_ha"] for r in groups]),
            "share_countries_better": np.mean(gains > 0), "by_country": groups}


def rank(rows, crop):
    return sorted(rows, key=lambda row: (
        row["scores"][crop]["country_mean_mae_t_ha"],
        -row["scores"][crop]["share_countries_better"],
        abs(row["scores"][crop]["bias_t_ha"]),
    ))


def cold_search(folds, seed, progress=print):
    ranks = []
    configurations = cold_candidates()

    def evaluate(candidate):
        blocks = [compare(train, test, candidate, PRE, seed)[0] for train, test, _ in folds]
        predictions = pd.concat(blocks)
        row = {"spec": candidate,
               "fit_seconds": sum(block.groupby("crop").fit_seconds.first().sum() for block in blocks),
               "scores": {crop: summarize(group) for crop, group in predictions.groupby("crop")}}
        ranks.append(row)
        return row

    for candidate in configurations:
        evaluate(candidate)
    top = {rank(ranks, crop)[0]["spec"]["name"] for crop in CROPS}
    for candidate in configurations:
        if candidate["name"] in top:
            evaluate({**candidate, "name": candidate["name"] + "_regular",
                      "params": REGULAR[candidate["family"]]})
    progress("Cold-start inner winners: " + ", ".join(rank(ranks, crop)[0]["spec"]["name"] for crop in CROPS))
    return ranks


def cold_nested(data, config):
    dataset = eligible(data, PRE)
    outer_rows = dataset.loc[dataset.harvest_year.between(*config["outer_years"])]
    results, evaluations = [], []
    for number, (train, test, outer) in enumerate(
        group_splits(data, outer_rows, config["outer_groups"], PRE), 1
    ):
        inner_rows = train.loc[train.harvest_year.isin(config["inner_years"])]
        inner = list(group_splits(train, inner_rows, config["inner_groups"], PRE))
        ranked = cold_search(inner, config["seed"])
        for crop in CROPS:
            winner = rank(ranked, crop)[0]["spec"]
            compared, _ = compare(train, test.loc[test.crop.eq(crop)], winner, PRE, config["seed"])
            results.append(compared.assign(outer_fold=number, model=winner["name"]))
        evaluations.append({"outer_fold": number, "outer": outer, "inner": [row[2] for row in inner],
                            "comparison": ranked})
    final_inner_rows = dataset.loc[dataset.harvest_year.isin(config["inner_years"])]
    final_folds = list(group_splits(data, final_inner_rows, config["inner_groups"], PRE))
    release_choices = cold_search(final_folds, config["seed"])
    return pd.concat(results, ignore_index=True), evaluations, release_choices, [r[2] for r in final_folds]


def mid_candidates():
    options = [{"name": "regional_median", "family": "region_median"}]
    options += [spec(family, geo=True, history=True, params=SMALL[family]) for family in FAMILIES]
    options += [
        spec("ridge", history=True, params=REGULAR["ridge"]) | {"name": "ridge_regular_no_geo"},
        spec("hist", history=True, params=REGULAR["hist"]) | {"name": "hist_regular_no_geo"},
        spec("hist", geo=True, residual=True, params=SMALL["hist"]) | {"name": "hist_residual"},
        spec("hist", geo=True, params=SMALL["hist"]) | {"name": "hist_no_history"},
        spec("hist", geo=True, history=True, params=SMALL["hist"], omit=MID) | {"name": "hist_no_current_weather"},
        spec("hist", geo=True, history=True, params=SMALL["hist"], omit=CLIMATE) | {"name": "hist_no_climate"},
        spec("hist", history=True, params=SMALL["hist"]) | {"name": "hist_no_coordinates"},
    ]
    return options


def mid_temporal(data, config):
    rows = eligible(data, MID_MODE)
    folds = [make_fold(data, MID_MODE, rows.loc[rows.harvest_year.eq(year)])
             for year in config["mid_temporal_validation_years"]]
    late = make_fold(data, MID_MODE, rows.loc[rows.harvest_year.between(*config["mid_temporal_test_years"])])
    records, test_frames, selected = {}, [], {}
    for crop in CROPS:
        validation = []
        for candidate in mid_candidates():
            parts = []
            for train, test, history in folds:
                cases = test.loc[test.crop.eq(crop)]
                baseline = cases[HISTORY[0]].fillna(cases.crop.map(history.crop_medians))
                parts.append(compare(train, cases, candidate, MID_MODE, config["seed"], baseline)[0])
            errors = summarize(pd.concat(parts))
            validation.append({"spec": candidate, "metrics": errors})
        winner = min(validation, key=lambda row: row["metrics"]["country_mean_mae_t_ha"])["spec"]
        train, test, history = late
        cases = test.loc[test.crop.eq(crop)]
        baseline = cases[HISTORY[0]].fillna(cases.crop.map(history.crop_medians))
        holdout = []
        for row in validation:
            candidate = row["spec"]
            frame, fits = compare(train, cases, candidate, MID_MODE, config["seed"], baseline)
            holdout.append({"name": candidate["name"], **summarize(frame)})
            test_frames.append(frame.assign(model=candidate["name"]))
            if candidate == winner:
                selected[crop] = (fits[crop], history, cases, train)
        records[crop] = {"validation": validation, "winner": winner, "holdout": holdout,
                         "train_rows": int(train.crop.eq(crop).sum()), "fit_max_year": int(train.harvest_year.max()),
                         "validation_splits": [{"year": int(test.harvest_year.iloc[0]),
                                                "train_last_year": int(train.harvest_year.max()),
                                                "cases": int(test.crop.eq(crop).sum())} for train, test, _ in folds]}
        chosen = next(row for row in holdout if row["name"] == winner["name"])
        print(f"{crop} temporal mid-season: {winner['name']}, MAE {chosen['mae_t_ha']:.3f}", flush=True)
    return records, pd.concat(test_frames, ignore_index=True), selected


def mid_spatial(data, config):
    """Nested midseason evaluation with absent regional yield for held-out countries."""
    rows = eligible(data, MID_MODE)
    outer_rows = rows.loc[rows.harvest_year.between(*config["outer_years"])]
    candidates = [spec(family, geo=geo, params=SMALL[family])
                  for family in FAMILIES for geo in (False, True)]
    candidates += [spec("hist", geo=True, params=SMALL["hist"], omit=MID) |
                   {"name": "hist_without_current_weather"}]
    results, predictions = [], []
    for number, (train, test, outer) in enumerate(
        group_splits(data, outer_rows, config["outer_groups"], MID_MODE), 1
    ):
        inner_rows = train.loc[train.harvest_year.isin(config["inner_years"])]
        inner = list(group_splits(train, inner_rows, config["inner_groups"], MID_MODE))
        scores = []
        for candidate in candidates:
            predicted = pd.concat([compare(a, b, candidate, MID_MODE, config["seed"])[0]
                                   for a, b, _ in inner])
            scores.append({"spec": candidate, "scores": {crop: summarize(p)
                           for crop, p in predicted.groupby("crop")}})
        winners = {}
        for crop in CROPS:
            winner = rank(scores, crop)[0]["spec"]
            winners[crop] = winner
            rows = test.loc[test.crop.eq(crop)]
            pred, _ = compare(train, rows, winner, MID_MODE, config["seed"])
            predictions.append(pred.assign(outer_fold=number, model=winner["name"]))
        results.append({"outer_fold": number, "outer": outer, "inner": [row[2] for row in inner],
                        "validation": scores, "winners": winners})
        print(f"Mid-season spatial fold {number}: " + ", ".join(value["name"] for value in winners.values()), flush=True)
    predictions = pd.concat(predictions, ignore_index=True)
    return {"folds": results, "scores": {crop: summarize(p) for crop, p in predictions.groupby("crop")}}, predictions
