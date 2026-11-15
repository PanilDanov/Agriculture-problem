"""Collect daily weather, soil properties and planting windows for one WGS84 field."""

import argparse
import json
from concurrent.futures import TimeoutError
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from threading import Lock, BoundedSemaphore
import time

from .assessment import load_profiles, parse_date
from .field_calendars import fetch_calendars
from .field_geometry import CountryLookup, field_point
from .field_providers import (SourceClient, SourceError, fetch_soil, fetch_weather, write_atomic,
                              BoundedExecutor, remaining_time, source_future_result)

SOURCES_PATH = Path(__file__).with_name("field_sources.json")
DEFAULT_CACHE = Path(__file__).resolve().parents[1] / "yield_prediction/data/processed/field_context/cache"
_COUNTRY_LOOKUPS = {}
_COUNTRY_LOCK = Lock()
COLLECTION_WORKERS = BoundedExecutor(8, 12, "orbitfarm-source")
ACTIVE_COLLECTIONS = BoundedSemaphore(2)


def read_sources(path=SOURCES_PATH):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def locate_country(client, source, longitude, latitude):
    asset = client.get(source["url"], ttl_days=source["ttl_days"])
    fingerprint = asset.provenance.get("sha256")
    with _COUNTRY_LOCK:
        lookup = _COUNTRY_LOOKUPS.get(fingerprint) if fingerprint else None
        if lookup is None:
            lookup = CountryLookup(asset.value)
            if fingerprint:
                if len(_COUNTRY_LOOKUPS) >= 4:
                    _COUNTRY_LOOKUPS.pop(next(iter(_COUNTRY_LOOKUPS)))
                _COUNTRY_LOOKUPS[fingerprint] = lookup
    location = lookup.locate(longitude, latitude)
    return {
        **location,
        "source_id": source["source_id"],
        "documentation": source["documentation"],
        "version": source["version"],
        "request": asset.provenance,
    }


def source_result(operation, client, source, *args):
    try:
        return operation(client, source, *args)
    except (SourceError, ValueError, KeyError, TypeError, OSError, RuntimeError) as error:
        return {
            "status": "provider_error",
            "source_id": source["source_id"],
            "documentation": source["documentation"],
            "issue": str(error),
        }


