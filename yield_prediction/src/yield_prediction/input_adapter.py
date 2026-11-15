"""Prepare versioned daily environmental input for the regional yield API."""

from datetime import date, timedelta
from functools import lru_cache
import json
from math import isfinite
from pathlib import Path

import pandas as pd
from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError

from .experiment import build_payload
from .features import WEATHER, WEATHER_LAG_DAYS, feature_table
from .inference import CANDIDATE_MODES, load_bundle, validate_features

COLD = "cold_start_pre_season"
PRE = "pre_season"
MID = "mid_season"
MODES = {PRE, MID, *CANDIDATE_MODES}
COMPATIBLE_WEATHER = {"CY-Bench AgERA5": "1.10", "AgERA5": "2.0"}
BOUNDS = {"tmin": (-90, 65), "tavg": (-65, 65), "tmax": (-65, 70), "prec": (0, 500),
          "rad": (0, 55_000_000), "et0": (0, 50), "vpd": (0, 150), "cwb": (-50, 500)}


@lru_cache(maxsize=2)
def schema_validator(name):
    folder = Path(__file__).with_name("schemas")
    schema = json.loads((folder / f"{name}.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def season_windows(calendar, target_year, as_of, mode):
    parsed = []
    for season in calendar["seasons"]:
        year = season["harvest_year"]
        start, end, available = (date.fromisoformat(season[key]) for key in ("start", "end", "available_on"))
        if end.year != year or not 2 <= (end - start).days + 1 <= 366:
            raise ValueError("Season dates must end in the harvest year and span 2–366 days")
        parsed.append((year, start, end, available))
    if len({row[0] for row in parsed}) != len(parsed):
        raise ValueError("Provide one calendar season per harvest year")
    ordered = sorted(parsed, key=lambda row: row[1])
    if any(previous[2] >= following[1] for previous, following in zip(ordered, ordered[1:])):
        raise ValueError("Calendar seasons overlap")
    current = next((row for row in parsed if row[0] == target_year), None)
    if current is None:
        raise ValueError("A calendar season for harvest_year is required")
    _, start, end, published = current
    pre = start - timedelta(days=1)
    midpoint = start + timedelta(days=(end - start).days // 2)
    issue = midpoint if mode == MID else pre
    if published > pre or as_of < issue:
        raise ValueError("The calendar must be known before planting and as_of must reach the forecast date")
    past = [row for row in parsed if target_year - 7 <= row[0] < target_year
            and row[2] <= pre - timedelta(days=WEATHER_LAG_DAYS) and row[3] <= pre]
    return [*past, current], pre, issue


def converted_weather(observations, units, start, pre, issue, synthetic_key):
    rows, seen, excluded = [], set(), 0
    for entry in observations:
        day, published = (date.fromisoformat(entry[key]) for key in ("date", "available_on"))
        if day in seen or published < day:
            raise ValueError("Duplicate weather date or publication before observation")
        seen.add(day)
        cutoff = pre if day < start else issue
        if published > cutoff or day > cutoff - timedelta(days=WEATHER_LAG_DAYS):
            excluded += 1
            continue
        record = {key: entry[key] for key in WEATHER}
        for key in WEATHER:
            value = record[key]
            if value is None:
                continue
            if key in {"tmin", "tmax", "tavg"} and units[key] == "K":
                value -= 273.15
            if key == "rad" and units[key] == "MJ/m2/day":
                value *= 1_000_000
            if key == "vpd" and units[key] == "kPa":
                value *= 10
            lower, upper = BOUNDS[key]
            if not isfinite(value) or not lower <= value <= upper:
                raise ValueError(f"Invalid value or unit for {key} on {day}")
            record[key] = value
        lo, mean, hi = (record[col] for col in ("tmin", "tavg", "tmax"))
        if all(value is not None for value in (lo, mean, hi)) and not lo <= mean <= hi:
            raise ValueError(f"Inconsistent temperatures on {day}")
        precip, evap, balance = (record[col] for col in ("prec", "et0", "cwb"))
        if all(value is not None for value in (precip, evap, balance)) and abs(precip - evap - balance) > .02:
            raise ValueError(f"Water balance does not equal prec - et0 on {day}")
        rows.append({"adm_id": synthetic_key, "date": day.strftime("%Y%m%d"), **record})
    return pd.DataFrame(rows, columns=["adm_id", "date", *WEATHER]).astype(
        {key: float for key in WEATHER}), excluded


def soil_features(soil, pre, diagnostics):
    values = dict.fromkeys(("awc", "bulk_density"))
    if not soil or soil["product"] != "CY-Bench WISE" or date.fromisoformat(soil["available_on"]) > pre:
        diagnostics.append({"code": "soil_unavailable", "message": "Compatible WISE soil is absent or unpublished"})
        return values
    for field, unit in (("awc", "CY-Bench WISE"), ("bulk_density", "kg/dm3")):
        value = soil.get(field)
        if value is not None and (not isfinite(value) or soil.get(f"{field}_unit") != unit):
            raise ValueError(f"Missing or invalid source unit for {field}")
        values[field] = value
    if any(value is None for value in values.values()):
        diagnostics.append({"code": "soil_incomplete", "fields": [field for field, value in values.items()
                                                                  if value is None]})
    return values


def build_model_features(raw_input, crop, mode=PRE):
    """Return validated seasonal predictors and a routing/coverage diagnostic."""
    diagnostics = []
    result = {"status": "rejected", "features": None, "requested_mode": mode,
              "diagnostics": diagnostics, "forecast_scope": "administrative_region"}

    def reject(code, message):
        diagnostics.append({"code": code, "message": message})
        return result

    if not isinstance(crop, str) or crop not in ("maize", "wheat"):
        return reject("unsupported_crop", "Regional yield supports maize and wheat")
    if not isinstance(mode, str) or mode not in MODES:
        return reject("unsupported_mode", "Unknown forecast mode")
    errors = sorted(schema_validator("raw_environmental_input").iter_errors(raw_input),
                    key=lambda err: tuple(map(str, err.absolute_path)))
    if errors:
        for error in errors[:12]:
            field = ".".join(map(str, error.absolute_path)) or "input"
            diagnostics.append({"code": "invalid_schema", "field": field, "message": error.message})
        return result

    region, weather = raw_input["region"], raw_input["weather"]
    if region["aggregation"] != "administrative_crop_mask":
        return reject("incompatible_spatial_support", "A farm point must be matched to an aggregated administrative region")
    if COMPATIBLE_WEATHER.get(weather["product"]) != weather["version"] or weather["time_standard"] != "LST":
        return reject("incompatible_weather_source", "Supply crop-mask regional AgERA5 with a documented local day")
    country = region.get("country_code", "ZZ")
    region_id = region.get("adm_id")
    verified = region["match"] == "cybench_verified"
    if verified and (country == "ZZ" or not region_id):
        return reject("invalid_region_mapping", "A verified crosswalk requires a known country and CY-Bench adm_id")
    schema_mode = CANDIDATE_MODES.get(mode, mode)
    try:
        year = raw_input["harvest_year"]
        calendar, pre, issue = season_windows(raw_input["calendar"], year,
                                               date.fromisoformat(raw_input["as_of"]), schema_mode)
        result["forecast_date"] = issue.isoformat()
        internal_key = region_id if verified else "unmapped"
        soil = soil_features(raw_input.get("soil"), pre, diagnostics)
        windows = pd.DataFrame([{
            "adm_id": internal_key, "harvest_year": harvest, "season_start": pd.Timestamp(start),
            "season_end": pd.Timestamp(end), "season_days": (end - start).days + 1,
            "pre_forecast_date": pd.Timestamp(start - timedelta(days=1)),
            "mid_weather_cutoff": pd.Timestamp(start + timedelta(days=(end - start).days // 2 - WEATHER_LAG_DAYS)),
            **soil, "latitude": region.get("latitude"), "longitude": region.get("longitude"),
        } for harvest, start, end, _ in calendar])
        days, excluded = converted_weather(weather["observations"], weather["units"], calendar[-1][1],
                                           pre, issue, internal_key)
        if excluded:
            diagnostics.append({"code": "weather_unavailable_at_forecast", "excluded_observations": excluded})
        summary = feature_table(windows, [days]).iloc[-1].copy()
        result["coverage"] = {"historical_seasons": int(summary.climate_seasons),
                              "mid_weather_fraction": float(summary.mid_weather_coverage)}
        if summary.climate_seasons < 2:
            return reject("insufficient_climate_history", "Two valid complete historical seasons are required")
        if schema_mode == MID and pd.isna(summary.mid_weather_through):
            return reject("insufficient_midseason_weather", "Midseason requires at least 95% complete eligible daily observations")
        if mode != COLD:
            bundle = load_bundle(crop, mode)
            history = bundle["history"]
            known = verified and history.at(crop, country, region_id, issue)[-1] > 0
        else:
            known = False
        if schema_mode == MID and not known:
            result["recommended_mode"] = COLD
            return reject("midseason_transfer_unverified", "Reissue as a cold-start pre-season request")
        recommended = mode if known else COLD
        bundle = load_bundle(crop, recommended)
        summary["country_code"] = country
        features = build_payload(summary, schema_mode)
        features["season_days"] = int(features["season_days"])
        if not verified:
            features.pop("adm_id")
            diagnostics.append({"code": "unmapped_region", "message": "Administrative identifier absent from verified crosswalk"})
        schema_validator("model_features").validate(features)
        validate_features({"adm_id": "unknown", **features}, schema_mode, bundle["metadata"])
        if recommended == COLD:
            diagnostics.append({"code": "experimental_cold_start", "message": "Transfer to this territory is unverified"})
        result.update(status="ready", recommended_mode=recommended, features=features)
        return result
    except (ValueError, ValidationError, ModuleNotFoundError, RuntimeError) as error:
        return reject("unusable_model_input", str(error))
