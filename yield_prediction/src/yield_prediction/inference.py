"""Validated inference against the packaged regional models."""

import json
import re
from datetime import date, timedelta
from functools import lru_cache
from importlib.metadata import version
from math import isfinite
from numbers import Integral, Real
from pathlib import Path

import joblib
import pandas as pd
from threadpoolctl import threadpool_limits

from .features import CLIMATE, MID, MODE_FEATURES, WEATHER_LAG_DAYS
from .data import file_hash
from .models import HISTORY, forecast
from .native import prepare_native_runtime

MODEL_DIR = Path(__file__).resolve().parent / "models"
CANDIDATE_DIR = MODEL_DIR.with_name("candidate_models")
CANDIDATE_MODES = {"cold_start_pre_season": "pre_season", "mid_season_v2": "mid_season"}
TIMING = {"country_code", "adm_id", "harvest_year", "season_start", "season_end",
          "climate_through", "climate_seasons"}
BOUNDS = {
    "latitude": (-90, 90), "longitude": (-180, 180), "awc": (0, 100),
    "bulk_density": (0.1, 3.5), "season_days": (2, 366),
    "temperature_c": (-65, 65), "min_temperature_c": (-90, 65),
    "max_temperature_c": (-65, 70), "temperature_sd_c": (0, 65),
    "precipitation_mm": (0, 12_000), "precipitation_mm_day": (0, 150),
    "radiation_mj_m2_day": (0, 45), "et0_mm": (0, 5_000), "vpd_kpa": (0, 15),
    "water_balance_mm": (-5_000, 12_000), "hot_days": (0, 366),
    "frost_days": (0, 366), "dry_days": (0, 366),
    "precipitation_sd_mm": (0, 12_000), "temperature_interannual_sd_c": (0, 65),
}


@lru_cache(maxsize=8)
def load_bundle(crop, mode):
    path = (CANDIDATE_DIR if mode in CANDIDATE_MODES else MODEL_DIR) / f"{crop}_{mode}.joblib"
    try:
        metadata = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"No trained model installed for {crop}/{mode}") from error
    versions = metadata["runtime"]
    if file_hash(path) != metadata["artifact_sha256"]:
        raise RuntimeError("Installed model does not match its recorded SHA-256")
    for library, expected in versions.items():
        if library != "python" and version(library) != expected:
            raise RuntimeError(f"{library}=={expected} is required by this model")
    prepare_native_runtime()
    bundle = joblib.load(path)
    stored_mode = "mid_season" if mode == "mid_season_v2" else mode
    if (bundle["metadata"]["crop"], bundle["metadata"]["mode"]) != (crop, stored_mode):
        raise ValueError("Installed model does not match the requested crop and mode")
    return bundle


def iso_date(features, key):
    value = features.get(key)
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"{key} must be a date in YYYY-MM-DD format")
    return date.fromisoformat(value)


