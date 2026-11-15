"""Experimental provincial yield models with NASA representative-point weather.

These are separate from the crop-mask CY-Bench estimators. Monthly provincial
calendar approximations and revised historical archives support retrospective
evaluation, not a reconstruction of what was published at a historical issue.
"""
from __future__ import annotations

import calendar as month_calendar
from datetime import date, timedelta
from functools import lru_cache
import hashlib
from importlib.metadata import version
import json
from math import isfinite
from pathlib import Path
import re

import joblib
import numpy as np

from .national import CROP_ITEMS

PROVINCE_DIR = Path(__file__).with_name("province_models")
MODES = ("pre_season", "mid_season")
WEATHER_KEYS = ("temperatureMeanC", "precipitationMmDay", "solarRadiationMjM2Day")
BASE_FEATURES = ["log_lag1", "log_lag2", "log_lag3", "log_lag4", "log_lag5",
                 "log_mean3", "log_mean5", "log_std5", "yield_trend", "label_age_years", "year_since_2000",
                 "climate_temperature", "climate_precipitation", "climate_radiation",
                 "climate_temperature_std", "climate_precipitation_std", "climate_radiation_std",
                 "mid_temperature", "mid_precipitation", "mid_radiation", "mid_fraction"]


def season_window(crop_calendar, year):
    """Approximate dates from modal published sowing/harvest months, explicitly."""
    sow, harvest = crop_calendar["sowing_month"], crop_calendar["harvest_month"]
    if any(isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 12 for value in (sow, harvest)):
        raise ValueError("Audited modal sowing and harvest months are required")
    return (date(year - (sow > harvest), sow, 1),
            date(year, harvest, month_calendar.monthrange(year, harvest)[1]))


def issue_date(crop_calendar, year, mode):
    start, end = season_window(crop_calendar, year)
    if mode not in MODES:
        raise ValueError("Provincial models support pre_season and mid_season")
    return start - timedelta(days=1) if mode == "pre_season" else start + (end - start) // 2


def label_cutoff_year(crop_calendar, target_year, mode):
    start, _ = season_window(crop_calendar, target_year)
    return target_year - (3 if mode == "pre_season" and start.year < target_year else 2)


def monthly_weather(weather, *, as_of):
    """Validate normalized NASA values, rejecting annual summaries and fills."""
    if (not isinstance(weather, dict) or weather.get("product") != "NASA POWER Monthly"
            or weather.get("support") != "representative_point" or weather.get("timeStandard") != "LST"):
        raise ValueError("NASA POWER Monthly representative-point observations are required")
    if not isinstance(weather.get("version"), str) or not weather["version"]:
        raise ValueError("NASA weather version is required")
    provenance = weather.get("provenance")
    if not isinstance(provenance, dict) or not re.fullmatch(r"[a-f0-9]{64}", provenance.get("sha256", "")):
        raise ValueError("NASA response SHA-256 provenance is required")
    if not isinstance(provenance.get("url"), str) or not provenance["url"].startswith("https://power.larc.nasa.gov/"):
        raise ValueError("NASA source URL is required")
    retrieved = provenance.get("retrievedAt")
    if not isinstance(retrieved, str) or date.fromisoformat(retrieved[:10]) > as_of:
        raise ValueError("NASA retrieval cannot postdate the input archive asOf")
    rows = weather.get("observations")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 2400:
        raise ValueError("A bounded monthly weather archive is required")
    result = {}
    for row in rows:
        if not isinstance(row, dict) or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", row.get("month", "")):
            raise ValueError("Weather months must be YYYY-MM, excluding annual summaries")
        key = row["month"]
        if key in result:
            raise ValueError("Duplicate NASA weather month")
        available_string = row.get("availableOn")
        if not isinstance(available_string, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", available_string):
            raise ValueError("Monthly observations require actual availableOn dates")
        available = date.fromisoformat(available_string)
        if available > as_of:
            continue
        values = [row.get(name) for name in WEATHER_KEYS]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) for value in values):
            raise ValueError("Monthly observations require finite temperature, precipitation and radiation")
        if not -90 <= values[0] <= 65 or not 0 <= values[1] <= 150 or not 0 <= values[2] <= 60:
            raise ValueError("Monthly weather values are outside their physical input bounds")
        result[key] = tuple(float(value) for value in values)
    return result


