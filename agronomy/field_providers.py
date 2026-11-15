"""Download and normalize NASA POWER weather and SoilGrids point estimates."""

import hashlib
import json
import math
import os
import tempfile
import time
import zlib
from concurrent.futures import ThreadPoolExecutor, Future, TimeoutError
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock, BoundedSemaphore

import requests
from rasterio.warp import transform
from rasterio.io import MemoryFile

from data_pipeline import (
    SOIL_NATIVE_CRS, SOIL_WCS_CRS, parse_power_daily, sample_soil_pixel, usda_texture,
)


class SourceError(RuntimeError):
    pass


class BoundedExecutor:
    """A process-wide fixed worker/queue budget; timed-out requests cannot grow threads."""
    def __init__(self, workers, capacity, name):
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=name)
        self.slots = BoundedSemaphore(capacity)

    def submit(self, operation, *args, remaining=0, **kwargs):
        if not self.slots.acquire(timeout=max(0.0, remaining)):
            failed = Future()
            failed.set_exception(SourceError("The bounded source worker budget was exhausted."))
            return failed
        try:
            future = self.pool.submit(operation, *args, **kwargs)
        except BaseException:
            self.slots.release()
            raise
        future.add_done_callback(lambda _: self.slots.release())
        return future


SOIL_WORKERS = BoundedExecutor(4, 8, "orbitfarm-soil")


def remaining_time(client):
    operation = getattr(client, 'remaining', None)
    value = operation() if operation is not None else None
    return max(0.0, float(value)) if isinstance(value, (float, int)) else 35.0


def source_future_result(future, client):
    """Already completed values remain usable after the other source's deadline."""
    return future.result(timeout=0 if future.done() else remaining_time(client))


@dataclass(frozen=True)
class Retrieval:
    value: object
    provenance: dict


