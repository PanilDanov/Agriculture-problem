"""HTTP endpoint for the orbitFarm analysis request and two-season plans."""

import os
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator
from pyproj import Geod

from .assessment import load_profiles, parse_date
from .field_context import DEFAULT_CACHE, SOURCES_PATH, collect_field_context, read_sources
from .field_geometry import field_point
from .field_providers import SourceClient
from .rotation_planner import plan_rotations
from .ml_client import YieldClient
from .water_screen import reference_eto

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
        list[Annotated[list[Annotated[list[float], Field(min_length=2, max_length=2)]], Field(min_length=4, max_length=1000)]],
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
    periodStart: CalendarDate | None = None
    periodEnd: CalendarDate | None = None

    @model_validator(mode="after")
    def check_period(self):
        if (self.periodStart is None) != (self.periodEnd is None):
            raise ValueError("Provide both allocation dates or leave both unknown.")
        if self.periodStart is not None and self.periodEnd < self.periodStart:
            raise ValueError("The allocation end must follow its start.")
        return self


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


class RootZoneLayer(Contract):
    thicknessM: Annotated[float, Field(gt=0, le=3)]
    thetaFc: Annotated[float, Field(ge=0, le=1)]
    thetaWp: Annotated[float, Field(ge=0, le=1)]
    thetaNow: Annotated[float, Field(ge=0, le=1)] | None

    @model_validator(mode="after")
    def check_retention(self):
        if self.thetaFc <= self.thetaWp:
            raise ValueError("Field capacity must exceed the wilting point.")
        return self


class SeasonalWaterBalance(Contract):
    cropId: CropId
    periodStart: CalendarDate
    periodEnd: CalendarDate
    netIrrigationRequirementMm: Annotated[float, Field(ge=0, le=10000)]
    source: Annotated[str, Field(min_length=1, max_length=500)]
    method: Annotated[str, Field(min_length=1, max_length=500)]

    @model_validator(mode="after")
    def check_period(self):
        if self.periodEnd <= self.periodStart:
            raise ValueError("A crop water-balance interval must have positive duration.")
        return self


class FieldObservations(Contract):
    observedOn: CalendarDate
    cropId: CropId
    variant: Annotated[str, Field(max_length=100)] | None = None
    stage: Literal["initial", "development", "mid_season", "late"]
    stageProgress: Annotated[float, Field(ge=0, le=1)] | None = None
    et0MmDay: Annotated[float, Field(ge=0, le=50)] | None = None
    applicationEfficiency: Annotated[float, Field(gt=0, le=1)] | None = None
    rootZoneLayers: Annotated[list[RootZoneLayer], Field(max_length=12)] = []
    source: Annotated[str, Field(min_length=1, max_length=500)]
    seasonalWaterBalance: Annotated[list[SeasonalWaterBalance], Field(max_length=20)] = []


class YieldSettings(Contract):
    mode: Literal["auto", "annual_history", "pre_season", "mid_season"] = "auto"
    harvestYear: Annotated[int, Field(ge=2000, le=2100)] | None = None


class LocalInputs(Contract):
    soil: SoilInput
    irrigation: IrrigationInput
    previousCropId: CropId | None
    currentPlan: Annotated[list[CurrentSeason], Field(min_length=2, max_length=2)] | None
    fieldObservations: FieldObservations | None = None
    seasonalWaterBalance: Annotated[list[SeasonalWaterBalance], Field(max_length=20)] | None = None
    agroEcologicalZone: Annotated[str, Field(min_length=1, max_length=100)] | None = None

    @model_validator(mode="after")
    def check_seasons(self):
        if self.currentPlan is not None and {entry.seasonIndex for entry in self.currentPlan} != {1, 2}:
            raise ValueError("The current plan must include seasons 1 and 2 once each.")
        return self


class AnalysisRequest(Contract):
    schemaVersion: Literal["1.0"]
    requestId: Annotated[str, AfterValidator(uuid_string)]
    farmId: Annotated[str, Field(min_length=1, max_length=150)]
    boundaryVersion: Annotated[int, Field(ge=1)]
    boundary: Boundary
    regionLabel: Annotated[str, Field(max_length=200)]
    localInputs: LocalInputs
    priorities: Annotated[list[Priority], Field(min_length=1, max_length=1)]
    yieldForecast: YieldSettings | None = None


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