def _summary(weather, start, end, *, cutoff):
    months, values, missing = [], [], []
    cursor = start.replace(day=1)
    while cursor <= end:
        last = cursor.replace(day=month_calendar.monthrange(cursor.year, cursor.month)[1])
        key = cursor.strftime("%Y-%m")
        if last <= cutoff and key in weather:
            months.append(key)
            values.append((*weather[key], (last - cursor).days + 1))
        elif last <= cutoff:
            missing.append(key)
        cursor = (last + timedelta(days=1)).replace(day=1)
    if not values:
        return None
    array = np.asarray(values)
    days = float(array[:, 3].sum())
    metrics = np.asarray([np.sum(array[:, 0] * array[:, 3]) / days,
                          np.sum(array[:, 1] * array[:, 3]), np.sum(array[:, 2] * array[:, 3])])
    return metrics, int(days), months[-1], missing


def make_features(history, weather, crop_calendar, target_year, mode, *, as_of, provinces, province_id,
                  max_label_age=3, historical_label_cutoff=None):
    """Target yields and weather after the nominal observation cutoff are excluded."""
    issued = issue_date(crop_calendar, target_year, mode)
    if as_of < issued:
        raise ValueError("The input archive asOf precedes the nominal forecast issue date")
    start, end = season_window(crop_calendar, target_year)
    label_cutoff = (label_cutoff_year(crop_calendar, target_year, mode) if historical_label_cutoff is None
                    else min(historical_label_cutoff, target_year - 1))
    eligible = sorted(year for year, value in history.items() if year <= label_cutoff and value > 0)
    if len(eligible) < 5:
        raise ValueError("Five preceding positive observed provincial yields are required")
    years = eligible[-5:]
    if years[-1] - years[0] != 4:
        raise ValueError("The five latest observed provincial yields must be consecutive")
    label_age = target_year - years[-1]
    if not 1 <= label_age <= max_label_age:
        raise ValueError("The frozen observed yield history is too old for this forecast horizon")
    yields = np.asarray([history[year] for year in years], dtype=float)
    if not np.isfinite(yields).all() or (yields <= 0).any():
        raise ValueError("Provincial yields must be finite positive t/ha")
    logged = np.log(yields)
    base = [*logged[::-1], np.log(yields[-3:].mean()), np.log(yields.mean()), np.log1p(yields.std()),
            float(np.polyfit(np.asarray(years) - years[0], logged, 1)[0]), label_age, (target_year - 2000) / 10]
    climate, climate_through = [], []
    for year in range(target_year - 1, target_year - 8, -1):
        past_start, past_end = season_window(crop_calendar, year)
        if past_end >= start or past_end > as_of - timedelta(days=14):
            continue
        summary = _summary(weather, past_start, past_end, cutoff=past_end)
        if summary is not None and summary[1] == (past_end - past_start).days + 1:
            climate.append(summary[0])
            climate_through.append(summary[2])
        if len(climate) == 5:
            break
    if len(climate) < 5:
        raise ValueError("Five complete preceding seasonal monthly-weather histories are required")
    climate_array = np.asarray(climate)
    base.extend([*climate_array.mean(axis=0), *climate_array.std(axis=0)])
    mid_through = None
    if mode == "mid_season":
        cutoff = min(issued, as_of) - timedelta(days=14)
        mid = _summary(weather, start, end, cutoff=cutoff)
        if mid is None:
            raise ValueError("No complete current-season weather month precedes the midpoint minus 14 days")
        if mid[3]:
            raise ValueError("Current-season weather has missing eligible months before the midpoint cutoff: " + ", ".join(mid[3]))
        fraction = mid[1] / ((end - start).days + 1)
        base.extend([*mid[0], fraction])
        mid_through = mid[2]
    else:
        fraction = 0.0
        base.extend([0.0, 0.0, 0.0, 0.0])
    if province_id not in provinces:
        raise ValueError("No audited provincial model coverage is available for this region")
    base.extend(float(code == province_id) for code in provinces)
    return np.asarray(base, dtype=float), {
        "forecastDate": issued.isoformat(), "seasonStart": start.isoformat(), "seasonEnd": end.isoformat(),
        "dataThrough": mid_through or max(climate_through), "climateThrough": max(climate_through),
        "historicalWeatherSeasons": len(climate), "currentSeasonWeatherFraction": fraction,
        "labelDataThrough": years[-1], "labelAgeYears": label_age,
        "labelCutoffYear": label_cutoff,
        "weatherSupport": "point_proxy", "availabilityInterpretation": "retrospective_observation_cutoff",
        "observationLatencyDays": 14,
    }


