"""Run the cold-start experiment, corrected midseason evaluation or data audit."""

import argparse
import json
from pathlib import Path

import joblib
import pandas as pd
from threadpoolctl import threadpool_limits

from yield_prediction.data import file_hash
from yield_prediction.experiment import build_payload, dump_json, model_schema, runtime, write_bundle
from yield_prediction.features import KEY, MID, MODE_FEATURES, TARGET
from yield_prediction.generalization import (
    COLD, MID_MODE, PRE, cold_nested, mid_spatial, mid_temporal, rank, summarize,
)
from yield_prediction.models import fit_model, forecast
from yield_prediction.validation import eligible, read_prepared

ROOT = Path(__file__).resolve().parent
EXPECTED = "ca8da91570a8d42593720cd08ffb40aa5f9e45e0e0d5fd8384f781afcfc06251"


def integrity(original, corrected):
    old, new = (table.set_index(KEY, verify_integrity=True).sort_index() for table in (original, corrected))
    pd.testing.assert_index_equal(old.index, new.index)
    columns = [*MODE_FEATURES[PRE], TARGET, "sos", "eos", "season_start", "season_end",
               "midpoint", "pre_forecast_date", "mid_weather_cutoff", "climate_seasons", "climate_through"]
    pd.testing.assert_frame_equal(old[columns], new[columns], check_exact=True)
    fields = [*MID, "mid_weather_through", "mid_weather_coverage"]
    changed = ~(old[fields].eq(new[fields]) | (old[fields].isna() & new[fields].isna()))
    changed_countries = (changed.any(axis=1).groupby(level=["crop", "country_code"]).sum()
                         .reset_index(name="changed_rows"))
    with_dates = new.mid_weather_through.notna()
    if not new.loc[with_dates, "mid_weather_through"].between(
            new.loc[with_dates, "season_start"], new.loc[with_dates, "mid_weather_cutoff"]).all():
        raise ValueError("A midseason observation is outside its season or publication cutoff")
    historical = new.climate_through.notna()
    if not new.loc[historical, "climate_through"].le(
            new.loc[historical, "pre_forecast_date"] - pd.Timedelta(days=14)).all():
        raise ValueError("A historical observation is outside the publication cutoff")
    stats = {}
    for name, frame in (("original", old), ("corrected", new)):
        stats[name] = {}
        for col in fields:
            summary = {"missing": int(frame[col].isna().sum())}
            values = frame[col].dropna()
            if len(values) and col == "mid_weather_through":
                summary.update(first_date=values.min().date().isoformat(), last_date=values.max().date().isoformat())
            elif len(values):
                summary.update(p05=values.quantile(.05), median=values.median(), p95=values.quantile(.95))
            stats[name][col] = summary
    return {"rows": len(new), "unique_keys": True, "unchanged_columns": columns,
            "changed_rows": int(changed.any(axis=1).sum()),
            "changed_rows_by_country": changed_countries.loc[changed_countries.changed_rows.gt(0)].to_dict("records"),
            "changed_cells_by_feature": changed.sum().to_dict(), "distribution": stats}


def cold(data, config, source, output, artifacts, models):
    predictions, folds, choice, release_folds = cold_nested(data, config)
    report = {"dataset": source, "config": config, "outer_folds": folds, "release_inner_folds": release_folds,
              "release_comparison": choice, "crops": {}}
    for crop, cases in predictions.groupby("crop"):
        evidence = summarize(cases)
        best = rank(choice, crop)[0]["spec"]
        # Freeze the release at the original mid/late-date origin for paired diagnostics.
        available = eligible(data, PRE)
        train = available.loc[available.harvest_year.le(2019)]
        crop_train = train.loc[train.crop.eq(crop)]
        model = fit_model(best, train if best["shared"] else crop_train, PRE, config["seed"], crop)
        metadata = {
            "mode": COLD, "crop": crop, "model_version": "1.1.0-cold+" + source["sha256"][:10],
            "spatial_level": "administrative_region", "origin_date": "2020-07-01", "last_test_year": 2020,
            "schema": model_schema(crop_train, model, PRE), "countries": sorted(crop_train.country_code.unique()),
            "country_regions": {}, "runtime": runtime(model), "selection": best, "dataset": source,
            "qualification": "experimental_country_transfer", "fit_max_year": 2019,
            "fit_rows": model["fit_rows"], "fit_countries": sorted(
                (train if best["shared"] else crop_train).country_code.unique()),
            "interval_status": "withheld", "nested_evaluation": evidence,
        }
        write_bundle({"model": model, "metadata": metadata}, f"{crop}_{COLD}", models)
        example = available.loc[available.crop.eq(crop) & available.harvest_year.ge(2021) &
                                available.pre_forecast_date.ge(metadata["origin_date"])].head(1)
        if not example.empty:
            features = build_payload(example.iloc[0], PRE)
            features.pop("adm_id")
            dump_json(artifacts / f"{crop}_cold_start_candidate_example.json", {
                "crop": crop, "mode": COLD, "features": features,
                "predicted_yield_t_ha": float(forecast(model, example, {})[0]),
            })
        report["crops"][crop] = {"evaluation": evidence, "release": metadata}
        print(f"{crop} outer macro MAE {evidence['country_mean_mae_t_ha']:.3f}", flush=True)
    predictions.to_csv(output / "cold_start_predictions.csv", index=False)
    dump_json(artifacts / "cold_start_metrics.json", report)


