"""Versioned, inspectable crop screening from known field and NASA evidence.

The crop table supplies reference ranges, not a fitted yield/success model.
Missing factors remain unknown; weights are never renormalized.
"""

import csv
import json
import math
from datetime import date, timedelta
from functools import cache
from pathlib import Path
from statistics import mean

from .assessment import canonical_crop_id, parse_date

MODEL_VERSION = "crop-reference-screen-v1"
WEIGHTS = {"temperature": .35, "soilPh": .25, "water": .30, "soilTexture": .10}
MINIMUM_HISTORICAL_SEASONS = 3
REFERENCE_SOURCE = "AgroWise_crop_requirements_clean.csv"


def finite(value, *, lower=None, upper=None):
    return (type(value) in (int, float) and math.isfinite(value)
            and (lower is None or value >= lower) and (upper is None or value <= upper))


@cache
def load_crop_requirements():
    path = Path(__file__).resolve().parents[1] / REFERENCE_SOURCE
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return {
            canonical_crop_id(row["crop"]): {
                "ph": (float(row["soil_ph_min"]), float(row["soil_ph_max"])),
                "textures": {value.replace(" ", "_") for value in json.loads(row["soil_type"])},
                "meanTemperature": (float(row["mean_temp_min_c"]), float(row["mean_temp_max_c"])),
                "temperatureBounds": (float(row["min_temp_c"]), float(row["max_temp_c"])),
            }
            for row in csv.DictReader(stream, strict=True)
        }


def season_dates(season):
    if season is None:
        return None
    if isinstance(season, dict):
        start = season.get("planting") or season.get("recommendedPlantingDate") or season.get("periodStart")
        end = season.get("harvest") or season.get("calendarHarvestDate") or season.get("periodEnd")
    else:
        start, end = getattr(season, "planting", None), getattr(season, "harvest", None)
    try:
        start = start if type(start) is date else parse_date(start, "season start")
        end = end if type(end) is date else parse_date(end, "season end")
    except ValueError:
        return None
    return (start, end) if 0 <= (end - start).days <= 730 else None


def reference_temperature_score(value, requirements):
    """100 inside the team's mean range, linear shoulders to reference limits."""
    low, high = requirements["meanTemperature"]
    minimum, maximum = requirements["temperatureBounds"]
    if low <= value <= high:
        return 100.0
    if value <= minimum or value >= maximum:
        return 0.0
    if value < low:
        return 100 * (value - minimum) / (low - minimum)
    return 100 * (maximum - value) / (maximum - high)