@lru_cache(maxsize=20)
def load_province(crop, mode):
    if crop not in CROP_ITEMS or mode not in MODES:
        raise ValueError("Unsupported provincial crop or mode")
    stem = PROVINCE_DIR / f"{crop}_{mode}"
    metadata = json.loads(stem.with_suffix(".json").read_text())
    path = stem.with_suffix(".joblib")
    if hashlib.sha256(path.read_bytes()).hexdigest() != metadata["artifact_sha256"]:
        raise RuntimeError("Provincial model checksum mismatch")
    for library, expected in metadata["runtime"].items():
        if version(library) != expected:
            raise RuntimeError(f"{library}=={expected} is required by the provincial model")
    bundle = joblib.load(path)
    if (bundle["crop"] != crop or bundle["mode"] != mode or bundle["model_version"] != metadata["model_version"]
            or metadata["features"] != [*BASE_FEATURES, *("province_" + code for code in metadata["provinces"])]) :
        raise RuntimeError("Provincial model schema or identity mismatch")
    return bundle, metadata


def province_readiness():
    models = []
    for crop in CROP_ITEMS:
        for mode in MODES:
            try:
                _, metadata = load_province(crop, mode)
                models.append({"crop": crop, "mode": mode, "status": "ready", "releaseStatus": "experimental",
                               "modelVersion": metadata["model_version"], "provinces": len(metadata["provinces"]),
                               "weatherSupport": "point_proxy", "qualityStatus": metadata["quality_status"]})
            except (OSError, ValueError, RuntimeError, ImportError, KeyError) as error:
                models.append({"crop": crop, "mode": mode, "status": "unavailable", "reason": str(error)})
    count = sum(row["status"] == "ready" for row in models)
    return {"status": "ready" if count == 20 else "degraded", "readyModels": count,
            "expectedModels": 20, "models": models}


