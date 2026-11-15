"""Versioned national annual-yield forecasts from real FAOSTAT histories.

These models use preceding reported yields and time, not field weather or NASA.
Their spatial support is a country and their issue mode is annual_history.
"""
from __future__ import annotations

from datetime import date
from functools import lru_cache
import hashlib
from importlib.metadata import version
import json
from math import isfinite
from pathlib import Path
import re

import joblib
import numpy as np

NATIONAL_DIR = Path(__file__).with_name("national_models")
CROP_ITEMS = {
    "wheat": ("15", "Wheat"), "barley": ("44", "Barley"),
    "maize": ("56", "Maize (corn)"), "sorghum": ("83", "Sorghum"),
    "chickpea": ("191", "Chick peas; dry"), "lentil": ("201", "Lentils; dry"),
    "faba-bean": ("181", "Broad beans and horse beans; dry"),
    "sunflower": ("267", "Sunflower seed"), "potato": ("116", "Potatoes"),
    "tomato": ("388", "Tomatoes"),
}
FEATURES = ["log_lag1", "log_lag2", "log_lag3", "log_lag4", "log_lag5",
            "log_mean3", "log_mean5", "log_std5", "trend5", "year_since_2000"]
MAX_HORIZON = 5


def model_features(history, target_year):
    """Five consecutive preceding yields only; never reads the target year."""
    years = list(range(target_year - 5, target_year))
    if any(year not in history for year in years):
        raise ValueError("Five consecutive preceding annual yields are required")
    values = np.asarray([history[year] for year in years], dtype=float)
    if not np.isfinite(values).all() or (values <= 0).any():
        raise ValueError("Yield history must contain finite positive t/ha observations")
    logged = np.log(values)
    return np.asarray([*logged[::-1], np.log(values[-3:].mean()),
                       np.log(values.mean()), np.log1p(values.std()),
                       float(np.polyfit(np.arange(5), logged, 1)[0]),
                       (target_year - 2000) / 10], dtype=float)


@lru_cache(maxsize=10)
def load_national(crop):
    if crop not in CROP_ITEMS:
        raise ValueError("Unsupported crop; national models cover the ten product crop IDs")
    metadata_path = NATIONAL_DIR / f"{crop}.json"
    model_path = NATIONAL_DIR / f"{crop}.joblib"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if hashlib.sha256(model_path.read_bytes()).hexdigest() != metadata["artifact_sha256"]:
        raise RuntimeError("National model SHA-256 does not match its manifest")
    for library, expected in metadata["runtime"].items():
        if version(library) != expected:
            raise RuntimeError(f"{library}=={expected} is required by the national model")
    bundle = joblib.load(model_path)
    if bundle["crop"] != crop or bundle["model_version"] != metadata["model_version"]:
        raise RuntimeError("National model identity does not match its manifest")
    if metadata.get("spatial_level") != "country" or metadata.get("features") != FEATURES:
        raise RuntimeError("Incompatible national model schema")
    return bundle, metadata


def national_readiness():
    models = []
    for crop in CROP_ITEMS:
        try:
            _, meta = load_national(crop)
            models.append({"crop": crop, "status": "ready", "mode": "annual_history",
                           "modelVersion": meta["model_version"],
                           "spatialLevel": "country", "countries": len(meta["countries"]),
                           "qualityStatus": meta["quality_status"]})
        except (OSError, ValueError, RuntimeError, ImportError) as error:
            models.append({"crop": crop, "status": "unavailable", "reason": str(error)})
    ready = sum(model["status"] == "ready" for model in models)
    return {"status": "ready" if ready == len(CROP_ITEMS) else "degraded" if ready else "unavailable",
            "readyModels": ready, "expectedModels": len(CROP_ITEMS), "models": models}


def predict_national_yield(*, crop, country_code, harvest_year=None, as_of=None):
    if not isinstance(country_code, str) or not re.fullmatch(r"[A-Z]{2}", country_code):
        raise ValueError("country_code must be a two-letter uppercase ISO country code")
    if as_of is None:
        issue = date.today()
    elif isinstance(as_of, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of):
        issue = date.fromisoformat(as_of)
    else:
        raise ValueError("as_of must be a calendar date in YYYY-MM-DD")
    if issue > date.today():
        raise ValueError("as_of cannot be in the future")
    bundle, metadata = load_national(crop)
    # Revised FAOSTAT snapshots cannot prove what a historical operator knew.
    if issue < date.fromisoformat(metadata["source"]["published_on"]):
        raise ValueError("as_of precedes publication of this frozen FAOSTAT snapshot")
    year = issue.year if harvest_year is None else harvest_year
    if isinstance(year, bool) or not isinstance(year, int) or not 1966 <= year <= 2100:
        raise ValueError("harvest_year must be an integer between 1966 and 2100")
    if year < issue.year:
        raise ValueError("Historical replay is not a live annual-history forecast")
    records = bundle["history"].get(country_code)
    if not records:
        raise ValueError(f"No observed {crop} yield history is available for country {country_code}")
    history = {int(row[0]): float(row[1]) for row in records}
    last_year = max(history)
    if year <= last_year:
        raise ValueError("harvest_year must follow the latest observed yield")
    horizon = year - last_year
    if horizon > MAX_HORIZON:
        raise ValueError(f"Forecast horizon exceeds {MAX_HORIZON} years from the latest observed yield")
    if metadata["training_through"] >= year:
        raise ValueError("Forecast target overlaps the model training period")
    model = bundle["model"]
    predictions = []
    for target in range(last_year + 1, year + 1):
        features = model_features(history, target).reshape(1, -1)
        log_prediction = float(model.predict(features)[0])
        prediction = float(np.exp(log_prediction))
        if not isfinite(prediction) or prediction <= 0:
            raise RuntimeError("The national model did not produce a finite positive forecast")
        history[target] = prediction
        predictions.append({"harvestYear": target, "predictedYieldTHa": prediction})
    warnings = [
        "National annual yield estimate; accuracy for an individual field has not been validated.",
        "This annual-history model uses reported yield history and time, not current-season NASA weather.",
        "FAOSTAT labels can be revised; source flags distinguish official, estimated and external observations.",
        "Validation is retrospective by harvest year, not an archive of historical publication dates.",
        "A calibrated prediction interval is unavailable.",
    ]
    if crop == "tomato":
        warnings.append("The FAOSTAT tomato target combines production systems; it is not specific to open-field tomato.")
    if crop in {"faba-bean", "chickpea", "lentil"}:
        warnings.append("The FAOSTAT target is dry harvested pulses, not fresh green pods.")
    if horizon > 1:
        warnings.append(f"{horizon}-year recursive forecast from the last reported yield; uncertainty increases with horizon.")
    if metadata["quality_status"] != "beats_last_yield_on_holdout":
        warnings.append("This crop's held-out error did not improve on the last-yield baseline; treat the model as experimental.")
    return {
        "crop": crop, "mode": "annual_history", "predicted_yield_t_ha": predictions[-1]["predictedYieldTHa"],
        "prediction_interval_t_ha": None, "model_version": metadata["model_version"],
        "spatial_level": "country", "country_code": country_code, "country_name": bundle["country_names"][country_code],
        "harvest_year": year, "forecast_date": issue.isoformat(), "data_through": str(last_year),
        "training_through": metadata["training_through"], "forecast_horizon_years": horizon,
        "quality_status": metadata["quality_status"], "source": metadata["source"],
        "target_product": metadata["target_product"], "target_unit": metadata["target_unit"],
        "validation": metadata["validation"], "recursive_predictions": predictions, "warnings": warnings,
    }