def mid(data, config, source, output, artifacts, models):
    report, predictions, selected = mid_temporal(data, config)
    predictions.to_csv(output / "midseason_holdout_predictions.csv", index=False)
    for crop, (model, history, test, train) in selected.items():
        origin = test.midpoint.min()
        representative = train.loc[train.crop.eq(crop)]
        meta = {
            "mode": MID_MODE, "crop": crop, "model_version": "1.1.0-mid+" + source["sha256"][:10],
            "spatial_level": "administrative_region", "origin_date": origin.date().isoformat(),
            "last_test_year": int(test.harvest_year.max()), "schema": model_schema(representative, model, MID_MODE),
            "countries": sorted(representative.country_code.unique()),
            "country_regions": {code: sorted(rows.adm_id.unique()) for code, rows in representative.groupby("country_code")},
            "runtime": runtime(model), "selection": model["spec"], "dataset": source, "interval_status": "withheld",
            "fit_max_year": int(train.harvest_year.max()), "fit_rows": model["fit_rows"],
            "qualification": "corrected_reference_temporal_candidate",
        }
        write_bundle({"model": model, "metadata": meta, "history": history.snapshot(origin, crop)},
                     f"{crop}_mid_season_v2", models)
        example = test.iloc[0]
        estimate = predictions.loc[predictions.crop.eq(crop) & predictions.model.eq(model["spec"]["name"]) &
                                   predictions.country_code.eq(example.country_code) &
                                   predictions.adm_id.eq(example.adm_id) &
                                   predictions.harvest_year.eq(example.harvest_year), "prediction"].iloc[0]
        dump_json(artifacts / f"{crop}_midseason_candidate_example.json", {
            "crop": crop, "mode": MID_MODE, "features": build_payload(example, MID_MODE),
            "predicted_yield_t_ha": estimate,
        })
    dump_json(artifacts / "midseason_metrics.json", {"dataset": source, "config": config, "crops": report})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment", choices=["integrity", "cold", "mid", "mid_spatial"])
    parser.add_argument("--corrected", required=True, type=Path)
    parser.add_argument("--original", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--artifacts", type=Path, default=ROOT / "artifacts/generalization")
    parser.add_argument("--models", type=Path, default=ROOT / "src/yield_prediction/candidate_models")
    parser.add_argument("--config", type=Path, default=ROOT / "configs/generalization.json")
    arguments = parser.parse_args()
    config = json.loads(arguments.config.read_text())
    checksum = file_hash(arguments.corrected)
    source = {"sha256": checksum, "reference_sha256": EXPECTED, "matches_reference": checksum == EXPECTED,
              "record": "https://zenodo.org/records/17279151"}
    table = read_prepared(arguments.corrected)
    source["rows"] = len(table)
    source["countries"] = sorted(table.country_code.unique())
    arguments.output.mkdir(parents=True, exist_ok=True)
    with threadpool_limits(limits=2):
        if arguments.experiment == "integrity":
            result = integrity(read_prepared(arguments.original), table)
            dump_json(arguments.artifacts / "data_integrity.json", {
                "original_sha256": file_hash(arguments.original), "corrected": source, **result,
            })
        elif arguments.experiment == "cold":
            cold(table, config, source, arguments.output, arguments.artifacts, arguments.models)
        elif arguments.experiment == "mid":
            mid(table, config, source, arguments.output, arguments.artifacts, arguments.models)
        else:
            assessment, predictions = mid_spatial(table, config)
            predictions.to_csv(arguments.output / "midseason_spatial_predictions.csv", index=False)
            dump_json(arguments.artifacts / "midseason_spatial_metrics.json",
                      {"dataset": source, "config": config, **assessment})


if __name__ == "__main__":
    main()
