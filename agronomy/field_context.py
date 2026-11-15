"""Collect daily weather, soil properties and planting windows for one WGS84 field."""

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .assessment import load_profiles, parse_date
from .field_calendars import fetch_calendars
from .field_geometry import CountryLookup, field_point
from .field_providers import SourceClient, SourceError, fetch_soil, fetch_weather, write_atomic

SOURCES_PATH = Path(__file__).with_name("field_sources.json")
DEFAULT_CACHE = Path(__file__).resolve().parents[1] / "yield_prediction/data/processed/field_context/cache"


def read_sources(path=SOURCES_PATH):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def locate_country(client, source, longitude, latitude):
    asset = client.get(source["url"], ttl_days=source["ttl_days"])
    location = CountryLookup(asset.value).locate(longitude, latitude)
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
    except (SourceError, ValueError, KeyError, TypeError) as error:
        return {
            "status": "provider_error",
            "source_id": source["source_id"],
            "documentation": source["documentation"],
            "issue": str(error),
        }


def collect_field_context(boundary, start, end, *, sources=None, client=None, fao_zone=None):
    """Use one representative location for all lookups and retain source coverage."""
    if type(start) is not date or type(end) is not date or end < start:
        raise ValueError("Provide an ordered start and end date.")
    sources = read_sources() if sources is None else sources
    client = SourceClient(DEFAULT_CACHE) if client is None else client
    crop_ids = tuple(load_profiles()["crops"])
    longitude, latitude = field_point(boundary)
    longitude, latitude = round(longitude, 7), round(latitude, 7)
    longitude = -180.0 if longitude == 180 else longitude

    with ThreadPoolExecutor(max_workers=3) as pool:
        weather = pool.submit(
            source_result, fetch_weather, client, sources["weather"], longitude, latitude, start, end,
        )
        soil = pool.submit(source_result, fetch_soil, client, sources["soil"], longitude, latitude)
        country = source_result(locate_country, client, sources["country"], longitude, latitude)
        calendars = fetch_calendars(
            client, sources, crop_ids, longitude, latitude, country.get("country_code"), fao_zone,
            country_status=country["status"],
        )
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
        "weather": weather.result(),
        "soil": soil.result(),
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
