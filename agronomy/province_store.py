"""Geometry-bound inputs for the separately trained NASA/MAPA province models."""

from datetime import date
import gzip
import hashlib
import io
import json
from functools import lru_cache
from pathlib import Path

from shapely.geometry import Point, shape


@lru_cache(maxsize=4)
def read_release(directory, registry_stamp, weather_stamp):
    directory = Path(directory)
    registry = json.loads((directory / "registry.json").read_text())
    if registry.get("schemaVersion") != "1.0" or registry.get("countryCode") != "ES":
        raise ValueError("Unsupported province input release")
    path = directory / "weather.json.gz"
    if path.stat().st_size > 8_000_000:
        raise ValueError("Province weather archive exceeds its supported size")
    body = path.read_bytes()
    if hashlib.sha256(body).hexdigest() != registry["weatherSha256"]:
        raise ValueError("Province weather SHA-256 mismatch")
    with gzip.GzipFile(fileobj=io.BytesIO(body)) as archive:
        unpacked = archive.read(32_000_001)
    if len(unpacked) > 32_000_000:
        raise ValueError("Province weather data exceed their supported size")
    weather = json.loads(unpacked)["records"]
    return registry, weather


class ProvinceInputStore:
    def __init__(self, directory=None):
        self.directory = Path(directory) if directory else Path(__file__).with_name("province_inputs")

    def select(self, boundary, crop, mode, harvest_year, as_of):
        missing = {"status": "unavailable", "code": "PROVINCE_INPUTS_UNAVAILABLE",
                   "reason": "No verified province weather dataset is installed for this field."}
        try:
            path = self.directory
            if not (path / "registry.json").is_file() or not (path / "weather.json.gz").is_file():
                return missing
            registry, weather = read_release(str(path.resolve()), (path / "registry.json").stat().st_mtime_ns,
                                            (path / "weather.json.gz").stat().st_mtime_ns)
            if date.fromisoformat(as_of) < date.fromisoformat(registry["asOf"]):
                raise ValueError("The province snapshot was not available at the requested analysis date")
            if not isinstance(boundary, dict) or boundary.get("type") != "Polygon":
                raise ValueError("A valid field polygon is required")
            field = shape(boundary)
            if field.is_empty or not field.is_valid:
                raise ValueError("A valid field polygon is required")
            matches = [row for row in registry["regions"] if shape(row["geometry"]).covers(field)]
            if len(matches) != 1:
                return {**missing, "code": "PROVINCE_MATCH_UNVERIFIED",
                        "reason": "The complete field must fit inside exactly one verified Spanish province."}
            region = matches[0]
            identity = region["regionId"]
            values = weather[identity]
            if (values["product"] != "NASA POWER Monthly" or values["support"] != "representative_point"
                    or abs(values["latitude"] - region["latitude"]) > 1e-6
                    or abs(values["longitude"] - region["longitude"]) > 1e-6
                    or not shape(region["geometry"]).covers(Point(region["longitude"], region["latitude"]))):
                raise ValueError("Province geometry and NASA representative point do not match")
            if mode not in ("pre_season", "mid_season"):
                raise ValueError("Province weather models require an explicit seasonal mode")
            return {"status": "available", "mode": mode, "regionId": identity,
                    "regionName": region["name"], "inputAsOf": registry["asOf"],
                    "weatherSupport": "representative_point", "experimental": True,
                    "provinceInput": {"countryCode": "ES", "regionId": identity,
                                      "harvestYear": harvest_year, "asOf": as_of, "weather": values}}
        except (OSError, ValueError, KeyError, TypeError, AttributeError, EOFError) as error:
            return {**missing, "code": "PROVINCE_INPUTS_INVALID", "reason": str(error)}