def collect_field_context(boundary, start, end, *, sources=None, client=None, fao_zone=None, as_of=None, timeout_seconds=32):
    """Use one representative location for all lookups and retain source coverage."""
    if type(start) is not date or type(end) is not date or end < start:
        raise ValueError("Provide an ordered start and end date.")
    sources = read_sources() if sources is None else sources
    client = SourceClient(DEFAULT_CACHE) if client is None else client
    # Each collection gets its own client/deadline. Do not mutate a shared client
    # already in use by a preceding request's bounded background work.
    deadline = time.monotonic() + max(.01, min(35.0, float(timeout_seconds)))
    if isinstance(client, SourceClient):
        if client.deadline is not None:
            deadline = min(deadline, client.deadline)
        client = SourceClient(client.cache_dir, offline=client.offline, refresh=client.refresh,
                              deadline=deadline)
    else:
        delegate = client
        class DeadlineClient:
            def remaining(self):
                return max(0.0, deadline-time.monotonic())
            def __getattr__(self, name):
                return getattr(delegate, name)
        client = DeadlineClient()
    crop_ids = tuple(load_profiles()["crops"])
    longitude, latitude = field_point(boundary)
    longitude, latitude = round(longitude, 7), round(latitude, 7)
    longitude = -180.0 if longitude == 180 else longitude

    def unavailable(source, reason="The source collection deadline was reached."):
        return {"status": "provider_error", "source_id": source["source_id"],
                "documentation": source["documentation"], "issue": reason}

    def missing_calendars(reason):
        return {"sources": {}, "crops": {crop: {"status": "unavailable", "windows": [],
                "missing_reason": "lookup_incomplete", "issue": reason} for crop in crop_ids}}

    def remaining():
        return max(0.0, deadline-time.monotonic())

    def completed(future, fallback):
        try:
            return future.result(timeout=0 if future.done() else remaining())
        except (TimeoutError, SourceError, RuntimeError, OSError, ValueError, KeyError, TypeError):
            future.cancel()
            return fallback

    acquired = ACTIVE_COLLECTIONS.acquire(blocking=False)
    if not acquired:
        country = unavailable(sources['country'], "The collector is busy; retry after the active analyses complete.")
        weather_value, soil_value, recent_value = unavailable(sources['weather']), unavailable(sources['soil']), None
        calendars = missing_calendars("The collector worker budget is currently in use.")
    else:
        try:
            weather = COLLECTION_WORKERS.submit(source_result, fetch_weather, client, sources["weather"],
                       longitude, latitude, start, end, remaining=remaining())
            soil = COLLECTION_WORKERS.submit(source_result, fetch_soil, client, sources["soil"],
                    longitude, latitude, remaining=remaining())
            country_future = COLLECTION_WORKERS.submit(source_result, locate_country, client, sources['country'],
                              longitude, latitude, remaining=remaining())
            recent = None
            if as_of is not None:
                recent_end = as_of - timedelta(days=7)
                recent = COLLECTION_WORKERS.submit(source_result, fetch_weather, client, sources['weather'],
                          longitude, latitude, recent_end-timedelta(days=29), recent_end, remaining=remaining())
            country = completed(country_future, unavailable(sources['country']))
            calendar_future = COLLECTION_WORKERS.submit(fetch_calendars, client, sources, crop_ids, longitude,
                              latitude, country.get('country_code'), fao_zone,
                              country_status=country.get('status'), remaining=remaining())
            calendars = completed(calendar_future, missing_calendars("The calendar lookup exceeded the collection deadline."))
            weather_value = completed(weather, unavailable(sources['weather']))
            soil_value = completed(soil, unavailable(sources['soil']))
            recent_value = completed(recent, unavailable(sources['weather'])) if recent is not None else None
        finally:
            ACTIVE_COLLECTIONS.release()
    return {
        "schema_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "sample": {
            "longitude": longitude,
            "latitude": latitude,
            "method": "representative_point_of_largest_field_component",
            "crs": "EPSG:4326",
        },
        "requested_weather": {"start": start.isoformat(), "end": end.isoformat()},
        "country": country,
        "weather": weather_value,
        "recentWeather": recent_value,
        "soil": soil_value,
        "planting_calendars": calendars,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("boundary", type=Path, help="GeoJSON Polygon, MultiPolygon or Feature")
    parser.add_argument("--start", help="First day of the historical weather window (YYYY-MM-DD)")
    parser.add_argument("--end", help="Last day, inclusive. Defaults to seven days ago")
    parser.add_argument("--fao-zone", help="Optional known FAO agroecological zone ID in the resolved country")
    parser.add_argument("--sources", type=Path, default=SOURCES_PATH, help="Provider configuration JSON")
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE, help="Directory for raw provider responses")
    parser.add_argument("--output", type=Path, help="Write JSON to this path. Otherwise print it")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--offline", action="store_true", help="Read only cached provider responses")
    mode.add_argument("--refresh", action="store_true", help="Refresh matching cached responses")
    args = parser.parse_args()
    try:
        today = datetime.now(timezone.utc).date()
        historical_end = today - timedelta(days=7)
        end = parse_date(args.end, "--end") if args.end else historical_end
        start = parse_date(args.start, "--start") if args.start else end - timedelta(days=29)
        boundary = json.loads(args.boundary.read_text(encoding="utf-8-sig"))
        sources = read_sources(args.sources)
        if start.year < sources["weather"]["first_year"] or end >= today:
            raise ValueError(
                f"Use historical weather dates from {sources['weather']['first_year']} through yesterday."
            )
        client = SourceClient(args.cache_dir, offline=args.offline, refresh=args.refresh)
        result = collect_field_context(
            boundary, start, end, sources=sources, client=client, fao_zone=args.fao_zone,
        )
        output = json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
        if args.output:
            write_atomic(args.output, output.encode("utf-8"))
        else:
            print(output)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
