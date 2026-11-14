"""Train, select and audit seasonal models without using test scores for selection."""

import json
from importlib.metadata import version
from pathlib import Path
import platform
from time import perf_counter

import joblib
import numpy as np
import pandas as pd

from .data import file_hash
from .features import CLIMATE, GEO, KEY, TARGET
from .models import HISTORY, fit_model, forecast
from .validation import eligible, make_fold, score, scores_by_group

FAMILIES = ["ridge", "hist", "cat", "xgb", "lgbm"]
BASELINES = [{"name": family, "family": family} for family in ("crop_median", "region_median")]
ALGORITHMS = {"ridge": "Ridge", "hist": "HistGradientBoosting", "cat": "CatBoost",
              "xgb": "XGBoost", "lgbm": "LightGBM"}
RUNTIME = ["numpy", "pandas", "scipy", "scikit-learn", "joblib", "threadpoolctl"]


def dump_json(output, data):
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def run_fit(spec, fold, mode, crop, seed):
    train, test, history = fold
    if not spec.get("shared", False):
        train = train.loc[train.crop.eq(crop)]
    start = perf_counter()
    model = fit_model(spec, train, mode, seed, crop)
    seconds = perf_counter() - start
    prediction = forecast(model, test, history.crop_medians)
    return prediction, model, seconds


def candidates(families, shared=True):
    separate = [{"name": family, "family": family, "geo": True, "history": True} for family in families]
    # Ablations measure whether coordinates and the regional yield history help.
    separate += [
        {"name": "hist_no_geo", "family": "hist", "history": True},
        {"name": "hist_climate_soil", "family": "hist"},
        {"name": "hist_climate_soil_geo", "family": "hist", "geo": True},
        {"name": "ridge_history_residual", "family": "ridge", "geo": True, "residual": True},
        {"name": "hist_history_residual", "family": "hist", "geo": True, "residual": True},
    ]
    if "cat" in families:
        separate.append({"name": "cat_history_residual", "family": "cat", "geo": True, "residual": True})
    shared_specs = [
        {"name": f"{family}_shared", "family": family, "geo": True, "history": True, "shared": True}
        for family in families
    ] if shared else []
    return [*BASELINES, *separate, *shared_specs]


def evaluate_candidates(folds, mode, crop, config, families, trials, shared):
    predictions = {}
    results = []

    def evaluate(spec):
        y, p, fold_stats = [], [], []
        for fold in folds:
            train, test, _ = fold
            pred, model, seconds = run_fit(spec, fold, mode, crop, config["seed"])
            fold_stats.append({"evaluation_year": int(test.harvest_year.iloc[0]),
                               "last_fit_year": int(train.loc[train.crop.eq(crop) | spec.get(
                                   "shared", False), "harvest_year"].max()),
                               "n_fit": model["fit_rows"], "fit_seconds": seconds,
                               "feature_count": len(model["columns"]), **score(test[TARGET], pred)})
            y.append(test[TARGET].to_numpy())
            p.append(pred)
        predictions[spec["name"]] = np.concatenate(p)
        record = {"spec": spec, "folds": fold_stats, **{
            f"validation_{key}": value for key, value in score(np.concatenate(y), np.concatenate(p)).items()
        }}
        results.append(record)
        return record

    for spec in candidates(families, shared):
        evaluate(spec)
    if trials:
        from .tuning import tune

        best_by_family = {}
        for record in sorted(results, key=lambda r: r["validation_mae_t_ha"]):
            spec = record["spec"]
            if spec["family"] in families and not spec.get("shared") and not spec.get("residual"):
                best_by_family.setdefault(spec["family"], spec)
        for spec in list(best_by_family.values())[:config["tuned_families"]]:
            tune(spec, config["seed"], trials, evaluate)

    individual = sorted(results, key=lambda r: r["validation_mae_t_ha"])
    first = individual[0]
    second = next((row for row in individual[1:]
                   if row["spec"]["family"] != first["spec"]["family"]), None)
    if second:
        members = [first["spec"], second["spec"]]
        actuals = np.concatenate([fold[1][TARGET] for fold in folds])
        first_pred, second_pred = (predictions[spec["name"]] for spec in members)
        weight = min((0.25, 0.5, 0.75), key=lambda w: np.abs(
            actuals - (w * first_pred + (1 - w) * second_pred)).mean())
        mixed = weight * first_pred + (1 - weight) * second_pred
        slices = np.cumsum([len(fold[1]) for fold in folds])[:-1]
        better_folds = sum(
            np.abs(a - mix).mean() < np.abs(a - solo).mean()
            for a, mix, solo in zip(np.split(actuals, slices), np.split(mixed, slices),
                                    np.split(first_pred, slices))
        )
        record = evaluate({"name": "weighted_ensemble", "family": "ensemble", "weights": [weight, 1 - weight],
                           "members": members, "shared": any(member.get("shared") for member in members)})
        record["selectable"] = (better_folds >= min(2, len(folds)) and
                                 record["validation_mae_t_ha"] < first["validation_mae_t_ha"] * 0.995)
    base = next(row["validation_mae_t_ha"] for row in results if row["spec"]["family"] == "region_median")
    for row in results:
        row["relative_mae_vs_region_median"] = 1 - row["validation_mae_t_ha"] / base
    return sorted(results, key=lambda row: row["validation_mae_t_ha"])