def temperature_component(weather, season, requirements, *, as_of=None):
    interval = season_dates(season)
    diagnostic = {"kind": "historical_climate_scenario", "source": "NASA POWER Daily",
                  "completeSeasons": 0, "minimumSeasons": MINIMUM_HISTORICAL_SEASONS,
                  "referenceSource": REFERENCE_SOURCE, "isForecast": False}
    if interval is None:
        diagnostic["missingReason"] = "A complete crop planting-to-harvest interval is required."
        return None, diagnostic
    start, end = interval
    cutoff = start
    if as_of is not None:
        try:
            issued = as_of if type(as_of) is date else parse_date(as_of, "analysis asOf")
        except ValueError:
            diagnostic["missingReason"] = "A valid analysis cutoff is required."
            return None, diagnostic
        cutoff = min(cutoff, issued + timedelta(days=1))
    diagnostic.update(periodStart=start.isoformat(), periodEnd=end.isoformat())
    diagnostic["observationsBefore"] = cutoff.isoformat()
    if not isinstance(weather, dict) or weather.get("status") in {"provider_error", "unavailable"}:
        diagnostic["missingReason"] = "Historical NASA weather is unavailable."
        return None, diagnostic
    provenance = weather.get("request") or {}
    diagnostic.update(retrieval=provenance.get("retrieval"), sourceVersion=weather.get("version"),
                      sourceUrl=weather.get("documentation"))
    if provenance.get("retrieval") == "stale_cache":
        diagnostic["missingReason"] = "Refresh stale historical weather before completing the screen."
        return None, diagnostic
    rows = {}
    duplicates = False
    for record in weather.get("records", []):
        try:
            day = parse_date(record.get("date"), "weather date")
        except (AttributeError, ValueError):
            continue
        duplicates = duplicates or day in rows
        rows[day] = record
    if duplicates:
        diagnostic["missingReason"] = "Duplicate NASA weather dates cannot form a complete season."
        return None, diagnostic
    scores, summaries = [], []
    for year in sorted({day.year for day in rows}):
        try:
            first = start.replace(year=year)
            last = end.replace(year=year + end.year - start.year)
        except ValueError:
            continue
        if last >= cutoff:
            continue
        days = (last - first).days + 1
        records = [rows.get(first + timedelta(days=offset)) for offset in range(days)]
        if any(record is None or not all(finite(record.get(key), lower=-100, upper=80)
                                        for key in ("temperature_min_c", "temperature_mean_c", "temperature_max_c"))
               or not record["temperature_min_c"] <= record["temperature_mean_c"] <= record["temperature_max_c"]
               for record in records):
            continue
        value = mean(record["temperature_mean_c"] for record in records)
        minimum, maximum = requirements["temperatureBounds"]
        excursion_days = sum(record["temperature_min_c"] < minimum or record["temperature_max_c"] > maximum
                             for record in records)
        summaries.append({"start": first.isoformat(), "end": last.isoformat(),
                          "meanTemperatureC": round(value, 3),
                          "belowReferenceDays": sum(record["temperature_min_c"] < minimum for record in records),
                          "aboveReferenceDays": sum(record["temperature_max_c"] > maximum for record in records),
                          "outOfReferenceDayFraction": round(excursion_days / days, 4)})
        scores.append(reference_temperature_score(value, requirements) * (1 - excursion_days / days))
    diagnostic.update(completeSeasons=len(scores), seasons=summaries)
    if len(scores) < MINIMUM_HISTORICAL_SEASONS:
        diagnostic["missingReason"] = "At least three complete historical crop seasons are required."
        return None, diagnostic
    return round(mean(scores), 2), diagnostic


def seasonal_balances(inputs):
    """Keep seasonal planning independent from current measured observations."""
    supplied = inputs.get("seasonalWaterBalance")
    return supplied if supplied is not None else (inputs.get("fieldObservations") or {}).get("seasonalWaterBalance") or []


def seasonal_water_component(crop_id, season, inputs, area_ha=None):
    """Compare net requirement and allocation only on an identical explicit period."""
    interval = season_dates(season)
    irrigation = inputs.get("irrigation") or {}
    observations = inputs.get("fieldObservations") or {}
    context = inputs.get("analysisContext") or {}
    area_ha = area_ha if area_ha is not None else context.get("areaHa")
    diagnostic = {"method": "documented-net-requirement-vs-effective-allocation-v1",
                  "missingFields": [], "isIrrigationDose": False}
    if interval is None:
        diagnostic["missingFields"].append("cropSeason")
        return None, diagnostic
    start, end = (day.isoformat() for day in interval)
    diagnostic.update(periodStart=start, periodEnd=end)
    requirements = seasonal_balances(inputs)
    matching = [row for row in requirements if row.get("cropId") == crop_id
                and row.get("periodStart") == start and row.get("periodEnd") == end]
    if len(matching) != 1:
        diagnostic["missingFields"].append("documentedSeasonalNetIrrigationRequirement")
        return None, diagnostic
    requirement = matching[0]
    need = requirement.get("netIrrigationRequirementMm")
    if not finite(need, lower=0) or not all(isinstance(requirement.get(key), str)
                                           and requirement[key].strip() for key in ("source", "method")):
        diagnostic["missingFields"].append("documentedSeasonalNetIrrigationRequirement")
        return None, diagnostic
    diagnostic.update(netRequirementMm=need, source=requirement["source"], method=requirement["method"])
    # A documented zero net need is already rainfed-adequate and needs no allocation.
    if need == 0:
        diagnostic["effectiveAllocationMm"] = None
        return 100.0, diagnostic
    if irrigation.get("availability") == "none":
        diagnostic.update(effectiveAllocationMm=0.0, allocationBasis="No irrigation access was reported.")
        return 0.0, diagnostic
    budget = irrigation.get("waterBudget")
    if not isinstance(budget, dict):
        diagnostic["missingFields"].append("irrigation.waterBudget")
        return None, diagnostic
    if budget.get("basis") != "field_inlet" or budget.get("periodStart") != start or budget.get("periodEnd") != end:
        diagnostic["missingFields"].append("matchingAllocationPeriod")
    if not finite(area_ha, lower=0) or area_ha == 0:
        diagnostic["missingFields"].append("fieldAreaHa")
    volume = budget.get("volumeM3")
    if not finite(volume, lower=0):
        diagnostic["missingFields"].append("irrigation.waterBudget.volumeM3")
    efficiency = irrigation.get("applicationEfficiency")
    if efficiency is None:
        efficiency = observations.get("applicationEfficiency")
    if volume == 0:
        efficiency = 1.0  # Known zero remains zero for every possible positive efficiency.
    if not finite(efficiency, lower=0, upper=1) or efficiency == 0:
        diagnostic["missingFields"].append("irrigation.applicationEfficiency")
    if diagnostic["missingFields"]:
        return None, diagnostic
    depth = volume * efficiency / (10 * area_ha)
    diagnostic.update(grossAllocationM3=volume, applicationEfficiency=efficiency,
                      effectiveAllocationMm=round(depth, 3), areaHa=area_ha)
    return round(100 * min(1, depth / need), 2), diagnostic


