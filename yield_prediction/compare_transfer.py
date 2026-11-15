"""Compare old and corrected models on identical regional seasons."""

import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

from yield_prediction.data import file_hash
from yield_prediction.experiment import dump_json, model_schema, runtime, write_bundle
from yield_prediction.features import KEY, TARGET
from yield_prediction.generalization import COLD, MID_MODE, PRE, attach_prediction, summarize
from yield_prediction.inference import load_bundle
from yield_prediction.models import HISTORY, fit_model, forecast
from yield_prediction.validation import eligible, make_fold, read_prepared

ROOT = Path(__file__).resolve().parent
NOVEL = {"maize": {"BF", "DK", "IN", "ML", "SN"}, "wheat": {"IE", "IN", "LT", "LV"}}
DIAGNOSTIC = {"maize": {"AR", "BR", "LS", "MW", "MZ", "NE", "US"}, "wheat": {"AR", "BR", "US"}}
SEED = 42


def input_history(rows, history, crop, mode):
    cutoff = "pre_forecast_date" if mode == PRE else "midpoint"
    values = [history.at(crop, country, region, day)
              for country, region, day in rows[["country_code", "adm_id", cutoff]].itertuples(index=False, name=None)]
    return rows.assign(**dict(zip(HISTORY, np.asarray(values).T)))


def fit_specific(data, test, spec, crop, mode):
    train, _, history = make_fold(data, mode, test, training_cap=2019)
    selected_train = train if spec.get("shared") else train.loc[train.crop.eq(crop)]
    return (fit_model(spec, selected_train, mode, SEED, crop), history,
            int(selected_train.harvest_year.max()), sorted(selected_train.country_code.unique()))


def evaluate(rows, variants, medians, mode):
    summary, frames = {}, []
    for name, model, history in variants:
        inputs = input_history(rows, history, rows.crop.iloc[0], mode) if history is not None else rows
        predictions = attach_prediction(rows, forecast(model, inputs, medians), medians)
        summary[name] = summarize(predictions)
        summary[name]["by_year"] = [
            {"harvest_year": int(year), **{k: v for k, v in summarize(group).items() if k != "by_country"}}
            for year, group in predictions.groupby("harvest_year")]
        summary[name]["by_country_year"] = [
            {"harvest_year": int(year), **summarize(group)["by_country"][0]}
            for (_, year), group in predictions.groupby(["country_code", "harvest_year"])]
        frames.append(predictions.assign(model=name))
    return summary, pd.concat(frames, ignore_index=True)


def inspect_domains(training, testing):
    features = [TARGET, "climate_temperature_c", "climate_precipitation_mm", "climate_vpd_kpa",
                "mid_temperature_c", "mid_precipitation_mm", "mid_et0_mm", "season_days"]
    rows = []
    for group in (training.assign(country_code="ALL_TRAINING"), testing):
        for country, frame in group.groupby("country_code"):
            stats = {}
            for name in features:
                values = frame[name].dropna()
                if not values.empty:
                    stats[name] = {"p05": values.quantile(.05), "median": values.median(), "p95": values.quantile(.95)}
            rows.append({"country_code": country, "n": len(frame), **stats})
    return rows