def create_app(*, collector=None, now=None, yield_client=None):
    clock = now if now is not None else lambda: datetime.now(timezone.utc)
    ml = yield_client or YieldClient()
    if collector is None:
        sources = read_sources(Path(os.environ.get("ORBITFARM_SOURCE_CONFIG", SOURCES_PATH)))

        def collector(boundary, start, end, *, zone=None, as_of=None):
            client = SourceClient(
                Path(os.environ.get("ORBITFARM_CACHE_DIR", DEFAULT_CACHE)),
                offline=os.environ.get("ORBITFARM_OFFLINE", "") == "1",
                deadline=time.monotonic() + float(os.environ.get("ORBITFARM_SOURCE_TIMEOUT", "32")),
            )
            return collect_field_context(boundary, start, end, sources=sources, client=client,
                                         fao_zone=zone, as_of=as_of)
        use_collection_options = True
    else:
        use_collection_options = False

    service = FastAPI(title="orbitFarm field analysis", version="1.0")
    origins = os.environ.get("ORBITFARM_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    service.add_middleware(
        CORSMiddleware,
        allow_origins=[origin.strip() for origin in origins.split(",") if origin.strip()],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @service.get("/health")
    def health():
        return {"status": "ok"}

    @service.get("/ready")
    def ready():
        result = ml.ready()
        return JSONResponse(status_code=200 if result["status"] == "ready" else 503,
                            content={"status": result["status"], "fieldAnalysis": "ready", "yieldService": result})

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
        if use_collection_options:
            field = collector(boundary, historical_start, historical_end,
                              zone=request.localInputs.agroEcologicalZone, as_of=utc_day)
        else:
            field = collector(boundary, historical_start, historical_end)
        weather = field["weather"]
        if weather["status"] == "provider_error":
            return error_response(503, "WEATHER_UNAVAILABLE", "Historical NASA weather is temporarily unavailable.")
        if weather["status"] == "unavailable":
            return error_response(422, "NO_COVERAGE", "NASA POWER supplied no weather for the selected field and period.")

        local_day = (generated_at + timedelta(minutes=4 * field["sample"]["longitude"])).date()
        inputs = request.localInputs.model_dump()
        inputs["analysisContext"] = {"areaHa": area, "asOf": local_day.isoformat()}
        results = plan_rotations(field, inputs, local_day, CROP_PROFILES, request.priorities[0])
        mode = "nasa-api" if weather["request"]["retrieval"].startswith("downloaded") else "nasa-cache"
        limitations = [
            "The water comparison uses historical climates and a standard crop-coefficient screen. "
            "A whole-field irrigation decision requires effective rainfall, root-zone water and an allocation period.",
            "A complete suitability score requires dated crop-water balance evidence; unknown factors remain unknown.",
            "Calendar grids and soil maps describe regional conditions. Field information may refine a plan.",
        ]
        if inputs["irrigation"]["waterBudget"] is not None and not inputs["irrigation"]["waterBudget"].get("periodStart"):
            limitations.append("The supplied field-inlet allocation is shown as context. Its effective delivery over the two seasons is unverified.")
        alternatives = results["rotationPlans"][1:]
        if alternatives[0]["sequence"] == alternatives[1]["sequence"]:
            limitations.append("Both priorities selected the same pair from the available evidence.")
        settings = request.yieldForecast or YieldSettings()
        forecasts = ml.forecasts(boundary, field["country"].get("country_code"), utc_day.isoformat(),
                                 harvest_year=settings.harvestYear, mode=settings.mode)
        recent = recent_weather_summary(field.get("recentWeather"), field["sample"]["latitude"])
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
            "recentWeather": recent,
            "yieldForecasts": forecasts,
            "assumptions": [
                f"Historical reference period: {historical_start.year}–{historical_end.year}.",
                "Planting dates use location-qualified published calendar days within a 730-day planning horizon.",
                "The planning start uses the field's approximate local solar date.",
            ],
            "limitations": limitations,
            "modelVersion": "field-analysis-v2",
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

    frontend = os.environ.get("ORBITFARM_FRONTEND_DIR")
    if frontend:
        @service.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
        @service.api_route("/index.html", methods=["GET", "HEAD"], include_in_schema=False)
        def frontend_index():
            return HTMLResponse((Path(frontend) / "index.html").read_text(encoding="utf-8"),
                                headers={"Cache-Control": "no-store"})
        service.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return service


def recent_weather_summary(weather, latitude):
    if not weather or weather.get("status") not in ("available", "partial"):
        return {"status": "unavailable", "source": "NASA POWER Daily", "reason": "Recent observations are unavailable."}
    records = weather.get("records", [])
    if not records:
        return {"status": "unavailable", "source": "NASA POWER Daily"}
    temperatures = [row["temperature_mean_c"] for row in records if row.get("temperature_mean_c") is not None]
    rain = [row["precipitation_mm"] for row in records if row.get("precipitation_mm") is not None]
    coordinates = (weather.get("source_geometry") or {}).get("coordinates") or []
    elevation = coordinates[2] if len(coordinates) > 2 else None
    eto = reference_eto(records[-1], date.fromisoformat(records[-1]["date"]), latitude, elevation) if elevation is not None else None
    return {"status": weather["status"], "periodStart": records[0]["date"], "periodEnd": records[-1]["date"],
            "meanTemperatureC": round(mean(temperatures), 2) if len(temperatures) == len(records) else None,
            "precipitationMm": round(sum(rain), 2) if len(rain) == len(records) else None,
            "latestEt0MmDay": round(eto, 3) if eto is not None else None,
            "observedOn": records[-1]["date"], "source": "NASA POWER Daily"}


app = create_app()