def predict_province_yield(*, crop, mode, province_input):
    if not isinstance(province_input, dict) or set(province_input) != {"countryCode", "regionId", "harvestYear", "asOf", "weather"}:
        raise ValueError("provinceInput requires countryCode, regionId, harvestYear, asOf and weather")
    if province_input["countryCode"] != "ES":
        raise ValueError("The audited provincial release is limited to Spain")
    region = province_input["regionId"]
    if not isinstance(region, str) or not re.fullmatch(r"\d{2}", region):
        raise ValueError("regionId must be the audited two-digit INE provincial code")
    if not isinstance(province_input["asOf"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", province_input["asOf"]):
        raise ValueError("asOf must be an archive date in YYYY-MM-DD")
    as_of = date.fromisoformat(province_input["asOf"])
    if as_of > date.today():
        raise ValueError("The input archive asOf cannot be in the future")
    year = province_input["harvestYear"]
    if isinstance(year, bool) or not isinstance(year, int) or not 2000 <= year <= 2100:
        raise ValueError("harvestYear must be an integer between 2000 and 2100")
    bundle, metadata = load_province(crop, mode)
    if year <= metadata["training_through"]:
        raise ValueError("Forecast target must follow the frozen model training period")
    if region not in bundle["regions"]:
        raise ValueError("No observed labels and audited calendar support this crop in this province")
    info = bundle["regions"][region]
    weather = province_input["weather"]
    if not isinstance(weather, dict):
        raise ValueError("A normalized NASA monthly weather object is required")
    for name in ("latitude", "longitude"):
        value = weather.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or abs(value - info["point"][name]) > 1e-6:
            raise ValueError("Weather coordinates do not match the registered representative point")
    for source in (metadata["source"], info["calendar"]["source"]):
        verified = source.get("verified_available_on") or source.get("published_on")
        if not verified or as_of < date.fromisoformat(verified):
            raise ValueError("The input archive asOf precedes publication of the frozen source")
    parsed = monthly_weather(weather, as_of=as_of)
    history = {int(row[0]): float(row[1]) for row in info["history"]}
    features, diagnostics = make_features(history, parsed, info["calendar"], year, mode,
                                         as_of=as_of, provinces=metadata["provinces"], province_id=region)
    prediction = float(np.exp(float(bundle["model"].predict(features.reshape(1, -1))[0])))
    if not isfinite(prediction) or prediction <= 0:
        raise RuntimeError("The provincial estimator did not produce a finite positive yield")
    warnings = [
        "Experimental provincial yield estimate; individual-field accuracy has not been validated.",
        "NASA weather represents one fixed point in the province, not a crop-mask or field-area average.",
        "Sowing and harvest dates are modal-month approximations from published 2014-2016 provincial calendars, not observed target-year planting dates.",
        "Historical weather and yield archives are revised snapshots; validation uses observation cutoffs and does not reconstruct historical publication availability.",
        "The 14-day observation exclusion is a conservative modelling policy, not a guarantee of NASA publication latency.",
        "Official statistical yield targets retain the source's area definitions, which change across table vintages; they are not uniform individual-field measurements.",
        "No calibrated prediction interval is available.",
        *info["calendar"].get("warnings", []),
    ]
    if metadata["quality_status"] != "beats_last_yield_on_holdout":
        warnings.append("The estimator did not beat the last-observed-yield baseline in every holdout check; do not treat this model as validated for decisions.")
    if diagnostics["labelAgeYears"] > 1:
        warnings.append(f"The latest observed provincial yield predates the target by {diagnostics['labelAgeYears']} years; no missing annual yield has been invented.")
    forecast = {"crop": crop, "mode": mode, "predicted_yield_t_ha": prediction,
                "prediction_interval_t_ha": None, "spatial_level": "administrative_region",
                "country_code": "ES", "region_id": region, "region_name": info["name"],
                "harvest_year": year, "forecast_date": diagnostics["forecastDate"],
                "model_version": metadata["model_version"], "quality_status": metadata["quality_status"],
                "release_status": "experimental", "weather_support": "representative_point",
                "data_through": diagnostics["dataThrough"], "training_through": metadata["training_through"],
                "target_definition": metadata["source"].get("target_definition"),
                "source": {"labels": metadata["source"], "calendar": info["calendar"]["source"],
                           "weather": weather["provenance"], "geometry": info["geometry_source"]},
                "validation": metadata["validation"], "warnings": warnings}
    diagnostics.update(source={"region": {"adm_id": region, "country_code": "ES", "aggregation": "representative_point"},
                               "weather": "NASA POWER Monthly", "weatherVersion": weather["version"]},
                       releaseStatus="experimental", artifactSha256=metadata["artifact_sha256"], inputAsOf=province_input["asOf"],
                       forecastScope="administrative_region", resolvedMode=mode, usesCurrentSeasonWeather=mode == "mid_season")
    return forecast, diagnostics