def compare(original, corrected, external, previous_models, fixed_models, dataset_hash):
    late = eligible(corrected, MID_MODE).loc[lambda f: f.harvest_year.between(2021, 2024)]
    all_results, all_predictions = {}, []
    for crop in sorted(external.crop.unique()):
        release = load_bundle(crop, MID_MODE)
        corrected_previous = joblib.load(previous_models / f"{crop}_mid_season.joblib")
        candidate = load_bundle(crop, "mid_season_v2")
        cold = load_bundle(crop, COLD)
        old_pre = load_bundle(crop, PRE)
        median = release["history"].crop_medians
        original_spec = release["metadata"]["selection"]
        previous_spec = corrected_previous["metadata"]["selection"]
        old_same, hist_old, _, _ = fit_specific(original, late, previous_spec, crop, MID_MODE)
        corrected_same, hist_corrected, _, _ = fit_specific(corrected, late, original_spec, crop, MID_MODE)
        frozen_origin = late.midpoint.min()
        fold_train, _, _ = make_fold(corrected, MID_MODE, late, training_cap=2019)
        representative = fold_train.loc[fold_train.crop.eq(crop)]
        fixed_metadata = {
            **release["metadata"],
            "model_version": f"1.1.0-mid-fixed+{dataset_hash[:10]}",
            "qualification": "corrected_frozen_specification_research_candidate",
            "origin_date": frozen_origin.date().isoformat(),
            "dataset": {"dataset_sha256": dataset_hash, "record": "https://zenodo.org/records/17279151"},
            "schema": model_schema(representative, corrected_same, MID_MODE),
            "runtime": runtime(corrected_same),
        }
        # Release metrics describe the published model, so the refit starts without that score.
        fixed_metadata.pop("test", None)
        write_bundle({"metadata": fixed_metadata, "model": corrected_same,
                      "history": hist_corrected.snapshot(frozen_origin, crop)},
                     f"{crop}_mid_season", fixed_models)
        expected_country = external.crop.eq(crop)
        diagnosis = external.loc[expected_country & external.country_code.isin(DIAGNOSTIC[crop])
                                 & external.harvest_year.ge(2021)]
        origin = pd.Timestamp(max(b["metadata"]["origin_date"]
                                  for b in (release, corrected_previous, candidate)))
        mid_rows = eligible(diagnosis, MID_MODE).loc[lambda frame: frame.midpoint.ge(origin)]
        decisions = {"diagnostic": {}, "novel": {}, "diagnostic_rows_before_eligibility": len(diagnosis)}
        if len(mid_rows):
            variants = [
                ("old_release", release["model"], release["history"]),
                ("corrected_training_same_old_spec", corrected_same, hist_corrected),
                ("old_training_same_reselected_spec", old_same, hist_old),
                ("corrected_reselected_legacy_procedure", corrected_previous["model"], corrected_previous["history"]),
                ("corrected_new_temporal_candidate", candidate["model"], candidate["history"]),
            ]
            summary, frames = evaluate(mid_rows, variants, median, MID_MODE)
            decisions["diagnostic"]["mid"] = summary
            all_predictions.append(frames.assign(stage="diagnostic_mid"))
            reference = eligible(corrected, MID_MODE).loc[
                lambda f: f.crop.eq(crop) & f.harvest_year.le(candidate["metadata"]["fit_max_year"])]
            decisions["diagnostic"]["mid_domains"] = inspect_domains(reference, mid_rows)
        pre_origin = pd.Timestamp(max(cold["metadata"]["origin_date"], old_pre["metadata"]["origin_date"]))
        pre_rows = eligible(diagnosis, PRE).loc[lambda frame: frame.pre_forecast_date.ge(pre_origin)]
        if len(pre_rows):
            variants = [("old_release_pre", old_pre["model"], old_pre["history"]),
                        ("cold_start", cold["model"], None)]
            # Unknown regional histories remain empty for both forecast dates.
            summary, frames = evaluate(pre_rows, variants, old_pre["history"].crop_medians, PRE)
            decisions["diagnostic"]["pre"] = summary
            all_predictions.append(frames.assign(stage="diagnostic_pre"))

        novel = external.loc[expected_country & external.country_code.isin(NOVEL[crop])
                             & external.harvest_year.le(2020)]
        assert not set(novel.country_code).intersection(corrected.country_code)
        for mode, bundle in ((PRE, cold), (MID_MODE, candidate)):
            origin_column = "pre_forecast_date" if mode == PRE else "midpoint"
            # Validation labels through 2017 were assumed published on July 1, 2018.
            test = eligible(novel, mode).loc[lambda frame: frame[origin_column].ge("2018-07-01")]
            if test.empty:
                continue
            model, history, cutoff, countries = fit_specific(corrected, test, bundle["metadata"]["selection"], crop, mode)
            summary, frames = evaluate(test, [("candidate", model, history if mode == MID_MODE else None)],
                                       history.crop_medians, mode)
            decisions["novel"][mode] = {"scores": summary["candidate"], "train_max_year": cutoff,
                                       "train_countries": countries, "first_forecast": test[origin_column].min().date().isoformat()}
            all_predictions.append(frames.assign(stage=f"novel_{mode}"))
        all_results[crop] = decisions
        print(f"{crop}: {len(mid_rows)} paired external mid-season rows; "
              f"{len(pre_rows)} paired external pre-season rows", flush=True)
    if not all_predictions:
        raise ValueError("No external rows meet the selected windows and feature coverage")
    return all_results, pd.concat(all_predictions, ignore_index=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--corrected", type=Path, required=True)
    parser.add_argument("--external", type=Path, nargs="+", required=True)
    parser.add_argument("--previous-models", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--summary", type=Path, default=ROOT / "artifacts/generalization/transfer_comparison.json")
    args = parser.parse_args()
    original, corrected = map(read_prepared, (args.original, args.corrected))
    transfer = pd.concat([read_prepared(path) for path in args.external], ignore_index=True)
    if transfer.duplicated(KEY).any():
        raise ValueError("External files contain overlapping crop, country, region, year records")
    if set(transfer.country_code).intersection(corrected.country_code):
        transfer = transfer.loc[~transfer.country_code.isin(corrected.country_code)]
    args.output.mkdir(parents=True, exist_ok=True)
    corrected_hash = file_hash(args.corrected)
    with threadpool_limits(limits=2):
        results, predictions = compare(original, corrected, transfer, args.previous_models,
                                       args.output / "frozen_spec_corrected_models", corrected_hash)
    predictions.to_csv(args.output / "transfer_predictions.csv", index=False)
    dump_json(args.summary, {"results": results, "seed": SEED, "datasets": {
        "corrected_sha256": corrected_hash, "original_sha256": file_hash(args.original),
        "external_sha256": {path.name: file_hash(path) for path in args.external},
        "external_countries": sorted(transfer.country_code.unique()),
        "external_rows": len(transfer),
    }, "previous_corrected_models": {path.name: file_hash(path) for path in args.previous_models.glob("*.joblib")}})


if __name__ == "__main__":
    main()
