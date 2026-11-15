"""Connect dated field measurements to the existing FAO-56 water calculation."""

from datetime import date
import json

from .assessment import irrigation_screen, load_profiles, parse_date
from .suitability import finite

MODEL_VERSION = "field-water-snapshot-v1"
MAX_MEASUREMENT_AGE_DAYS = 2


def _camel(key):
    first, *rest = key.split("_")
    return first + "".join(part[:1].upper() + part[1:] for part in rest)


def _camel_result(value):
    if isinstance(value, dict):
        return {_camel(key): _camel_result(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_camel_result(item) for item in value]
    return value


def assess_irrigation(field_observations, irrigation_inputs, *, area_ha=None, as_of=None, profiles=None):
    """Return a measured snapshot; historical NASA moisture never becomes theta_now."""
    result = {
        "status": "needs_observations", "modelVersion": MODEL_VERSION, "missingFields": [],
        "calculation": None, "netRefillM3": None, "grossRefillM3": None,
        "maxObservationAgeDays": MAX_MEASUREMENT_AGE_DAYS,
        "limitations": ["A soil-water storage deficit is not an automatic irrigation instruction.",
                        "Rainfall, infiltration, irrigation capacity and the allocation period require local review.",
                        "No satellite or historical modeled moisture is substituted for measured root-zone water."],
    }
    inputs = irrigation_inputs or {}
    budget = inputs.get("waterBudget")
    result["allocationContext"] = {
        "availability": inputs.get("availability", "unknown"), "waterBudget": budget,
        "applicationEfficiency": inputs.get("applicationEfficiency"),
        "canDeliverGrossRefill": None,
    }
    if not field_observations:
        result["missingFields"] = ["fieldObservations"]
        return result
    observations = field_observations
    profiles = profiles or load_profiles()
    crop_id = observations.get("cropId")
    if crop_id not in profiles["crops"]:
        result.update(status="invalid_observations", missingFields=["fieldObservations.cropId"])
        return result
    result["cropId"] = crop_id
    for key in ("observedOn", "et0MmDay", "stage", "source"):
        if observations.get(key) is None or observations.get(key) == "":
            result["missingFields"].append(f"fieldObservations.{key}")
    if result["missingFields"]:
        return result
    try:
        observed = parse_date(observations["observedOn"], "observedOn")
        today = as_of if type(as_of) is date else parse_date(as_of, "asOf") if as_of else date.today()
    except ValueError as error:
        result.update(status="invalid_observations", message=str(error))
        return result
    age = (today - observed).days
    result.update(observedOn=observed.isoformat(), observationSource=observations["source"], observationAgeDays=age)
    if age < 0:
        result.update(status="invalid_observations", message="A measurement cannot be from the future.")
        return result
    if age > MAX_MEASUREMENT_AGE_DAYS:
        result.update(status="stale_observations", message="Take a fresh root-zone measurement before calculating a current refill.")
        return result
    profile = profiles["crops"][crop_id]
    variants = profile["irrigation"]["variants"]
    variant = observations.get("variant")
    if variant is None and len(variants) != 1:
        result.update(status="needs_variant", missingFields=["fieldObservations.variant"],
                      variants=[{"id": key, "label": value.get("label", key)} for key, value in variants.items()])
        return result
    efficiency = inputs.get("applicationEfficiency")
    if efficiency is None:
        efficiency = observations.get("applicationEfficiency")
    request = {
        "local_date": observed.isoformat(), "et0_mm_day": observations.get("et0MmDay"),
        "variant": variant, "stage": observations.get("stage"),
    }
    if observations.get("stageProgress") is not None:
        request["stage_progress"] = observations["stageProgress"]
    if efficiency is not None:
        request["application_efficiency"] = efficiency
    layers = observations.get("rootZoneLayers")
    if layers is not None and layers != []:
        if not isinstance(layers, list) or not all(isinstance(layer, dict) for layer in layers):
            result.update(status="invalid_observations", message="rootZoneLayers must be a list of measured layers.")
            return result
        request["root_zone_layers"] = [{
            "thickness_m": layer.get("thicknessM"), "theta_fc": layer.get("thetaFc"),
            "theta_wp": layer.get("thetaWp"), "theta_now": layer.get("thetaNow"),
        } for layer in layers]
    try:
        calculation = irrigation_screen(profile, request, profiles["sources"])
        json.dumps(calculation, allow_nan=False)
    except (ValueError, TypeError) as error:
        result.update(status="invalid_observations", message=str(error))
        return result
    result["calculation"] = _camel_result(calculation)
    threshold = calculation["threshold_status"]
    if threshold == "needs_root_zone_layers":
        result.update(status="needs_root_zone_layers", missingFields=["fieldObservations.rootZoneLayers"])
    elif threshold == "needs_root_zone_moisture":
        result.update(status="needs_root_zone_moisture", missingFields=["fieldObservations.rootZoneLayers.thetaNow"])
    else:
        result["status"] = "ready"
        result["thresholdReached"] = threshold == "reached"
        if finite(area_ha, lower=0) and area_ha > 0:
            result["netRefillM3"] = round(calculation["net_refill_to_field_capacity_mm"] * area_ha * 10, 3)
            if "gross_refill_at_supplied_efficiency_mm" in calculation:
                result["grossRefillM3"] = round(calculation["gross_refill_at_supplied_efficiency_mm"] * area_ha * 10, 3)
        else:
            result["missingFields"].append("fieldAreaHa")
        if efficiency is None:
            result["missingFields"].append("irrigation.applicationEfficiency")
        # Available allocation is only comparable when explicitly covering this measurement day.
        if isinstance(budget, dict) and result["grossRefillM3"] is not None:
            try:
                period_start = parse_date(budget.get("periodStart"), "allocation periodStart")
                period_end = parse_date(budget.get("periodEnd"), "allocation periodEnd")
            except ValueError:
                pass
            else:
                volume = budget.get("volumeM3")
                if period_start <= observed <= period_end and finite(volume, lower=0):
                    result["allocationContext"]["canDeliverGrossRefill"] = volume >= result["grossRefillM3"]
                    result["allocationContext"]["comparisonBasis"] = "Unspent allocation supplied by the farmer for the stated period."
    return result
