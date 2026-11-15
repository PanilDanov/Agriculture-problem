"""Evaluate FAO reference water demand and screen a field's rotation history."""

import argparse
import json
import math
from datetime import date
from pathlib import Path


def load_profiles():
    path = Path(__file__).with_name("crop_profiles.json")
    return json.loads(path.read_text(encoding="utf-8"))


def number(value, field, minimum=0, maximum=None):
    if (
        type(value) not in (int, float)
        or not math.isfinite(value)
        or value < minimum
        or (maximum is not None and value > maximum)
    ):
        raise ValueError(f"Invalid value for {field}")
    return value


def parse_date(value, field):
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            pass
        else:
            if parsed.isoformat() == value:
                return parsed
    raise ValueError(f"{field} requires a date in YYYY-MM-DD format")


def object_input(value, field):
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return value


def canonical_crop_id(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("crop_id must be a nonempty string")
    return {"faba_bean": "faba-bean"}.get(value, value)


def soil_water(layers, adjusted_p, efficiency):
    if not isinstance(layers, list) or not layers:
        raise ValueError("root_zone_layers must be a nonempty list")

    taw = 0
    depletion = 0
    rooting_depth = 0
    moisture_complete = True
    for index, item in enumerate(layers, start=1):
        layer = object_input(item, f"root-zone layer {index}")
        thickness = number(layer.get("thickness_m"), "thickness_m")
        capacity = number(layer.get("theta_fc"), "theta_fc", maximum=1)
        wilting = number(layer.get("theta_wp"), "theta_wp", maximum=1)
        if thickness == 0 or capacity <= wilting:
            raise ValueError("Each layer requires thickness > 0 and theta_fc > theta_wp")
        rooting_depth += thickness
        layer_taw = 1000 * (capacity - wilting) * thickness
        taw += layer_taw

        if layer.get("theta_now") is None:
            moisture_complete = False
            continue
        current = number(layer["theta_now"], "theta_now", maximum=1)
        layer_depletion = 1000 * (capacity - current) * thickness
        depletion += min(layer_taw, max(0, layer_depletion))

    raw = taw * adjusted_p
    result = {
        "active_root_depth_m": round(rooting_depth, 5),
        "total_available_water_mm": round(taw, 3),
        "readily_available_water_mm": round(raw, 3),
        "threshold_status": "needs_root_zone_moisture",
    }
    if moisture_complete:
        result.update(
            root_zone_depletion_mm=round(depletion, 3),
            threshold_status="reached" if depletion >= raw else "below",
            net_refill_to_field_capacity_mm=round(depletion, 3),
        )
        if efficiency is not None:
            result["gross_refill_at_supplied_efficiency_mm"] = round(depletion / efficiency, 3)
    return result


def irrigation_screen(profile, inputs, sources):
    irrigation = profile["irrigation"]
    variants = irrigation["variants"]
    variant_id = inputs.get("variant")
    if variant_id is None and len(variants) == 1:
        variant_id = next(iter(variants))
    if not isinstance(variant_id, str) or variant_id not in variants:
        raise ValueError(f"Select an irrigation variant from {', '.join(variants)}")
    variant = variants[variant_id]
    local_date = parse_date(inputs.get("local_date"), "local_date")
    et0 = number(inputs.get("et0_mm_day"), "et0_mm_day")
    kc = variant["kc"]
    kc_basis = "fao56_rev1_reference_conditions"
    local_kc = inputs.get("local_kc")
    if local_kc is not None:
        local_kc = object_input(local_kc, "local_kc")
        source = local_kc.get("source")
        if not isinstance(source, str) or not source.strip():
            raise ValueError("local_kc requires a source or a description of the adjustment")
        kc = {key: number(local_kc.get(key), f"local_kc.{key}") for key in kc}
        kc_basis = source

    stage = inputs.get("stage")
    if stage == "initial":
        stage_kc = kc["initial"]
    elif stage == "mid_season":
        stage_kc = kc["mid_season"]
    elif stage == "development":
        progress = number(inputs.get("stage_progress"), "stage_progress", maximum=1)
        stage_kc = kc["initial"] + progress * (kc["mid_season"] - kc["initial"])
    elif stage == "late":
        progress = number(inputs.get("stage_progress"), "stage_progress", maximum=1)
        stage_kc = kc["mid_season"] + progress * (kc["end"] - kc["mid_season"])
    else:
        raise ValueError("stage must be initial, development, mid_season or late")

    etc = stage_kc * et0
    p_ref = irrigation["reference_depletion_fraction_at_etc_5_mm_day"]
    p_source = "fao56_rev1_surface_irrigation_reference"
    if "local_depletion" in inputs:
        local_p = object_input(inputs["local_depletion"], "local_depletion")
        p_ref = number(local_p.get("p_at_etc_5_mm_day"), "p_at_etc_5_mm_day", 0.1, 0.8)
        p_source = local_p.get("source")
        if not isinstance(p_source, str) or not p_source.strip():
            raise ValueError("local_depletion requires a source or an adjustment description")
    adjusted_p = min(0.8, max(0.1, p_ref + 0.04 * (5 - etc)))
    kc_reference = irrigation["kc_root_height_source"]
    p_reference = irrigation["depletion_source"]
    result = {
        "local_date": local_date.isoformat(),
        "variant": variant_id,
        "stage": stage,
        "et0_mm_day": et0,
        "kc": round(stage_kc, 5),
        "kc_basis": kc_basis,
        "kc_reference": {**kc_reference, "url": sources[kc_reference["source_id"]]["url"]},
        "etc_standard_mm_day": round(etc, 3),
        "max_effective_root_depth_reference_m": variant["max_effective_root_depth_m"],
        "adjusted_depletion_fraction": round(adjusted_p, 5),
        "depletion_basis": p_source,
        "depletion_reference": {**p_reference, "url": sources[p_reference["source_id"]]["url"]},
        "threshold_status": "needs_root_zone_layers",
    }

    efficiency = inputs.get("application_efficiency")
    if efficiency is not None:
        efficiency = number(efficiency, "application_efficiency", maximum=1)
        if efficiency == 0:
            raise ValueError("application_efficiency must be greater than 0")
    if inputs.get("root_zone_layers") is not None:
        result.update(soil_water(inputs["root_zone_layers"], adjusted_p, efficiency))
    return result


def matching_rotation_hazards(crop_id, preceding_crops, profiles):
    return [
        hazard for hazard in profiles["rotation_hazards"]
        if crop_id in hazard["candidate_crops"]
        and any(host in preceding_crops for host in hazard["preceding_crops"])
    ]


def rotation_screen(crop_id, inputs, profiles):
    planting = parse_date(inputs.get("planting_date"), "planting_date")
    coverage_start = inputs.get("history_complete_since")
    if coverage_start is not None:
        coverage_start = parse_date(coverage_start, "history_complete_since")
        if coverage_start >= planting:
            raise ValueError("history_complete_since must be before planting_date")

    history = inputs.get("history")
    if history is None:
        return {"status": "needs_field_history", "matches": []}
    if not isinstance(history, list):
        raise ValueError("history must be a list of field crop records")

    latest_by_crop = {}
    for item in history:
        record = object_input(item, "history record")
        previous_crop = canonical_crop_id(record.get("crop_id"))
        harvested = parse_date(record.get("harvest_date"), "harvest_date")
        if harvested > planting:
            raise ValueError("Each history harvest_date must be on or before planting_date")
        latest_by_crop[previous_crop] = max(harvested, latest_by_crop.get(previous_crop, harvested))

    matches = []
    for hazard in matching_rotation_hazards(crop_id, latest_by_crop, profiles):
        host_dates = {
            host: latest_by_crop[host].isoformat()
            for host in hazard["preceding_crops"]
            if host in latest_by_crop
        }
        if host_dates:
            most_recent = date.fromisoformat(max(host_dates.values()))
            matches.append({
                "hazard_id": hazard["id"],
                "title": hazard["title"],
                "latest_harvest_by_matching_crop": host_dates,
                "days_since_latest_matching_harvest": (planting - most_recent).days,
                "review": hazard["review"],
                "evidence": [
                    {**item, "url": profiles["sources"][item["source_id"]]["url"]}
                    for item in hazard["evidence"]
                ],
            })

    last_harvest = max(latest_by_crop.values(), default=None)
    if matches:
        status = "review_recorded_crop_matches"
    elif coverage_start is None:
        status = "needs_history_coverage"
    else:
        status = "no_catalog_match_in_supplied_history"
    return {
        "status": status,
        "history_complete_since": coverage_start.isoformat() if coverage_start else None,
        "same_crop_in_latest_recorded_harvest": (
            last_harvest is not None and latest_by_crop.get(crop_id) == last_harvest
        ),
        "uncatalogued_history_crops": sorted(latest_by_crop.keys() - profiles["crops"].keys()),
        "matches": matches,
        "local_review": [
            "Verify pathogens, cultivar susceptibility and host crops or weeds using local guidance.",
            "Check adjacent residue, cover crops, volunteers and legally applicable herbicide plant-back intervals.",
        ],
    }


def assess(request, profiles):
    request = object_input(request, "request")
    crop_id = canonical_crop_id(request.get("crop_id"))
    if crop_id not in profiles["crops"]:
        raise ValueError(f"Unsupported candidate crop: {crop_id}")
    if "irrigation" not in request and "rotation" not in request:
        raise ValueError("Provide irrigation, rotation or both")
    profile = profiles["crops"][crop_id]
    result = {
        "schema_version": profiles["schema_version"],
        "crop_id": crop_id,
        "crop_name": profile["name"],
        "yield_forecast_scope": profile["yield_forecast_scope"],
    }
    if "irrigation" in request:
        result["irrigation"] = irrigation_screen(
            profile, object_input(request["irrigation"], "irrigation"), profiles["sources"]
        )
    if "rotation" in request:
        result["rotation"] = rotation_screen(
            crop_id, object_input(request["rotation"], "rotation"), profiles
        )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request_json", type=Path)
    args = parser.parse_args()
    try:
        request = json.loads(args.request_json.read_text(encoding="utf-8-sig"))
        result = assess(request, load_profiles())
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