def weight_year_quantile(residuals, years, level=0.9):
    """Equal total weight per harvest-year block, using the weighted order statistic."""
    frame = pd.DataFrame({"residual": np.abs(residuals), "year": np.asarray(years)})
    frame["weight"] = 1 / frame.groupby("year").year.transform("size") / frame.year.nunique()
    ordered = frame.sort_values("residual")
    return float(ordered.loc[ordered.weight.cumsum().ge(level), "residual"].iloc[0])


def selection_record(results):
    return next(row for row in results if row.get("selectable", True))


def runtime(model):
    families = {model["spec"]["family"]}
    for member in model.get("members", []):
        families.add(member["spec"]["family"])
    libraries = RUNTIME + [ALGORITHMS[family].lower() for family in ("cat", "xgb", "lgbm") if family in families]
    return {"python": platform.python_version(), **{library: version(library) for library in libraries}}


def model_schema(train, model, mode):
    columns = [col for col in model["columns"] if col not in [*HISTORY, "crop"]]
    # Even a history baseline uses the same regime and input provenance checks.
    from .features import MODE_FEATURES

    accepted = MODE_FEATURES[mode]
    quantiles = train[accepted].quantile([0, 0.01, 0.99, 1]).transpose()
    ranges = {col: [float(v) for v in values] for col, values in quantiles.dropna().iterrows()}
    return {"columns": columns, "accepted_features": accepted, "range_min_p01_p99_max": ranges}


def prediction_table(test, prediction, baseline):
    return test[KEY + [TARGET, "climate_precipitation_mm", HISTORY[0]]].assign(
        predicted_yield_t_ha=prediction, regional_baseline_t_ha=baseline,
    )


def date_frame(value):
    return pd.Timestamp(value).date().isoformat()


def build_payload(row, mode):
    from .features import MODE_FEATURES

    values = {col: float(row[col]) if pd.notna(row[col]) else None for col in MODE_FEATURES[mode]}
    timing = {col: date_frame(row[col]) for col in ("season_start", "season_end", "climate_through")}
    if mode == "mid_season":
        timing["mid_weather_through"] = date_frame(row.mid_weather_through)
        values["mid_weather_coverage"] = float(row.mid_weather_coverage)
    return {"country_code": row.country_code, "adm_id": row.adm_id, "harvest_year": int(row.harvest_year),
            "climate_seasons": int(row.climate_seasons), **timing, **values}


def write_bundle(bundle, name, directory):
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"{name}.joblib"
    temporary = target.with_suffix(".tmp")
    joblib.dump(bundle, temporary, compress=3)
    temporary.replace(target)
    dump_json(directory / f"{name}.json", {**bundle["metadata"], "artifact_sha256": file_hash(target)})


def spatial_validation(data, mode, crop, config):
    rows = []
    end = config["legacy_test_end"]
    for country, subset in eligible(data, mode).loc[lambda f: f.crop.eq(crop)].groupby("country_code"):
        if subset.harvest_year.max() < 2007:
            continue
        last = min(end, int(subset.harvest_year.max()))
        tests = subset.loc[subset.harvest_year.between(last - 2, last)]
        if len(tests) < config["minimum_LOCO_test_rows"]:
            continue
        fold = make_fold(data, mode, tests, excluded_country=country)
        assert not fold[0].country_code.eq(country).any()
        for spec in (BASELINES[0], {"name": "ridge_no_geo", "family": "ridge"},
                     {"name": "hist_no_geo", "family": "hist"},
                     {"name": "hist_geo", "family": "hist", "geo": True}):
            p, model, seconds = run_fit(spec, fold, mode, crop, config["seed"])
            rows.append({"country_code": country, "model": spec["name"], "n_fit": model["fit_rows"],
                         "fit_seconds": seconds, "first_test_year": int(tests.harvest_year.min()),
                         "last_test_year": int(tests.harvest_year.max()), **score(tests[TARGET], p)})
    return rows


