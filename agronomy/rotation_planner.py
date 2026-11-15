"""Select evidence-based two-season crop sequences for a field."""

from dataclasses import dataclass, replace
from datetime import date, timedelta
from functools import cache
from itertools import product

from .assessment import matching_rotation_hazards
from .irrigation import assess_irrigation
from .suitability import evaluate_crop, load_crop_requirements, seasonal_water_component
from .water_screen import historical_weather, season_water_screen

PUBLISHED_LOCAL_SCOPES = {"sampled_grid_cell", "specified_agroecological_zone"}


@dataclass(frozen=True)
class Season:
    planting: date
    harvest: date | None
    source_id: str
    scope: str
    latest_planting: date
    latest_harvest: date | None
    local_calendar: bool


@dataclass(frozen=True)
class Rotation:
    crops: tuple
    seasons: tuple
    timeline_complete: bool
    local_timeline: bool
    unspecified_calendars: int
    soil_conflicts: int
    host_checks: tuple
    host_match_count: int
    repeated_crops: int
    different_families: bool
    legume_break: bool
    water_screen_mm: float | None
    allocation_shortfalls: int
    allocation_evidence: tuple


def month_day(value):
    if not isinstance(value, dict):
        return None
    month, day = value.get("month"), value.get("day")
    if type(month) is not int or type(day) is not int:
        return None
    try:
        date(2000, month, day)
    except ValueError:
        return None
    return month, day


def recurring_date(year, month_and_day):
    try:
        return date(year, *month_and_day)
    except ValueError:
        return None


def start_on_or_after(season, date_needed):
    planting = max(date_needed, season.planting)
    if planting > season.latest_planting:
        return None
    if planting == season.planting:
        return season
    harvest = season.harvest
    if harvest is not None:
        harvest += planting - season.planting
        if season.latest_harvest is None or harvest > season.latest_harvest:
            harvest = None
    return replace(season, planting=planting, harvest=harvest)


def published_seasons(entry, start, end):
    seasons = set()
    for window in entry.get("windows", []):
        if window.get("scope") not in PUBLISHED_LOCAL_SCOPES:
            continue
        planting = window.get("planting") or {}
        harvest = window.get("harvest") or {}
        start_marker = month_day(planting.get("typical")) or month_day(planting.get("earliest"))
        end_marker = month_day(harvest.get("typical")) or month_day(harvest.get("latest"))
        planting_limit = month_day(planting.get("latest"))
        harvest_limit = month_day(harvest.get("latest"))
        scope = window["scope"]
        local_calendar = scope == "specified_agroecological_zone" or window.get("source_region_level") in {2, 3}
        if not local_calendar:
            scope = "national_grid_reference" if window.get("source_region_level") == 1 else "unresolved_grid_scope"
        if start_marker is None:
            continue
        for year in range(start.year - 1, end.year + 1):
            first = recurring_date(year, start_marker)
            if first is None or first > end:
                continue
            latest_planting = first
            if planting_limit is not None:
                latest_planting = recurring_date(year + (planting_limit < start_marker), planting_limit) or first
            last = None
            latest_harvest = None
            if end_marker is not None and end_marker != start_marker:
                last = recurring_date(year + (end_marker < start_marker), end_marker)
                if last is not None and harvest_limit is not None:
                    latest_harvest = recurring_date(last.year + (harvest_limit < end_marker), harvest_limit)
            season = start_on_or_after(
                Season(first, last, window["source_id"], scope, latest_planting, latest_harvest, local_calendar),
                start,
            )
            if season is not None and season.planting <= end:
                seasons.add(season)
    return sorted(
        seasons, key=lambda s: (not s.local_calendar, s.planting, s.harvest or date.max, s.source_id, s.scope),
    )


