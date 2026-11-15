"""Download, filter and train ten national annual-yield models from official FAOSTAT.

Run with the released yield runtime. No weather or synthetic labels enter these models.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import hashlib
import gzip
import io
import json
from pathlib import Path
import ssl
import sys
from urllib.request import urlopen
from zipfile import ZipFile

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits
from importlib.metadata import version

sys.path.insert(0, str(Path(__file__).parent / "src"))
from yield_prediction.national import CROP_ITEMS, FEATURES, model_features

ROOT = Path(__file__).resolve().parent
BULK_URL = "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip"
COUNTRY_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson"
SOURCE_PUBLISHED_ON = "2025-12-31"
SOURCE_SHA256 = "c5835418c18f9322e7decbd6800f93a216eaae3cdfa31acb08f0518c0c6d6853"
COUNTRY_SHA256 = "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f"


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    context = ssl.create_default_context()
    try:
        import certifi
        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    temporary = destination.with_suffix(".tmp")
    try:
        with urlopen(url, timeout=60, context=context) as response, temporary.open("wb") as out:
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                out.write(chunk)
            header = response.headers.get("Last-Modified")
        temporary.replace(destination)
        return header
    finally:
        temporary.unlink(missing_ok=True)


def country_mapping(path):
    mappings = {}
    for feature in json.loads(path.read_text())["features"]:
        props = feature["properties"]
        numeric = str(props.get("ISO_N3_EH") or props.get("ISO_N3", ""))
        iso = props.get("ISO_A2_EH") or props.get("ISO_A2")
        if len(numeric) == 3 and numeric.isdigit() and isinstance(iso, str) and len(iso) == 2 and iso != "-99":
            mappings[numeric] = iso
    return mappings


def prepare(archive, countries):
    by_code = {code: crop for crop, (code, _) in CROP_ITEMS.items()}
    history = {crop: defaultdict(dict) for crop in CROP_ITEMS}
    names, flags, rejected, accepted = {}, Counter(), Counter(), Counter()
    map_iso = country_mapping(countries)
    with ZipFile(archive) as zipped:
        bad = zipped.testzip()
        if bad:
            raise ValueError(f"Invalid archive CRC: {bad}")
        source = next(name for name in zipped.namelist() if name.endswith("(Normalized).csv"))
        with zipped.open(source) as member:
            for row in csv.DictReader(io.TextIOWrapper(member, encoding="utf-8-sig")):
                if row["Item Code"] not in by_code or row["Element"] != "Yield":
                    continue
                crop = by_code[row["Item Code"]]
                if row["Item"].replace(";", ",") != CROP_ITEMS[crop][1].replace(";", ","):
                    raise ValueError(f"Unexpected FAOSTAT crop identity for {crop}: {row['Item']}")
                country = map_iso.get(row["Area Code (M49)"].lstrip("'"))
                if not country:
                    rejected["unmapped_area_or_regional_aggregate"] += 1
                    continue
                if row["Unit"] != "kg/ha":
                    raise ValueError(f"Unexpected FAOSTAT yield unit: {row['Unit']}")
                try:
                    year, value = int(row["Year"]), float(row["Value"]) / 1000
                except ValueError:
                    rejected["nonnumeric"] += 1
                    continue
                if not np.isfinite(value) or value <= 0:
                    rejected["nonpositive_or_nonfinite"] += 1
                    continue
                if year in history[crop][country]:
                    raise ValueError(f"Duplicate crop-country-year: {crop}/{country}/{year}")
                history[crop][country][year] = value
                names[country] = row["Area"]
                flags[row["Flag"]] += 1
                accepted[crop] += 1
    if set(accepted) != set(CROP_ITEMS):
        raise ValueError("Official source does not cover all ten crops")
    return history, names, {"accepted_rows": dict(accepted), "flags": dict(flags), "rejected_rows": dict(rejected),
                            "units": "source kg/ha / 1000 = target t/ha", "source_csv": source,
                            "country_mapping": "Natural Earth 5.1.2 ISO_N3_EH to ISO_A2_EH; regional aggregates excluded"}


def supervised(history):
    records = []
    for country, values in sorted(history.items()):
        for year, target in sorted(values.items()):
            if year < 1980:
                continue
            try:
                x = model_features(values, year)
            except ValueError:
                continue
            records.append((country, year, x, target))
    return records


def matrices(records):
    return np.stack([row[2] for row in records]), np.log([row[3] for row in records])


def metrics(records, predictions):
    actual = np.asarray([row[3] for row in records])
    predicted = np.asarray(predictions)
    residual = predicted - actual
    baseline = np.exp([row[2][0] for row in records])
    by_country = defaultdict(list)
    for record, error in zip(records, residual):
        by_country[record[0]].append(float(abs(error)))
    variance = float(np.square(actual - actual.mean()).sum())
    return {"n": len(records), "countries": len(by_country), "mae_t_ha": float(np.abs(residual).mean()),
            "rmse_t_ha": float(np.sqrt(np.square(residual).mean())), "bias_t_ha": float(residual.mean()),
            "r2": float(1 - np.square(residual).sum() / variance) if variance else None,
            "macro_country_mae_t_ha": float(np.mean([np.mean(errors) for errors in by_country.values()])),
            "last_yield_baseline_mae_t_ha": float(np.abs(baseline - actual).mean()),
            "mean5_baseline_mae_t_ha": float(np.abs(np.exp([row[2][6] for row in records]) - actual).mean()),
            "country_mae_t_ha": {country: float(np.mean(errors)) for country, errors in sorted(by_country.items())}}


def train(history, names, output, source, audit):
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    runtime = {name: version(name) for name in ("numpy", "scikit-learn", "joblib")}
    for crop, values in history.items():
        rows = supervised(values)
        train_rows = [row for row in rows if row[1] <= 2018]
        validation = [row for row in rows if 2019 <= row[1] <= 2021]
        test_rows = [row for row in rows if 2022 <= row[1] <= 2024]
        if min(map(len, (train_rows, validation, test_rows))) < 30:
            raise ValueError(f"Insufficient independent temporal rows for {crop}")
        x, y = matrices(train_rows)
        xv, _ = matrices(validation)
        candidates = {
            "ridge_1": make_pipeline(StandardScaler(), Ridge(alpha=1)),
            "ridge_10": make_pipeline(StandardScaler(), Ridge(alpha=10)),
            "ridge_100": make_pipeline(StandardScaler(), Ridge(alpha=100)),
            "hist_absolute": HistGradientBoostingRegressor(loss="absolute_error", max_iter=120,
                    max_leaf_nodes=7, min_samples_leaf=20, l2_regularization=10, random_state=42),
        }
        scores = {}
        with threadpool_limits(limits=2):
            for name, model in candidates.items():
                model.fit(x, y)
                scores[name] = metrics(validation, np.exp(model.predict(xv)))
            selected = min(scores, key=lambda key: (scores[key]["macro_country_mae_t_ha"], key))
            # Selection is finished before the held-out 2022-2024 labels are evaluated.
            model = candidates[selected]
            before_test = [row for row in rows if row[1] <= 2021]
            xt, yt = matrices(before_test)
            model.fit(xt, yt)
            xx, _ = matrices(test_rows)
            holdout = metrics(test_rows, np.exp(model.predict(xx)))
            # Final operational model uses all available reported years after evaluation.
            xx, yy = matrices(rows)
            model.fit(xx, yy)
        latest = max(row[1] for row in rows)
        release_history = {}
        for country, observations in sorted(values.items()):
            last = max(observations)
            if all(year in observations for year in range(last - 4, last + 1)):
                release_history[country] = [[year, observations[year]] for year in sorted(observations) if year >= last - 9]
        payload = json.dumps({"crop": crop, "source": source["archive_sha256"], "features": FEATURES,
                              "trainingThrough": latest, "selected": selected}, sort_keys=True).encode()
        model_version = "national-annual-v1+" + hashlib.sha256(payload).hexdigest()[:12]
        bundle = {"crop": crop, "model": model, "model_version": model_version,
                  "history": release_history, "country_names": {country: names[country] for country in release_history}}
        artifact = output / f"{crop}.joblib"
        joblib.dump(bundle, artifact, compress=3)
        quality = "beats_last_yield_on_holdout" if holdout["mae_t_ha"] < holdout["last_yield_baseline_mae_t_ha"] else "experimental"
        metadata = {"schema_version": "1.0", "crop": crop, "mode": "annual_history", "spatial_level": "country",
                    "model_version": model_version, "algorithm": selected, "features": FEATURES,
                    "target_unit": "t/ha", "target_product": CROP_ITEMS[crop][1], "item_code": CROP_ITEMS[crop][0],
                    "artifact_sha256": sha(artifact), "runtime": runtime, "source": source,
                    "training_through": latest, "training_rows": len(rows),
                    "countries": sorted(release_history), "quality_status": quality,
                    "validation": {"selection_years": [2019, 2020, 2021], "holdout_years": [2022, 2023, 2024],
                        "method": "Temporal holdout; each feature uses five preceding yields. Revised source snapshots, not a publication-vintage backtest.",
                        "selection": {name: {key: value for key, value in report.items() if key != "country_mae_t_ha"} for name, report in scores.items()},
                        "holdout": holdout}, "data_audit": audit,
                    "limitations": ["National support only; no field-level accuracy validation", "No current weather or NASA predictors",
                                    "Only positive observed yields modeled; source flags retained in audit", "No calibrated interval", "Frozen source snapshot"]}
        (output / f"{crop}.json").write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        results[crop] = {"model": selected, "quality": quality, "countries": len(release_history),
                         "rows": len(rows), "mae_t_ha": holdout["mae_t_ha"],
                         "baseline_mae_t_ha": holdout["last_yield_baseline_mae_t_ha"]}
        print(crop, json.dumps(results[crop]), flush=True)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=ROOT / "data/raw/faostat/QCL.zip")
    parser.add_argument("--countries", type=Path, default=ROOT / "data/raw/faostat/countries.geojson")
    parser.add_argument("--output", type=Path, default=ROOT / "src/yield_prediction/national_models")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--snapshot", type=Path, default=ROOT / "artifacts/national/faostat_history.json.gz")
    args = parser.parse_args()
    if args.download:
        download(BULK_URL, args.archive)
        download(COUNTRY_URL, args.countries)
    if args.snapshot.exists() and not args.download:
        snapshot_manifest = json.loads(args.snapshot.with_suffix(".manifest.json").read_text())
        if sha(args.snapshot) != snapshot_manifest["sha256"]:
            raise ValueError("The prepared FAOSTAT snapshot does not match its reviewed manifest")
        prepared = json.loads(gzip.decompress(args.snapshot.read_bytes()))
        history = {crop: {country: {int(year): value for year, value in values.items()}
                         for country, values in countries.items()}
                   for crop, countries in prepared["history"].items()}
        names, audit, source = prepared["names"], prepared["audit"], prepared["source"]
    else:
        if sha(args.archive) != SOURCE_SHA256 or sha(args.countries) != COUNTRY_SHA256:
            raise ValueError("Source checksum differs from the reviewed release. Review the new snapshot and its publication date before retraining.")
        history, names, audit = prepare(args.archive, args.countries)
        source = {"dataset": "FAOSTAT Crops and livestock products (QCL)", "url": BULK_URL,
              "documentation": "https://www.fao.org/faostat/en/#data/QCL", "published_on": SOURCE_PUBLISHED_ON,
              "archive_sha256": sha(args.archive), "country_mapping_url": COUNTRY_URL,
              "country_mapping_sha256": sha(args.countries), "snapshot_max_harvest_year": max(max(rows) for crop in history.values() for rows in crop.values()),
              "retrieved_on": datetime.now(timezone.utc).date().isoformat(),
              "flags": {"A": "Official figure", "E": "Estimated value", "I": "Imputed by receiving agency", "X": "External organization"}}
        prepared = {"history": history, "names": names, "audit": audit, "source": source}
        args.snapshot.parent.mkdir(parents=True, exist_ok=True)
        args.snapshot.write_bytes(gzip.compress(json.dumps(prepared, sort_keys=True, allow_nan=False).encode(), mtime=0))
        args.snapshot.with_suffix(".manifest.json").write_text(json.dumps({"sha256": sha(args.snapshot), "source": source}, indent=2) + "\n")
    source = {**source, "filtered_snapshot_sha256": sha(args.snapshot)}
    results = train(history, names, args.output, source, audit)
    report = ROOT / "artifacts/national/training_report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({"source": source, "audit": audit, "models": results}, indent=2) + "\n")


if __name__ == "__main__":
    main()