def evaluate_crop(crop_id, *, soil, season, weather, inputs, area_ha=None):
    requirements = load_crop_requirements()[canonical_crop_id(crop_id)]
    period_origin = "published_calendar"
    if season_dates(season) is None:
        supplied = [row for row in seasonal_balances(inputs)
                    if row.get("cropId") == crop_id and season_dates(row) is not None
                    and isinstance(row.get("source"), str) and row["source"].strip()]
        if len(supplied) == 1:
            season = supplied[0]
            period_origin = "farmer_supplied_water_balance_period"
    components = dict.fromkeys(WEIGHTS)
    missing, exclusions = [], []
    temperature, scenario = temperature_component(
        weather, season, requirements, as_of=(inputs.get("analysisContext") or {}).get("asOf"),
    )
    scenario["periodOrigin"] = period_origin
    components["temperature"] = temperature
    ph = soil.get("ph")
    if finite(ph, lower=0, upper=14):
        low, high = requirements["ph"]
        components["soilPh"] = 100.0 if low <= ph <= high else 0.0
        if not low <= ph <= high:
            exclusions.append("Known soil pH is outside the team's crop reference range.")
    texture = soil.get("texture")
    if texture is not None:
        components["soilTexture"] = 100.0 if texture in requirements["textures"] else 0.0
        if texture not in requirements["textures"]:
            exclusions.append("Known soil texture is outside the team's crop reference list.")
    components["water"], water_evidence = seasonal_water_component(crop_id, season, inputs, area_ha)
    for key, value in components.items():
        if value is None:
            missing.append(key)
    known = round(sum(WEIGHTS[key] for key, value in components.items() if value is not None), 2)
    complete = not missing and not exclusions
    return {
        "score": round(sum(WEIGHTS[key] * value for key, value in components.items()), 2) if complete else None,
        "scoreStatus": "complete" if complete else "insufficient_data",
        "evaluationStatus": "excluded" if exclusions else "evaluated" if complete else "insufficient_data",
        "componentScores": components, "componentWeights": WEIGHTS.copy(), "knownWeight": known,
        "missingFields": missing, "exclusionReasons": exclusions,
        "scoringModelVersion": MODEL_VERSION, "scenario": scenario, "waterEvidence": water_evidence,
        "referenceSource": REFERENCE_SOURCE,
        "limitations": ["Reference screening is not a probability of harvest success or a yield forecast.",
                        "Historical crop-season temperature does not predict the upcoming season.",
                        "Reference-range exclusions are policy constraints from the team's table, not cultivar-specific tolerance limits."],
    }