def learn_curve(data, test, spec, mode, crop, config):
    result = []
    base = data if spec.get("shared") else data.loc[data.crop.eq(crop)]
    for n in [*config["learning_sizes"], None]:
        fold = make_fold(base, mode, test, config["last_training_year"], learning_size=n)
        if n is not None and len(fold[0]) < n:
            continue
        p, model, seconds = run_fit(spec, fold, mode, crop, config["seed"])
        result.append({"training_size": len(fold[0]), "all": n is None, "fit_seconds": seconds,
                       "n_fit": model["fit_rows"], **score(test[TARGET], p)})
    return result


def group_validation_frame(table, definitions):
    return {column: scores_by_group(table.assign(**values), column) for column, values in definitions.items()}


def run(data, mode, crop, config, families, trials, output, models, dataset_meta, diagnostics=True):
    seed = config["seed"]
    cases = eligible(data, mode).loc[lambda f: f.crop.eq(crop)]
    tests = cases.loc[cases.harvest_year.between(config["first_test_year"], config["last_test_year"])]
    if tests.empty:
        raise ValueError(f"No test rows for {crop}/{mode}, check dataset/config")
    print(f"{mode}/{crop}: temporal validation", flush=True)
    folds = [make_fold(data, mode, cases.loc[cases.harvest_year.eq(year)])
             for year in config["validation_years"]]
    ranks = evaluate_candidates(folds, mode, crop, config, families, trials, data.crop.nunique() > 1)
    selected = selection_record(ranks)
    spec = selected["spec"]
    fold = make_fold(data, mode, tests, config["last_training_year"])
    train, test, history = fold
    test_results = []
    predictions_by_name = {}
    print(f"{mode}/{crop}: selected {spec['name']}, evaluating frozen test", flush=True)
    # Report every fitted candidate on validation; freeze one test candidate per algorithm or design.
    published = [row for row in ranks if "_trial_" not in row["spec"]["name"] or row is selected]
    model = None
    for row in published:
        p, fitted, seconds = run_fit(row["spec"], fold, mode, crop, seed)
        test_results.append({"name": row["spec"]["name"], "fit_seconds": seconds,
                             "feature_count": len(fitted["columns"]), "n_fit": fitted["fit_rows"],
                             **score(test[TARGET], p)})
        predictions_by_name[row["spec"]["name"]] = p
        if row is selected:
            model = fitted
    prediction = predictions_by_name[spec["name"]]
    base = predictions_by_name["region_median"]
    baseline_score = score(test[TARGET], base)["mae_t_ha"]
    for row in test_results:
        row["relative_mae_vs_region_median"] = 1 - row["mae_t_ha"] / baseline_score
    selected_metrics = next(row for row in test_results if row["name"] == spec["name"])
    reference = prediction_table(test, prediction, base)
    prediction_path = output / "predictions" / f"{crop}_{mode}.csv"
    prediction_path.parent.mkdir(parents=True, exist_ok=True)
    reference.to_csv(prediction_path, index=False)

    origin = test["pre_forecast_date" if mode == "pre_season" else "midpoint"].min()
    fit_data = train if spec.get("shared") else train.loc[train.crop.eq(crop)]
    representative = fit_data.loc[fit_data.crop.eq(crop)]
    rich_fit = representative[HISTORY[0]].notna()
    dry_bound = representative.climate_precipitation_mm.quantile(0.2)
    low, high = representative[TARGET].quantile([0.2, 0.8])
    groups = group_validation_frame(reference, {
        "country_code": {}, "harvest_year": {},
        "yield_group": {"yield_group": np.select([reference[TARGET].lt(low), reference[TARGET].gt(high)],
                                                 ["low_yield", "high_yield"], default="middle")},
        "climate_group": {"climate_group": np.where(reference.climate_precipitation_mm.le(dry_bound),
                                                    "driest_training_quintile", "other")},
        "region_history": {"region_history": np.where(test[HISTORY[0]].notna().to_numpy(),
                                                      "available", "missing")},
    })

    legacy = cases.loc[cases.harvest_year.between(config["legacy_training_end"] + 1, config["legacy_test_end"])]
    if legacy.empty:
        legacy_results = []
        uncertainty = {"status": "withheld", "reason": "No retrospective calibration seasons"}
    else:
        legacy_fold = make_fold(data, mode, legacy, config["legacy_training_end"])
        retro_p, _, _ = run_fit(spec, legacy_fold, mode, crop, seed)
        retro_base, _, _ = run_fit(BASELINES[1], legacy_fold, mode, crop, seed)
        legacy_results = [{"name": spec["name"], **score(legacy[TARGET], retro_p)},
                          {"name": "region_median", **score(legacy[TARGET], retro_base)}]
        es = legacy.country_code.eq("ES")
        if crop == "maize" and es.any():
            legacy_results += [
                {"name": f"{spec['name']}_ES", **score(legacy.loc[es, TARGET], retro_p[es])},
                {"name": "region_median_ES", **score(legacy.loc[es, TARGET], retro_base[es])},
            ]
        # Descriptive interval only: equal year weights after pooling spatially dependent rows.
        calibration = ~legacy.country_code.eq("ES") if crop == "maize" else np.ones(len(legacy), dtype=bool)
        radius = weight_year_quantile(legacy.loc[calibration, TARGET] - retro_p[calibration],
                                      legacy.loc[calibration, "harvest_year"])
        covered = np.abs(test[TARGET].to_numpy() - prediction) <= radius
        bounds = (np.maximum(0, prediction - radius), prediction + radius)
        uncertainty = {
            "status": "withheld", "reason": "Only three retrospective year blocks and limited future-country coverage",
            "nominal_empirical_quantile": 0.9, "radius_t_ha": radius,
            "calibration_countries": sorted(legacy.loc[calibration, "country_code"].unique()),
            "calibration_years": sorted(legacy.loc[calibration, "harvest_year"].unique().tolist()),
            "calibration_rows": int(np.sum(calibration)), "test_coverage": float(np.mean(covered)),
            "test_mean_width_t_ha": float(np.mean(bounds[1] - bounds[0])),
            "test_country_year_coverage": [
                {"country": key[0], "year": int(key[1]), "n": len(block), "coverage": block.covered.mean()}
                for key, block in test.assign(covered=covered).groupby(["country_code", "harvest_year"])
            ],
        }
        path = output / "predictions" / f"{crop}_{mode}_2018_2020.csv"
        prediction_table(legacy_fold[1], retro_p, retro_base).to_csv(path, index=False)

    metadata = {
        "crop": crop, "mode": mode, "selected_model": spec["name"], "selection": spec,
        "model_version": f"1.0.0+{dataset_meta['dataset_sha256'][:10]}",
        "spatial_level": "administrative_region", "schema": model_schema(representative, model, mode),
        "origin_date": date_frame(origin), "fit_max_year": int(train.harvest_year.max()),
        "last_test_year": int(test.harvest_year.max()),
        "training_rows": len(representative), "train_regions": int(representative.adm_id.nunique()),
        "history_fraction": float(rich_fit.mean()), "countries": sorted(representative.country_code.unique()),
        "country_regions": {key: sorted(group.adm_id.unique()) for key, group in representative.groupby("country_code")},
        "runtime": runtime(model), "dataset": dataset_meta, "test": selected_metrics,
        "interval_status": uncertainty["status"],
    }
    write_bundle({"model": model, "history": history.snapshot(origin, crop), "metadata": metadata},
                 f"{crop}_{mode}", models)
    example = test.iloc[0]
    dump_json(output / "examples" / f"{crop}_{mode}.json", {
        "features": build_payload(example, mode), "crop": crop, "mode": mode,
        "observed_yield_t_ha": float(example[TARGET]), "expected_yield_t_ha": float(prediction[0]),
    })

    learning, loco, importance = [], [], []
    if diagnostics:
        print(f"{mode}/{crop}: learning curve and leave-one-country-out", flush=True)
        learning = learn_curve(data, tests, spec, mode, crop, config)
        loco = spatial_validation(data, mode, crop, config)
        rng = np.random.default_rng(seed)
        for col in model["columns"]:
            if col == "crop":
                continue
            delta = []
            for repeat in range(3):
                shuffled = test.copy()
                # Shuffle within harvest year, preserving the test's year mixture.
                shuffled[col] = shuffled.groupby("harvest_year")[col].transform(
                    lambda column: rng.permutation(column.to_numpy()))
                delta.append(score(test[TARGET], forecast(model, shuffled, history.crop_medians))["mae_t_ha"]
                             - selected_metrics["mae_t_ha"])
            importance.append({"feature": col, "mae_increase_t_ha": float(np.mean(delta))})
        importance.sort(key=lambda row: row["mae_increase_t_ha"], reverse=True)
    report = {"metadata": metadata, "validation": ranks, "test": test_results, "legacy": legacy_results,
              "test_countries": sorted(test.country_code.unique()), "test_years": sorted(test.harvest_year.unique().tolist()),
              "test_regions": int(test.adm_id.nunique()), "groups": groups, "learning_curve": learning,
              "loco": loco, "permutation_importance": importance, "uncertainty": uncertainty}
    dump_json(output / "metrics" / f"{crop}_{mode}.json", report)
    print(f"{mode}/{crop}: {spec['name']} MAE {selected_metrics['mae_t_ha']:.3f}", flush=True)
    return report