def validate_features(features, mode, metadata):
    if not isinstance(features, dict):
        raise TypeError("features must be a dictionary")
    is_mid = mode == "mid_season"
    columns = MODE_FEATURES[mode]
    accepted = TIMING | set(columns)
    if is_mid:
        accepted |= {"mid_weather_through", "mid_weather_coverage"}
    extra = set(features) - accepted
    if extra:
        raise ValueError(f"Unknown features for {mode}: {', '.join(sorted(map(str, extra)))}")
    country, region = features.get("country_code"), features.get("adm_id")
    if not isinstance(country, str) or not re.fullmatch(r"[A-Z]{2}", country):
        raise ValueError("country_code must be a two-letter uppercase CY-Bench country code")
    if not isinstance(region, str) or not region.strip() or len(region) > 100:
        raise ValueError("adm_id must be a nonempty administrative region identifier")
    year = features.get("harvest_year")
    if isinstance(year, bool) or not isinstance(year, Integral) or not 1900 <= year <= 2100:
        raise ValueError("harvest_year must be an integer in 1900–2100")
    start, end, climate = (iso_date(features, key) for key in ("season_start", "season_end", "climate_through"))
    season_days = (end - start).days + 1
    if end.year != year or not 2 <= season_days <= 366:
        raise ValueError("Season must end in harvest_year and last between 2 and 366 days")
    pre_date = start - timedelta(days=1)
    if climate > pre_date - timedelta(days=WEATHER_LAG_DAYS) or climate.year < year - 7:
        raise ValueError("climate_through must refer to published data from prior seasons within the last seven years")
    climate_seasons = features.get("climate_seasons")
    if isinstance(climate_seasons, bool) or not isinstance(climate_seasons, Integral) or not 2 <= climate_seasons <= 5:
        raise ValueError("climate_seasons must be an integer between 2 and 5")
    forecast_date = start + timedelta(days=(season_days - 1) // 2) if is_mid else pre_date
    if forecast_date < date.fromisoformat(metadata["origin_date"]):
        raise ValueError("Forecast date precedes the trained model's evaluation origin")
    if is_mid:
        cutoff = forecast_date - timedelta(days=WEATHER_LAG_DAYS)
        weather_through = iso_date(features, "mid_weather_through")
        coverage = features.get("mid_weather_coverage")
        available_days = (cutoff - start).days + 1
        if available_days < 10 or not start <= weather_through <= cutoff:
            raise ValueError("Mid-season observations fall outside the available season window")
        if not isinstance(coverage, Real) or isinstance(coverage, bool) or not 0.95 <= coverage <= 1:
            raise ValueError("mid_weather_coverage must be in [0.95, 1]")
        if (weather_through - start).days + 1 < round(coverage * available_days):
            raise ValueError("Mid-season coverage is inconsistent with the weather date")
    required = set(CLIMATE) | {"season_days"}
    if is_mid:
        required.update(MID)
    values = {}
    for column in columns:
        value = features.get(column)
        if value is None:
            if column in required:
                raise ValueError(f"Missing required feature {column}")
            values[column] = float("nan")
            continue
        name = column.removeprefix("climate_").removeprefix("mid_")
        lower, upper = BOUNDS[name]
        if isinstance(value, bool) or not isinstance(value, Real) or not isfinite(value) or not lower <= value <= upper:
            raise ValueError(f"{column} must be a finite number in [{lower}, {upper}] in the documented units")
        values[column] = float(value)
    if values["season_days"] != season_days:
        raise ValueError("season_days does not match the dates")
    for prefix in (["climate", "mid"] if is_mid else ["climate"]):
        if not (values[f"{prefix}_min_temperature_c"] <= values[f"{prefix}_temperature_c"]
                <= values[f"{prefix}_max_temperature_c"]):
            raise ValueError(f"Inconsistent {prefix} temperature summary")
    return values, country, region, forecast_date


def predict_yield(features: dict, crop: str, mode: str = "pre_season") -> dict:
    """Predict yield in t/ha for one administrative region and growing season."""
    if not isinstance(crop, str) or crop not in ("maize", "wheat"):
        raise ValueError("Unsupported crop. Supported crops are maize and wheat.")
    if not isinstance(mode, str) or mode not in MODE_FEATURES.keys() | CANDIDATE_MODES.keys():
        raise ValueError("Unsupported mode. Use pre_season, mid_season, cold_start_pre_season, or mid_season_v2.")
    bundle = load_bundle(crop, mode)
    meta, model = (bundle[key] for key in ("metadata", "model"))
    history = bundle.get("history")
    schema_mode = CANDIDATE_MODES.get(mode, mode)
    validation_input = features
    if history is None and isinstance(features, dict) and features.get("adm_id") is None:
        # The cold-start estimator has no regional key or history input.
        validation_input = {**features, "adm_id": "unknown"}
    values, country, region, forecast_date = validate_features(validation_input, schema_mode, meta)
    warnings = ["Accuracy for individual fields has not been validated."]
    if country not in meta["countries"]:
        warnings.append("Country outside training coverage. Cross-country transfer errors may be large.")
    elif history is not None and region not in meta["country_regions"][country]:
        warnings.append("Administrative region absent from training.")
    if history is None:
        season_history, medians = [], {}
        warnings.append("Experimental cold-start country transfer; accuracy at this location is unverified.")
    else:
        season_history, medians = history.at(crop, country, region, forecast_date), history.crop_medians
        if not season_history[-1]:
            warnings.append("No eligible regional yield history. The model uses its no-history fallback.")
    if mode == "mid_season_v2":
        warnings.append("Corrected mid-season candidate; transfer to new countries is not established.")
    if features["harvest_year"] > meta["last_test_year"]:
        message = "Harvest year is beyond the evaluated period."
        if history is not None:
            message += " The model uses a frozen yield history."
        warnings.append(message)
    outside = [
        col for col, bounds in meta["schema"]["range_min_p01_p99_max"].items()
        if isfinite(values[col]) and not bounds[0] <= values[col] <= bounds[-1]
    ]
    if outside:
        warnings.append("Variables outside observed training ranges: " + ", ".join(outside))
    if any(features.get(col) is None for col in ("awc", "bulk_density", "latitude", "longitude")):
        warnings.append("Some soil or location predictors are missing.")
    payload = pd.DataFrame([{**values, "crop": crop, **dict(zip(HISTORY, season_history))}])
    with threadpool_limits(limits=2):
        prediction = float(forecast(model, payload, medians)[0])
    if not isfinite(prediction):
        raise RuntimeError("The installed model did not produce a finite forecast")
    warnings.append("A calibrated prediction interval is unavailable.")
    return {
        "crop": crop, "mode": mode, "predicted_yield_t_ha": prediction,
        "prediction_interval_t_ha": None, "model_version": meta["model_version"],
        "spatial_level": meta["spatial_level"], "warnings": warnings,
    }