def local_soil(inputs, provider):
    topsoil = provider.get("layers", {}).get("0-5cm", {})
    reported = inputs["source"] in {"farmer_reported", "soil_test"}
    ph, texture = topsoil.get("ph_water"), provider.get("topsoil_usda_texture")
    result = {
        "ph": ph,
        "phSource": provider.get("source_id") if ph is not None else None,
        "texture": texture.replace(" ", "_") if texture else None,
        "textureSource": provider.get("source_id") if texture else None,
    }
    if reported:
        for field in ("ph", "texture"):
            if inputs[field] is not None:
                result[field] = inputs[field]
                result[f"{field}Source"] = inputs["source"]
    return result


def soil_checks(soil, requirements):
    ph = soil["ph"]
    texture = soil["texture"]
    low, high = requirements["ph"]
    return (
        low <= ph <= high if ph is not None else None,
        texture in requirements["textures"] if texture is not None else None,
    )


def complete_rotation(first, second, horizon):
    for a in first:
        if a.harvest is None or a.harvest >= horizon:
            continue
        for candidate in second:
            b = start_on_or_after(candidate, a.harvest + timedelta(days=1))
            if b is not None and b.harvest is not None and b.harvest <= horizon:
                return a, b
    return None


def place_rotation(first, second, horizon):
    local_first = [season for season in first if season.local_calendar]
    local_second = [season for season in second if season.local_calendar]
    complete = complete_rotation(local_first, local_second, horizon) or complete_rotation(first, second, horizon)
    if complete:
        return complete, True
    a = next(iter(first), None)
    b = None
    if a and a.harvest:
        for candidate in second:
            next_season = start_on_or_after(candidate, a.harvest + timedelta(days=1))
            if next_season is not None and next_season.planting <= horizon:
                b = next_season
                break
    return (a, b), False


def season_output(crop, season, *, can_recommend=True):
    qualified = can_recommend and season is not None and season.local_calendar
    return {
        "cropId": crop,
        "recommendedPlantingDate": season.planting.isoformat() if qualified else None,
        "calendarHarvestDate": season.harvest.isoformat() if qualified and season.harvest else None,
        "calendarSource": season.source_id if season else None,
        "calendarScope": season.scope if season else None,
    }


def date_reason(entry):
    if any(window.get("source_region_level") == 1 for window in entry["windows"]):
        return "The published grid uses a national calendar. A local planting day is still unconfirmed."
    if entry["status"] == "modeled_candidates":
        return "The grid has a modeled calendar. A published local planting date is still unconfirmed."
    if entry["status"] == "regional_candidates":
        return "Published dates cover regional options. The field's agroecological zone still needs verification."
    return {
        "no_source_coverage": "The checked sources have no applicable planting date.",
        "lookup_incomplete": "A calendar lookup failed or used an older cached response.",
        "country_unresolved": "The field could not be matched to a country for a regional calendar lookup.",
    }.get(entry.get("missing_reason"), "A complete local planting day is unavailable.")


