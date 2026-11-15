"""Evaluate packaged forecasts on countries outside the release dataset."""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

from yield_prediction import predict_yield
from yield_prediction.data import file_hash
from yield_prediction.experiment import build_payload, dump_json
from yield_prediction.features import KEY, MODE_FEATURES, TARGET
from yield_prediction.inference import MODEL_DIR, load_bundle, validate_features
from yield_prediction.models import HISTORY, forecast
from yield_prediction.validation import eligible, read_prepared, score

ROOT = Path(__file__).resolve().parent


def predict_cases(rows, crop, mode, reference_hash):
    bundle = load_bundle(crop, mode)
    metadata = bundle["metadata"]
    if metadata["dataset"]["dataset_sha256"] != reference_hash:
        raise ValueError("The packaged model does not belong to the reference data manifest")
    history = bundle["history"]
    result = rows[KEY + [TARGET]].copy()
    result["mode"] = mode
    result["forecast_date"] = rows["pre_forecast_date" if mode == "pre_season" else "midpoint"]
    result["status"] = "insufficient_climate_history"
    if mode == "mid_season":
        result.loc[rows.climate_seasons.ge(2), "status"] = "insufficient_mid_season_weather"
    result["reason"] = ""
    result["predicted_yield_t_ha"] = np.nan
    result["crop_median_t_ha"] = history.crop_medians[crop]

    inputs, indices = [], []
    for index, row in eligible(rows, mode).iterrows():
        try:
            payload = build_payload(row, mode)
            features, country, region, date = validate_features(payload, mode, metadata)
        except ValueError as error:
            result.loc[index, ["status", "reason"]] = ["input_rejected", str(error)]
            continue
        statistics = history.at(crop, country, region, date)
        if statistics[-1]:
            raise ValueError(f"External row for {crop}/{country}/{region} has frozen regional history")
        inputs.append({**features, "crop": crop, **dict(zip(HISTORY, statistics))})
        indices.append(index)

    if indices:
        predictions = forecast(bundle["model"], pd.DataFrame(inputs), history.crop_medians)
        if not np.isfinite(predictions).all():
            raise RuntimeError(f"Non-finite predictions for {crop}/{mode}")
        example = predict_yield(build_payload(rows.loc[indices[0]], mode), crop, mode)
        if not np.isclose(predictions[0], example["predicted_yield_t_ha"], rtol=0, atol=1e-8):
            raise RuntimeError("Batch evaluation differs from predict_yield")
        result.loc[indices, "predicted_yield_t_ha"] = predictions
        result.loc[indices, "status"] = "scored"
    return result, file_hash(MODEL_DIR / f"{crop}_{mode}.joblib")


def metrics(rows):
    scored = rows.loc[rows.status.eq("scored")]
    return {
        "status_counts": {key: int(value) for key, value in rows.status.value_counts().items()},
        "input_rejections": {key: int(value) for key, value in rows.loc[
            rows.status.eq("input_rejected"), "reason"
        ].value_counts().items()},
        "model": score(scored[TARGET], scored.predicted_yield_t_ha) if len(scored) else None,
        "crop_median": score(scored[TARGET], scored.crop_median_t_ha) if len(scored) else None,
    }


def evaluate(rows, reference, source, first_year, output):
    reference_countries = sorted({group["country_code"] for group in reference["groups"]})
    new_country = ~rows.country_code.isin(reference_countries)
    evaluation = rows.loc[new_country & rows.harvest_year.ge(first_year)]
    if evaluation.empty:
        raise ValueError("No rows from new countries in the requested harvest years")

    predictions, cases = [], []
    with threadpool_limits(limits=2):
        for crop, partition in evaluation.groupby("crop", sort=True):
            for mode in MODE_FEATURES:
                result, checksum = predict_cases(partition, crop, mode, reference["dataset_sha256"])
                by_country = [{"country_code": country, **metrics(block)}
                              for country, block in result.groupby("country_code", sort=True)]
                model_errors = [country["model"]["mae_t_ha"] for country in by_country if country["model"]]
                baseline_errors = [country["crop_median"]["mae_t_ha"]
                                   for country in by_country if country["crop_median"]]
                cases.append({
                    "crop": crop, "mode": mode, "artifact_sha256": checksum, **metrics(result),
                    "country_mean_mae_t_ha": float(np.mean(model_errors)) if model_errors else None,
                    "country_mean_crop_median_mae_t_ha": float(np.mean(baseline_errors)) if baseline_errors else None,
                    "by_country": by_country,
                    "by_harvest_year": [{"year": int(year), **metrics(block)}
                                        for year, block in result.groupby("harvest_year", sort=True)],
                })
                predictions.append(result)

    output.mkdir(parents=True, exist_ok=True)
    pd.concat(predictions, ignore_index=True).to_csv(output / "predictions.csv", index=False)
    dump_json(output / "metrics.json", {
        "reference_dataset_sha256": reference["dataset_sha256"],
        "external_data": source,
        "first_harvest_year": first_year,
        "countries_in_reference_dataset": reference_countries,
        "prepared_rows": len(rows),
        "excluded_reference_country_rows": int((~new_country).sum()),
        "excluded_earlier_rows_in_new_countries": int((new_country & rows.harvest_year.lt(first_year)).sum()),
        "evaluation_rows": len(evaluation),
        "cases": cases,
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--first-year", type=int, default=2021)
    args = parser.parse_args()
    reference = json.loads((ROOT / "artifacts/metrics/data_manifest.json").read_text(encoding="utf-8"))
    source = json.loads(args.dataset.with_suffix(".json").read_text(encoding="utf-8"))
    if file_hash(args.dataset) != source["dataset_sha256"]:
        raise ValueError("Prepared data differs from its manifest. Rerun preparation.")
    evaluate(read_prepared(args.dataset), reference, source, args.first_year, args.output)


if __name__ == "__main__":
    main()