def write_atomic(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
    try:
        temporary.write_bytes(contents)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def bytes_as_tiff(body):
    if body[:4] not in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"):
        raise ValueError("The coverage service did not return a GeoTIFF.")
    with MemoryFile(body) as memory, memory.open() as raster:
        if raster.count < 1 or raster.crs is None:
            raise ValueError("The soil coverage is missing a band or coordinate system.")
    return body


class SourceClient:
    """Cache raw responses by GET URL so results can be inspected and replayed."""

    _locks = tuple(Lock() for _ in range(64))

    def __init__(self, cache_dir, *, offline=False, refresh=False, deadline=None):
        self.cache_dir = Path(cache_dir)
        self.offline = offline
        self.refresh = refresh
        self.deadline = deadline

    def remaining(self):
        return max(0.0, self.deadline - time.monotonic()) if self.deadline is not None else 60.0

    def get(self, url, *, params=None, ttl_days=7, decode=json.loads, validate=None):
        request_url = requests.Request("GET", url, params=params).prepare().url
        key = hashlib.sha256(request_url.encode("utf-8")).hexdigest()
        lock = self._locks[int(key[:8], 16) % len(self._locks)]
        if not lock.acquire(timeout=self.remaining()):
            raise SourceError("The source collection deadline was reached.")
        try:
            return self._get(request_url, key, ttl_days, decode, validate)
        finally:
            lock.release()

    def _get(self, request_url, key, ttl_days, decode, validate):
        path = self.cache_dir / f"{key}.bin"
        def checked(body):
            value = decode(body)
            if validate is not None:
                validate(value)
            return value
        cached = None
        if path.exists():
            try:
                body = path.read_bytes()
                fetched = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
                cached = (checked(body), body, fetched)
            except (OSError, ValueError, RuntimeError, KeyError, TypeError, EOFError, zlib.error):
                # A corrupt or semantically invalid response must not become a fresh hit.
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass

        if self.offline:
            if cached is None:
                raise SourceError(f"No cached response for {request_url}")
            result, body, fetched = cached
            cache_status = "offline_cache"
        elif cached and not self.refresh and (datetime.now(timezone.utc) - cached[2]).total_seconds() < ttl_days * 86400:
            result, body, fetched = cached
            cache_status = "fresh_cache"
        else:
            try:
                remaining = self.remaining()
                if remaining < 0.05:
                    raise SourceError("The source collection deadline was reached.")
                for attempt in range(2):
                    try:
                        response = requests.get(
                            request_url, timeout=(min(3.0, remaining), min(8.0, remaining)),
                            headers={"User-Agent": "OrbitFarm-FieldData/2.0"},
                        )
                        response.raise_for_status()
                        body = response.content
                        result = checked(body)
                        break
                    except requests.RequestException as error:
                        if attempt or cached or self.remaining() < 1:
                            raise
                        status = getattr(getattr(error, "response", None), "status_code", None)
                        if status is not None and status not in (429, 500, 502, 503, 504):
                            raise
                        time.sleep(min(0.2, self.remaining()))
                        remaining = self.remaining()
                fetched = datetime.now(timezone.utc)
                cache_status = "downloaded"
                try:
                    write_atomic(path, body)
                except OSError:
                    cache_status = "downloaded_uncached"
            except (requests.RequestException, OSError, ValueError, RuntimeError, KeyError, TypeError, EOFError, zlib.error) as error:
                if cached is None:
                    raise SourceError(f"Could not retrieve {request_url}: {error}") from error
                result, body, fetched = cached
                cache_status = "stale_cache"
        return Retrieval(result, {
            "url": request_url,
            "retrieved_at_utc": fetched.isoformat(),
            "sha256": hashlib.sha256(body).hexdigest(),
            "cache_file": path.name,
            "retrieval": cache_status,
        })


def fetch_weather(client, source, longitude, latitude, start, end):
    columns = source["parameters"]
    def parse_payload(payload):
        if not isinstance(payload, dict) or not isinstance(payload.get("header"), dict):
            raise ValueError("Unexpected NASA POWER response.")
        if payload["header"].get("time_standard") != source["time_standard"]:
            raise ValueError("NASA POWER returned an unexpected day convention.")
        optional = set(source.get("optional_parameters", []))
        returned = payload.get("properties", {}).get("parameter", {})
        requested = tuple(code for code in columns if code not in optional or code in returned)
        return parse_power_daily(payload, start, end, requested).reindex(columns=list(columns))
    request = client.get(source["endpoint"], params={
        "parameters": ",".join(columns),
        "community": "AG",
        "latitude": latitude,
        "longitude": longitude,
        "start": start.strftime("%Y%m%d"),
        "end": end.strftime("%Y%m%d"),
        "format": "JSON",
        "time-standard": source["time_standard"],
    }, ttl_days=source["ttl_days"], validate=parse_payload)
    payload = request.value
    optional = set(source.get("optional_parameters", []))
    daily = parse_payload(payload)
    header = payload["header"]
    if header.get("time_standard") != source["time_standard"]:
        raise ValueError("NASA POWER returned an unexpected day convention.")

    dates = daily.index.strftime("%Y-%m-%d")
    values = daily.to_numpy(dtype=float).tolist()
    records = [
        {"date": day, **{columns[code][0]: value if math.isfinite(value) else None
                         for code, value in zip(columns, row)}}
        for day, row in zip(dates, values)
    ]
    counts = {columns[code][0]: int(daily[code].count()) for code in columns}
    n_days = len(records)
    required_counts = [counts[name] for code, (name, _) in columns.items() if code not in optional]
    status = "unavailable" if not any(required_counts) else (
        "available" if all(count == n_days for count in required_counts) else "partial"
    )
    return {
        "status": status,
        "source_id": source["source_id"],
        "documentation": source["documentation"],
        "source_kind": "gridded_historical_weather",
        "datasets": header.get("sources"),
        "version": header.get("api", {}).get("version"),
        "time_standard": header["time_standard"],
        "source_geometry": payload.get("geometry"),
        "request": request.provenance,
        "expected_days": n_days,
        "optional_fields": [columns[code][0] for code in columns if code in optional],
        "valid_days_by_field": counts,
        "units": {name: unit for name, unit in columns.values()},
        "records": records,
    }


def soil_layer(client, source, layer, depth, x, y):
    definition = source["properties"][layer]
    coverage = f"{layer}_{depth}_mean"
    params = [
        ("SERVICE", "WCS"), ("VERSION", "2.0.1"), ("REQUEST", "GetCoverage"),
        ("COVERAGEID", coverage), ("FORMAT", "image/tiff"),
        ("SUBSET", f"X({x - 500:.6f},{x + 500:.6f})"),
        ("SUBSET", f"Y({y - 500:.6f},{y + 500:.6f})"),
        ("SUBSETTINGCRS", SOIL_WCS_CRS), ("OUTPUTCRS", SOIL_WCS_CRS),
    ]
    result = {"field": definition["field"], "depth": depth, "coverage": coverage, "value": None}
    try:
        asset = client.get(
            f"{source['endpoint'].rstrip('/')}/{layer}", params=params,
            ttl_days=source["ttl_days"], decode=bytes_as_tiff,
        )
        result["request"] = asset.provenance
        raw = sample_soil_pixel(asset.value, layer, depth, x, y)
        scaled = raw / definition["divisor"]
        if not 0 <= scaled <= definition["max"]:
            raise ValueError("The scaled soil value is outside its physical range.")
        result["value"] = scaled
    except (RuntimeError, ValueError) as error:
        result["issue"] = str(error)
    return result


def fetch_soil(client, source, longitude, latitude):
    xs, ys = transform("EPSG:4326", SOIL_NATIVE_CRS, [longitude], [latitude])
    x, y = xs[0], ys[0]
    if not (math.isfinite(x) and math.isfinite(y)):
        raise ValueError("The sample point cannot be projected into the SoilGrids CRS.")
    tasks = [
        (layer, depth) for layer, definition in source["properties"].items()
        for depth in definition.get("depths", source["depths"])
    ]
    jobs = [(layer, depth, SOIL_WORKERS.submit(soil_layer, client, source, layer, depth, x, y,
                                            remaining=remaining_time(client))) for layer, depth in tasks]
    samples = []
    for layer, depth, job in jobs:
        try:
            samples.append(source_future_result(job, client))
        except (TimeoutError, SourceError, RuntimeError, OSError, ValueError, TypeError):
            job.cancel()
            samples.append({"field": source['properties'][layer]['field'], "depth": depth, "value": None,
                            "coverage": f"{layer}_{depth}_mean", "issue": "The source collection deadline was reached."})

    by_depth = {depth: {} for depth in source["depths"]}
    for result in samples:
        by_depth[result["depth"]][result["field"]] = result["value"]

    for layer in by_depth.values():
        retained = [layer.get(f"water_content_{pressure}kpa") for pressure in (10, 33, 1500)]
        layer["retention_order_consistent"] = (
            retained[0] >= retained[1] >= retained[2] if all(v is not None for v in retained) else None
        )

    topsoil = by_depth.get("0-5cm", {})
    fractions = [topsoil.get(f"{fraction}_pct") for fraction in ("sand", "silt", "clay")]
    try:
        texture = usda_texture(*fractions) if all(value is not None for value in fractions) else None
    except ValueError:
        texture = None
    count = sum(result["value"] is not None for result in samples)
    return {
        "status": "unavailable" if count == 0 else "available" if count == len(samples) else "partial",
        "source_id": source["source_id"],
        "documentation": source["documentation"],
        "version": source["version"],
        "source_kind": "gridded_soil_property_prediction",
        "resolution_m": source["resolution_m"],
        "topsoil_usda_texture": texture,
        "units": {item["field"]: item["unit"] for item in source["properties"].values()},
        "layers": by_depth,
        "requests": samples,
    }