def plan_rotations(field, inputs, as_of, profiles, priority):
    crops = profiles["crops"]
    requirements = load_crop_requirements()
    horizon = as_of + timedelta(days=730)
    records = field["planting_calendars"]["crops"]
    seasons = {crop: published_seasons(records[crop], as_of, horizon) for crop in crops}
    soil = local_soil(inputs["soil"], field["soil"])
    soil_fit = {crop: soil_checks(soil, requirements[crop]) for crop in crops}
    weather = historical_weather(field["weather"], field["sample"]["latitude"])
    peak_kc = {
        crop: max(value for variant in profile["irrigation"]["variants"].values() for value in variant["kc"].values())
        for crop, profile in crops.items()
    }
    previous = inputs["previousCropId"]

    @cache
    def seasonal_water(crop, season):
        if season is None or season.harvest is None:
            return None
        return season_water_screen(weather, season.planting, season.harvest, peak_kc[crop])

    def evaluate(first, second):
        pair = first, second
        dated, timeline = place_rotation(seasons[first], seasons[second], horizon)
        water = tuple(seasonal_water(crop, season) for crop, season in zip(pair, dated))
        allocations = tuple(seasonal_water_component(crop, season, inputs) for crop, season in zip(pair, dated))
        hazards = (
            *matching_rotation_hazards(first, {previous}, profiles),
            *matching_rotation_hazards(second, {first}, profiles),
        )
        family_first, family_second = (crops[crop]["botanical_family"] for crop in pair)
        return Rotation(
            crops=pair,
            seasons=dated,
            timeline_complete=timeline,
            local_timeline=timeline and all(season.local_calendar for season in dated),
            unspecified_calendars=sum(not records[crop]["windows"] for crop in pair),
            soil_conflicts=sum(check is False for crop in pair for check in soil_fit[crop]),
            host_checks=tuple(dict.fromkeys(hazard["title"] for hazard in hazards)),
            host_match_count=len(hazards),
            repeated_crops=int(previous == first) + int(first == second),
            different_families=family_first != family_second,
            legume_break=family_first == "Fabaceae" and family_first != family_second,
            water_screen_mm=sum(value["depth_mm"] for value in water) if timeline and all(water) else None,
            allocation_shortfalls=sum(value is not None and value < 100 for value, _ in allocations),
            allocation_evidence=allocations,
        )

    def peer_key(rotation):
        return (
            rotation.allocation_shortfalls, not rotation.local_timeline, not rotation.timeline_complete, rotation.unspecified_calendars,
            rotation.host_match_count, rotation.repeated_crops,
            -sum(season is not None for season in rotation.seasons), rotation.soil_conflicts,
        )

    def water_key(rotation):
        return (
            *peer_key(rotation), rotation.water_screen_mm is None,
            rotation.water_screen_mm if rotation.water_screen_mm is not None else sum(peak_kc[c] for c in rotation.crops),
            not rotation.different_families,
            tuple(crops[crop]["name"] for crop in rotation.crops),
        )

    def soil_key(rotation):
        return (
            *peer_key(rotation), not rotation.different_families, not rotation.legume_break,
            rotation.crops == water_plan.crops,
            rotation.water_screen_mm is None,
            rotation.water_screen_mm if rotation.water_screen_mm is not None else 0.0,
            tuple(crops[crop]["name"] for crop in rotation.crops),
        )

    candidates = {(first, second): evaluate(first, second) for first, second in product(crops, repeat=2)}
    # A better dated calendar must not conceal a known soil incompatibility.
    compatible = [choice for choice in candidates.values() if not choice.soil_conflicts]
    shortlist = compatible or list(candidates.values())
    water_plan = min(shortlist, key=water_key)
    soil_plan = min(shortlist, key=soil_key)
    current = inputs["currentPlan"]
    current_pair = tuple(row["cropId"] for row in sorted(current, key=lambda row: row["seasonIndex"])) if current else (
        previous or water_plan.crops[0],
    ) * 2
    baseline = candidates[current_pair]

    def describe(plan_id, label, choice, baseline_origin):
        soil_known = soil["ph"] is not None and soil["texture"] is not None
        evidence = choice.local_timeline and choice.soil_conflicts == 0 and choice.allocation_shortfalls == 0
        if plan_id == "save-water":
            evidence = evidence and choice.water_screen_mm is not None
        elif plan_id == "improve-soil":
            evidence = evidence and soil_known and choice.different_families
        reasons = []
        if plan_id == "current":
            reasons.append("Comparison using the supplied plan." if current else "Illustrative repeated-crop comparison for this field.")
        if plan_id in {"current", "save-water"} and choice.water_screen_mm is not None:
            reasons.append(
                f"Historical two-season dry-day screening total is {round(choice.water_screen_mm)} mm."
            )
        if plan_id == "save-water" and choice.water_screen_mm is None:
            reasons.append("The historical water comparison is incomplete. The shortlist uses crop coefficients and available field evidence.")
        if choice.different_families:
            reasons.append("The two seasons use crops from different families.")
        if choice.legume_break:
            reasons.append("The first season provides a legume break before a crop from another family.")
        if plan_id == "improve-soil":
            if not choice.different_families:
                reasons.append("Crop-family diversification remains unresolved in the best-supported schedule.")
            elif not choice.legume_break:
                reasons.append("The selected sequence diversifies crop families using the available calendars and soil evidence.")
            if not soil_known:
                reasons.append("Soil pH or texture is unavailable for part of the compatibility review.")
        if choice.host_checks:
            reasons.append("Review possible carry-over risks: " + ", ".join(choice.host_checks) + ".")
        if choice.soil_conflicts:
            reasons.append("One or more soil indicators fall outside the team's reference crop ranges.")
        if choice.allocation_shortfalls:
            reasons.append("The dated effective irrigation allocation does not cover a documented seasonal net requirement.")
        if not choice.local_timeline:
            reasons.append("Placement of both seasons still needs a verified local calendar.")
        first, second = choice.seasons
        first_crop, second_crop = choice.crops
        first_harvest_known = bool(first and first.local_calendar and first.harvest)
        tradeoffs = ["The historical water screen uses the highest reference crop coefficient and same-day rain."]
        if choice.legume_break:
            tradeoffs.append("Soil effects depend on nodulation, residue management and local conditions.")
        if previous is None:
            tradeoffs.append("The previous crop is unknown, so the first rotation transition has limited evidence.")
        return {
            "planId": plan_id,
            "name": label,
            "sequence": list(choice.crops),
            "seasons": [
                season_output(first_crop, first),
                season_output(second_crop, second, can_recommend=first_harvest_known),
            ],
            "planStatus": "supported" if evidence else "provisional",
            "waterScreenMm": round(choice.water_screen_mm, 1) if choice.water_screen_mm is not None else None,
            "waterAllocationStatus": "shortfall" if choice.allocation_shortfalls else (
                "adequate" if all(value == 100 for value, _ in choice.allocation_evidence) else "insufficient_data"
            ),
            "waterAllocationEvidence": [{"cropId": crop, "componentScore": value, **details}
                                        for crop, (value, details) in zip(choice.crops, choice.allocation_evidence)],
            "rotationChecks": list(choice.host_checks),
            "reasons": reasons or ["Review the candidate using the available field records."],
            "tradeoffs": tradeoffs,
            "baselineOrigin": baseline_origin,
        }

    alternatives = [
        describe("save-water", "Save water", water_plan, "example"),
        describe("improve-soil", "Improve soil", soil_plan, "example"),
    ]
    if priority == "improve_soil":
        alternatives.reverse()
    options = []
    for crop, profile in crops.items():
        season = next((slot for slot in seasons[crop] if slot.local_calendar), None)
        reasons = [f"Planting day from {season.source_id}." if season else date_reason(records[crop])]
        for name, check in zip(("pH", "texture"), soil_fit[crop]):
            if check is None:
                reasons.append(f"Soil {name} is unavailable.")
            else:
                reference = "inside" if check else "outside"
                reasons.append(f"Field soil {name} is {reference} the team's reference range.")
        screening = evaluate_crop(crop, soil=soil, season=season, weather=field["weather"], inputs=inputs)
        reasons.extend(screening["exclusionReasons"])
        if screening["scenario"].get("completeSeasons", 0) >= 3:
            reasons.append("Temperature component uses complete historical NASA crop seasons, not a weather forecast.")
        options.append({
            "cropId": crop,
            "name": profile["name"],
            **screening,
            "recommendedPlantingDate": season.planting.isoformat() if season else None,
            "calendarStatus": records[crop]["status"],
            "reasons": reasons,
        })
    return {
        "horizon": {"start": as_of.isoformat(), "end": horizon.isoformat()},
        "soilEvidence": soil,
        "irrigationAssessment": assess_irrigation(
            inputs.get("fieldObservations"), inputs.get("irrigation"),
            area_ha=(inputs.get("analysisContext") or {}).get("areaHa"), as_of=as_of, profiles=profiles,
        ),
        "cropOptions": options,
        "rotationPlans": [
            describe("current", "Current plan" if current else "Example current plan", baseline, "farmer" if current else "example"),
            *alternatives,
        ],
    }
