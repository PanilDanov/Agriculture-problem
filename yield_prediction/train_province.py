"""Train separate experimental MAPA/NASA province models from audited archives.

No model is emitted for a crop without real preceding labels, monthly weather,
an audited province and a published monthly crop calendar. Last three harvest
years are untouched final holdout; two earlier years select the estimator.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date
import gzip
import hashlib
from importlib.metadata import version
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from yield_prediction.national import CROP_ITEMS
from yield_prediction import province as province_module
from yield_prediction.province import BASE_FEATURES, MODES, label_cutoff_year, make_features, monthly_weather

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent


def read(path):
    body = path.read_bytes()
    return json.loads(gzip.decompress(body) if path.suffix == ".gz" else body)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def metrics(actual, predicted, baseline):
    actual, predicted, baseline = (np.asarray(value, dtype=float) for value in (actual, predicted, baseline))
    return {"count": len(actual), "mae_t_ha": float(np.abs(actual - predicted).mean()),
            "rmse_t_ha": float(np.sqrt(np.square(actual - predicted).mean())),
            "last_yield_baseline_mae_t_ha": float(np.abs(actual - baseline).mean()),
            "last_yield_baseline_rmse_t_ha": float(np.sqrt(np.square(actual - baseline).mean()))}


def candidates():
    return {"ridge_alpha_1": make_pipeline(StandardScaler(), Ridge(alpha=1)),
            "ridge_alpha_10": make_pipeline(StandardScaler(), Ridge(alpha=10)),
            "ridge_alpha_100": make_pipeline(StandardScaler(), Ridge(alpha=100)),
            "hist_gradient_boosting": HistGradientBoostingRegressor(max_iter=120, max_leaf_nodes=12,
                                                                   min_samples_leaf=12, l2_regularization=10,
                                                                   random_state=42)}


def train(args):
    labels, calendars, geography = read(args.labels), read(args.calendars), read(args.provinces)
    archives = {}
    weather_source = {"kind": "explicit_monthly_directory"}
    if args.weather is None:
        registry = read(args.weather_release / "registry.json")
        path = args.weather_release / "weather.json.gz"
        if sha(path) != registry["weatherSha256"]:
            raise ValueError("Portable NASA weather SHA-256 mismatch")
        records = read(path)["records"]
        archives = {code: {"regionId": code, "countryCode": registry["countryCode"], "asOf": registry["asOf"],
                           "weather": weather} for code, weather in records.items()}
        args.as_of = args.as_of or registry["asOf"]
        weather_source = {"kind": "hash_verified_portable_release", "sha256": registry["weatherSha256"],
                          "as_of": registry["asOf"]}
    args.as_of = args.as_of or date.today().isoformat()
    as_of = date.fromisoformat(args.as_of)
    if as_of > date.today():
        raise ValueError("Training data asOf cannot be in the future")
    label_source = {**labels.get("source", {}), "archive_sha256": sha(args.labels),
                    "verified_available_on": labels.get("source", {}).get("verified_available_on", args.as_of),
                    **{key: labels.get(key) for key in ("target_definition", "production_scope", "publication_note", "sources")},
                    "publication_availability": "Frozen retrieved archive, not an archive of historical issue-time publication."}
    calendar_index = {(row["crop_id"], row["province_code"]): row for row in calendars["records"]
                      if row["calendar_status"] == "available" and row["province_code"] != "ES"}
    regions, weather, weather_hashes = {}, {}, {}
    for row in geography["records"]:
        code = row["region_id"]
        if args.weather is not None:
            path = args.weather / (code + ".json")
            if not path.is_file():
                continue
            archive = read(path)
        else:
            archive = archives.get(code)
            if archive is None:
                continue
        if archive["regionId"] != code or archive["countryCode"] != "ES" or archive["asOf"] > args.as_of:
            raise ValueError("Monthly archive identity/date does not match its registered province")
        raw_weather = archive["weather"]
        if any(abs(raw_weather[key] - row[key]) > 1e-6 for key in ("latitude", "longitude")):
            raise ValueError("Monthly archive point does not match its registered province")
        regions[code] = row
        weather[code] = monthly_weather(raw_weather, as_of=as_of)
        weather_hashes[code] = hashlib.sha256(json.dumps(raw_weather, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    histories = defaultdict(dict)
    for row in labels["rows"]:
        crop, code, year = row["crop"], row.get("region_id", row["province_code"]), row["harvest_year"]
        value = row["yield_t_ha"]
        if crop not in CROP_ITEMS or code not in regions or value is None or value < 0:
            continue
        if value == 0:
            raise ValueError("An explicit zero yield label requires a versioned nonnegative/log1p policy; this positive-log release must not silently drop crop failures")
        key = (crop, code)
        if year in histories[key]:
            raise ValueError(f"Duplicate provincial label for {crop}/{code}/{year}; resolve source vintages explicitly")
        if not np.isfinite(value):
            raise ValueError("Provincial yield label is non-finite")
        histories[key][int(year)] = float(value)
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"schema_version": "province-monthly-experimental-v1", "as_of": args.as_of,
              "label_archive_sha256": sha(args.labels), "calendar_archive_sha256": sha(args.calendars),
              "geography_archive_sha256": sha(args.provinces), "training_code_sha256": sha(Path(__file__)),
              "feature_code_sha256": sha(Path(province_module.__file__)), "weather_source": weather_source, "models": []}
    for crop in args.crops:
        crop_rows = [row for row in labels["rows"] if row["crop"] == crop]
        crop_source = {**label_source, "crop": crop,
                       "area_basis_counts": dict(Counter(row.get("area_basis", "unspecified") for row in crop_rows)),
                       "yield_derivation_counts": dict(Counter(row.get("yield_derivation", "production_t / reported_area_ha") for row in crop_rows)),
                       "production_scope": sorted({row.get("production_scope", "unspecified") for row in crop_rows})}
        if crop == "tomato" and crop_source["production_scope"] == ["open_field_rainfed_and_irrigated"]:
            crop_source["target_definition"] = "Area-weighted official open-field rainfed and irrigated tomato yields, kg/ha converted to t/ha; protected cultivation excluded from labels. Calendar remains unsplit."
        supported = sorted(code for code in regions if (crop, code) in calendar_index
                           and len(histories[(crop, code)]) >= 10)
        if not supported:
            raise ValueError(f"No province has sufficient actual labels and calendar coverage for {crop}")
        static = {}
        for code in supported:
            raw = calendar_index[(crop, code)]
            crop_calendar = {"sowing_month": int(np.argmax(raw["sowing_monthly_pct"])) + 1,
                             "harvest_month": int(np.argmax(raw["harvest_monthly_pct"])) + 1,
                             "method": "modal-month-scenario-v1; first sowing day, last harvest day; earliest month resolves ties",
                             "production_scope": raw["production_scope"], "warnings": raw["warnings"],
                             "source": {"reference_period": calendars["reference_period"], "published_on": None,
                                        "verified_available_on": calendars["retrieved_at"][:10],
                                        "source_ids": raw["source_ids"],
                                        "source_files": [source for source in calendars["sources"] if source["id"] in raw["source_ids"]],
                                        "archive_sha256": sha(args.calendars)}}
            geo = regions[code]
            static[code] = {"name": geo["province_name"], "point": {key: geo[key] for key in ("latitude", "longitude")},
                            "history": sorted(histories[(crop, code)].items()), "calendar": crop_calendar,
                            "geometry_source": {
                                **{key: geography.get(key) for key in ("source_url", "source_sha256", "attribution", "region_namespace",
                                                                      "license", "license_url", "point_definition", "point_provenance")},
                                "point_method": geo.get("point_method"), "point_source": geo.get("point_source")}}
        for mode in MODES:
            examples = []
            rejected = defaultdict(int)
            for code in supported:
                history = histories[(crop, code)]
                for year, target in sorted(history.items()):
                    for drop in range(3):
                        preceding = sorted(value for value in history if value < year)
                        if drop:
                            preceding = preceding[:-drop]
                        available = {value: history[value] for value in preceding}
                        try:
                            features, diagnostics = make_features(available, weather[code], static[code]["calendar"], year,
                                                                  mode, as_of=as_of, provinces=supported, province_id=code,
                                                                  historical_label_cutoff=year - 1)
                        except ValueError as error:
                            rejected[str(error)] += 1
                            continue
                        examples.append({"year": year, "province": code, "age": diagnostics["labelAgeYears"],
                                         "policy_age": year - label_cutoff_year(static[code]["calendar"], year, mode),
                                         "x": features, "y": target, "baseline": available[max(available)]})
            years = sorted({row["year"] for row in examples})
            if len(years) < 8:
                raise ValueError(f"Fewer than eight usable target years for {crop}/{mode}")
            holdout, selection = years[-3:], years[-5:-3]
            fitting = [row for row in examples if row["year"] < min(selection)]
            validation = [row for row in examples if row["year"] in selection]
            testing = [row for row in examples if row["year"] in holdout]
            if min(len(fitting), len(validation), len(testing)) < 10:
                raise ValueError(f"Insufficient independent temporal split rows for {crop}/{mode}")
            scores = {}
            for name, estimator in candidates().items():
                estimator.fit(np.stack([row["x"] for row in fitting]), np.log([row["y"] for row in fitting]))
                predicted = np.exp(estimator.predict(np.stack([row["x"] for row in validation])))
                scores[name] = float(np.abs(predicted - [row["y"] for row in validation]).mean())
            selected = min(scores, key=scores.get)
            estimator = candidates()[selected]
            before_holdout = [row for row in examples if row["year"] < min(holdout)]
            estimator.fit(np.stack([row["x"] for row in before_holdout]), np.log([row["y"] for row in before_holdout]))
            predicted = np.exp(estimator.predict(np.stack([row["x"] for row in testing])))
            evaluation = metrics([row["y"] for row in testing], predicted, [row["baseline"] for row in testing])
            by_age = {}
            for age in (1, 2, 3):
                indexes = [index for index, row in enumerate(testing) if row["age"] == age]
                if indexes:
                    by_age[str(age)] = metrics([testing[index]["y"] for index in indexes], predicted[indexes],
                                               [testing[index]["baseline"] for index in indexes])
            policy_indexes = [index for index, row in enumerate(testing) if row["age"] == row["policy_age"]]
            if not policy_indexes:
                raise ValueError("No held-out cases match the operational conservative label-age policy")
            policy_metrics = metrics([testing[index]["y"] for index in policy_indexes], predicted[policy_indexes],
                                     [testing[index]["baseline"] for index in policy_indexes])
            estimator.fit(np.stack([row["x"] for row in examples]), np.log([row["y"] for row in examples]))
            fingerprint = hashlib.sha256(json.dumps({"labels": report["label_archive_sha256"],
                              "calendars": report["calendar_archive_sha256"], "crop": crop, "mode": mode,
                              "geography": report["geography_archive_sha256"],
                              "training_code": report["training_code_sha256"], "features_code": report["feature_code_sha256"],
                              "weather": {code: weather_hashes[code] for code in supported},
                              "estimator": selected, "feature_schema": BASE_FEATURES}, sort_keys=True).encode()).hexdigest()[:12]
            model_version = "province-monthly-v1+" + fingerprint
            bundle = {"crop": crop, "mode": mode, "model_version": model_version, "model": estimator, "regions": static}
            path = args.output / f"{crop}_{mode}.joblib"
            joblib.dump(bundle, path, compress=3)
            primary = policy_metrics
            beats = (evaluation["mae_t_ha"] < evaluation["last_yield_baseline_mae_t_ha"]
                     and primary["mae_t_ha"] < primary["last_yield_baseline_mae_t_ha"])
            validation_report = {"method": "Last three harvest years held out; earlier two years select estimator; final refit includes holdout labels.",
                                 "holdout_years": holdout, "selection_years": selection,
                                 "training_years_before_holdout": sorted({row["year"] for row in before_holdout}),
                                 "unique_holdout_province_years": len({(row["province"], row["year"]) for row in testing}),
                                 "yield_history_age_years": [1, 2, 3], "metrics": evaluation, "metrics_by_label_age": by_age,
                                 "conservative_policy_metrics": policy_metrics,
                                 "operational_label_policy": "Only labels <=target-2; winter pre-season only <=target-3. Historical age1/2/3 cases are explicitly retrospective.",
                                 "publication_availability": "Retrospective revised snapshots; not archived issue-time publication availability.",
                                 "selected_estimator": selected, "selection_mae_t_ha": scores}
            metadata = {"schema_version": "province-monthly-experimental-v1", "crop": crop, "mode": mode,
                        "model_version": model_version, "artifact_sha256": sha(path),
                        "spatial_level": "administrative_region", "weather_support": "representative_point",
                        "release_status": "experimental", "provinces": supported,
                        "geography_archive_sha256": report["geography_archive_sha256"],
                        "training_through": max(years), "features": [*BASE_FEATURES, *("province_" + code for code in supported)],
                        "source": crop_source, "quality_status": "beats_last_yield_on_holdout" if beats else "does_not_beat_last_yield_on_holdout",
                        "validation": validation_report,
                        "runtime": {name: version(name) for name in ("numpy", "scikit-learn", "joblib")},
                        "training_examples": len(examples), "rejected_examples": dict(rejected)}
            current_coverage, current_missing = [], {}
            for code in supported:
                try:
                    current, _ = make_features(histories[(crop, code)], weather[code], static[code]["calendar"], as_of.year,
                                               mode, as_of=as_of, provinces=supported, province_id=code)
                    value = float(np.exp(estimator.predict(current.reshape(1, -1))[0]))
                    if not np.isfinite(value) or value <= 0:
                        raise ValueError("The real model did not produce a finite positive current target prediction")
                    current_coverage.append(code)
                except ValueError as error:
                    current_missing[code] = str(error)
            metadata.update(current_target_year=as_of.year, current_coverage_regions=current_coverage,
                            current_missing_regions=current_missing,
                            training_code_sha256=report["training_code_sha256"], feature_code_sha256=report["feature_code_sha256"])
            path.with_suffix(".json").write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n")
            record = {"crop": crop, "mode": mode, "modelVersion": model_version, "provinces": len(supported),
                      "trainingExamples": len(examples), "holdoutYears": holdout, "qualityStatus": metadata["quality_status"], **evaluation}
            record.update(currentTargetYear=as_of.year, currentCoverageRegions=current_coverage,
                          currentMissingRegions=current_missing, conservativePolicyMetrics=policy_metrics)
            report["models"].append(record)
            print(json.dumps({key: record[key] for key in ("crop", "mode", "modelVersion", "provinces",
                              "trainingExamples", "qualityStatus", "mae_t_ha", "last_yield_baseline_mae_t_ha")},
                             allow_nan=False), flush=True)
    report["all_models_shared_provinces"] = sorted(set.intersection(*(set(row["currentCoverageRegions"]) for row in report["models"])))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, default=ROOT / "artifacts/provincial/mapa_yields.json.gz")
    parser.add_argument("--calendars", type=Path, default=ROOT / "artifacts/reference/mapa_calendars_2014_2016.json")
    parser.add_argument("--provinces", type=Path, default=ROOT / "artifacts/provincial/provinces.json")
    parser.add_argument("--weather", type=Path, help="Explicit collected weather directory; default is the verified portable release")
    parser.add_argument("--weather-release", type=Path, default=PROJECT / "agronomy/province_inputs")
    parser.add_argument("--output", type=Path, default=ROOT / "src/yield_prediction/province_models")
    parser.add_argument("--report", type=Path, default=ROOT / "artifacts/provincial/evaluation.json")
    parser.add_argument("--as-of", help="Default: the frozen portable release date, or today for an explicit collected directory")
    parser.add_argument("--crops", nargs="+", choices=tuple(CROP_ITEMS), default=list(CROP_ITEMS))
    args = parser.parse_args()
    with threadpool_limits(limits=1):
        train(args)


if __name__ == "__main__":
    main()
