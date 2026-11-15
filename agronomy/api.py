"""HTTP endpoint for the orbitFarm analysis request and two-season plans."""

import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator
from pyproj import Geod

from .assessment import load_profiles, parse_date
from .field_context import DEFAULT_CACHE, SOURCES_PATH, collect_field_context, read_sources
from .field_geometry import field_point
from .field_providers import SourceClient
from .rotation_planner import plan_rotations

CROP_PROFILES = load_profiles()
WGS84 = Geod(ellps="WGS84")
HISTORY_YEARS = 4


def crop_id(value):
    if value not in CROP_PROFILES["crops"]:
        raise ValueError("Unknown crop ID.")
    return value


def uuid_string(value):
    try:
        parsed = UUID(value)
    except ValueError as error:
        raise ValueError("Use a hyphenated UUID for requestId.") from error
    if str(parsed) != value.lower():
        raise ValueError("Use a hyphenated UUID for requestId.")
    return value


CropId = Annotated[str, AfterValidator(crop_id)]
CalendarDate = Annotated[str, AfterValidator(lambda value: parse_date(value, "sampledOn").isoformat())]
Texture = Literal[
    "sand", "loamy_sand", "sandy_loam", "loam", "silt_loam", "silt", "sandy_clay_loam",
    "clay_loam", "silty_clay_loam", "sandy_clay", "silty_clay", "clay",
]
Priority = Literal["balanced", "save_water", "improve_soil"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Boundary(Contract):
    type: Literal["Polygon"]
    coordinates: Annotated[
        list[Annotated[list[Annotated[list[float], Field(min_length=2, max_length=2)]], Field(min_length=4)]],
        Field(min_length=1, max_length=1),
    ]

    @model_validator(mode="after")
    def check_polygon(self):
        field_point(self.model_dump())
        return self


class SoilInput(Contract):
    ph: Annotated[float, Field(ge=0, le=14)] | None
    texture: Texture | None
    source: Literal["farmer_reported", "soil_test", "synthetic", "unknown"]
    sampledOn: CalendarDate | None


class WaterBudget(Contract):
    volumeM3: Annotated[float, Field(ge=0)]
    basis: Literal["field_inlet"]


class IrrigationInput(Contract):
    availability: Literal["available", "none", "unknown"]
    method: Literal["drip", "sprinkler", "surface"] | None
    waterBudget: WaterBudget | None
    applicationEfficiency: Annotated[float, Field(gt=0, le=1)] | None

    @model_validator(mode="after")
    def check_access(self):
        if self.availability == "none" and (
            (self.waterBudget is not None and self.waterBudget.volumeM3 > 0)
            or self.method is not None or self.applicationEfficiency is not None
        ):
            raise ValueError("No irrigation access allows only a zero or unknown allocation.")
        if self.availability == "unknown" and any(
            value is not None for value in (self.waterBudget, self.method, self.applicationEfficiency)
        ):
            raise ValueError("Unknown access requires an unknown allocation, method and efficiency.")
        return self


class CurrentSeason(Contract):
    seasonIndex: Annotated[int, Field(ge=1, le=2)]
    cropId: CropId


class LocalInputs(Contract):
    soil: SoilInput
    irrigation: IrrigationInput
    previousCropId: CropId | None
    currentPlan: Annotated[list[CurrentSeason], Field(min_length=2, max_length=2)] | None

    @model_validator(mode="after")
    def check_seasons(self):
        if self.currentPlan is not None and {entry.seasonIndex for entry in self.currentPlan} != {1, 2}:
            raise ValueError("The current plan must include seasons 1 and 2 once each.")
        return self


class AnalysisRequest(Contract):
    schemaVersion: Literal["1.0"]
    requestId: Annotated[str, AfterValidator(uuid_string)]
    farmId: Annotated[str, Field(min_length=1)]
    boundaryVersion: Annotated[int, Field(ge=1)]
    boundary: Boundary
    regionLabel: str
    localInputs: LocalInputs
    priorities: Annotated[list[Priority], Field(min_length=1, max_length=1)]


def area_hectares(boundary):
    longitudes, latitudes = zip(*boundary["coordinates"][0])
    square_meters, _ = WGS84.polygon_area_perimeter(longitudes, latitudes)
    return abs(square_meters) / 10000


def weather_signals(weather, historical_end):
    """Show observations from the last requested historical year."""
    records = [row for row in weather["records"] if row["date"][:4] == str(historical_end.year)]
    metadata = weather["request"]
    source = {
        "dataset": "NASA POWER Daily",
        "url": weather["documentation"],
        "version": weather.get("version") or "Daily API",
    }
    stale = metadata["retrieval"] == "stale_cache"

    def signal(key, label, unit, column, reduction, complete_year=True):
        values = [(row["date"], row[column]) for row in records if row.get(column) is not None]
        day = values[-1][0] if values else historical_end.isoformat()
        is_complete = len(values) == (historical_end - date(historical_end.year, 1, 1)).days + 1
        value = reduction([number for _, number in values]) if values and (is_complete or not complete_year) else None
        return {
            "signalId": key,
            "label": label,
            "value": round(value, 3) if value is not None else None,
            "unit": unit,
            "origin": "nasa",
            "observedAt": f"{day}T00:00:00Z",
            "fetchedAt": metadata["retrieved_at_utc"],
            "quality": "missing" if value is None else "stale" if stale else "good",
            "spatialResolutionKm": None,
            "source": source,
        }

    year = historical_end.year
    return [
        signal("temperature", f"{year} mean air temperature", "°C", "temperature_mean_c", mean),
        signal("rainfall", f"{year} total precipitation", "mm", "precipitation_mm", sum),
        signal("soil-moisture", "Most recent modeled root-zone moisture in history", "m³/m³",
               "modeled_root_zone_moisture", lambda values: values[-1], complete_year=False),
    ]


def error_response(status_code, code, message):
    return JSONResponse(status_code=status_code, content={"code": code, "message": message})


def create_app(*, collector=None, now=None):
    clock = now if now is not None else lambda: datetime.now(timezone.utc)
    if collector is None:
        sources = read_sources(Path(os.environ.get("ORBITFARM_SOURCE_CONFIG", SOURCES_PATH)))
        client = SourceClient(
            Path(os.environ.get("ORBITFARM_CACHE_DIR", DEFAULT_CACHE)),
            offline=os.environ.get("ORBITFARM_OFFLINE", "") == "1",
        )

        def collector(boundary, start, end):
            return collect_field_context(boundary, start, end, sources=sources, client=client)

    service = FastAPI(title="orbitFarm field analysis", version="1.0")
    origins = os.environ.get("ORBITFARM_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    service.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins.split(",") if origin.strip()],
        allow_methods=["POST"],
        allow_headers=["Content-Type"],
    )

    @service.get("/health")
    def health():
        return {"status": "ok"}

    @service.post("/v1/analysis")
    def analysis(request: AnalysisRequest):
        boundary = request.boundary.model_dump()
        area = area_hectares(boundary)
        if area < 0.000001:
            return error_response(422, "INVALID_BOUNDARY", "The boundary must enclose a positive field area.")
        generated_at = clock()
        utc_day = generated_at.date()
        historical_start = date(utc_day.year - HISTORY_YEARS, 1, 1)
        historical_end = date(utc_day.year - 1, 12, 31)
        field = collector(boundary, historical_start, historical_end)
        weather = field["weather"]
        if weather["status"] == "provider_error":
            return error_response(503, "WEATHER_UNAVAILABLE", "Historical NASA weather is temporarily unavailable.")
        if weather["status"] == "unavailable":
            return error_response(422, "NO_COVERAGE", "NASA POWER supplied no weather for the selected field and period.")

        local_day = (generated_at + timedelta(minutes=4 * field["sample"]["longitude"])).date()
        inputs = request.localInputs.model_dump()
        results = plan_rotations(field, inputs, local_day, CROP_PROFILES, request.priorities[0])
        mode = "nasa-api" if weather["request"]["retrieval"] == "downloaded" else "nasa-cache"
        limitations = [
            "The water comparison uses historical climates and a standard crop-coefficient screen. "
            "A whole-field irrigation decision requires effective rainfall, root-zone water and an allocation period.",
            "The complete crop suitability score remains unknown without a validated root-zone water assessment.",
            "Calendar grids and soil maps describe regional conditions. Field information may refine a plan.",
        ]
        if inputs["irrigation"]["waterBudget"] is not None:
            limitations.append("The supplied field-inlet allocation is shown as context. Its effective delivery over the two seasons is unverified.")
        alternatives = results["rotationPlans"][1:]
        if alternatives[0]["sequence"] == alternatives[1]["sequence"]:
            limitations.append("Both priorities selected the same pair from the available evidence.")
        return {
            "schemaVersion": request.schemaVersion,
            "analysisId": str(uuid4()),
            "requestId": request.requestId,
            "farmId": request.farmId,
            "boundaryVersion": request.boundaryVersion,
            "areaHa": area,
            "generatedAt": generated_at.isoformat(),
            "dataMode": mode,
            "signals": weather_signals(weather, historical_end),
            "assumptions": [
                f"Historical reference period: {historical_start.year}–{historical_end.year}.",
                "Planting dates use location-qualified published calendar days within a 730-day planning horizon.",
                "The planning start uses the field's approximate local solar date.",
            ],
            "limitations": limitations,
            "modelVersion": "two-season-screen-v1",
            "irrigationContext": inputs["irrigation"],
            "location": {**field["sample"], "countryCode": field["country"].get("country_code")},
            "dataSources": {
                "weather": {
                    "source": weather["documentation"],
                    "request": weather["request"],
                    "timeStandard": weather.get("time_standard"),
                },
                "soil": field["soil"].get("documentation"),
                "calendars": field["planting_calendars"].get("sources", {}),
            },
            **results,
        }

    return service


app = create_app()
