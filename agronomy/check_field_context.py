"""Replay a stratified random validation on public CropHarvest field polygons."""

import argparse
import hashlib
import json
import random
from collections import defaultdict
from datetime import date
from pathlib import Path

from .field_context import DEFAULT_CACHE, collect_field_context, read_sources
from .field_geometry import CountryLookup, field_point
from .field_providers import SourceClient, write_atomic

LABELS_SHA256 = "8a8a0e32953dd519ae44779a893b600a07a82bc2ff1f10ddb7b75e699ca34cbf"
DEFAULT_COUNTRIES = ("FR", "BR", "KE", "ET", "UZ", "TG")


def select_fields(labels, lookup, countries, seed):
    candidates = defaultdict(list)
    for row in labels["features"]:
        properties = row["properties"]
        geometry = row.get("geometry") or {}
        if properties.get("is_crop") != 1 or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        location = lookup.locate(properties["lon"], properties["lat"])
        country = location.get("country_code")
        if country in countries:
            candidates[country].append(row)

    rng = random.Random(seed)
    fields = []
    for country in countries:
        pool = candidates[country]
        for row in rng.sample(pool, len(pool)):
            try:
                sample = field_point(row["geometry"])
            except ValueError:
                continue
            if lookup.locate(*sample).get("country_code") == country:
                fields.append((country, row))
                break
        else:
            raise ValueError(f"No valid crop polygon in {country}.")
    return fields


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("labels", type=Path, help="CropHarvest v8 labels.geojson")
    parser.add_argument("--countries", nargs="+", default=DEFAULT_COUNTRIES)
    parser.add_argument("--seed", type=int, default=20261115)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()

    body = args.labels.read_bytes()
    fingerprint = hashlib.sha256(body).hexdigest()
    if fingerprint != LABELS_SHA256:
        parser.error(f"The file is not the pinned CropHarvest v8 release: {fingerprint}")

    client = SourceClient(args.cache_dir, offline=args.offline)
    config = read_sources()
    country_map = config["country"]
    lookup = CountryLookup(client.get(country_map["url"], ttl_days=country_map["ttl_days"]).value)
    labels = json.loads(body)
    countries = tuple(dict.fromkeys(country.upper() for country in args.countries))
    fields = select_fields(labels, lookup, countries, args.seed)
    start, end = date(2024, 9, 1), date(2024, 9, 7)
    summaries = []
    for country, field in fields:
        output = collect_field_context(field["geometry"], start, end, sources=config, client=client)
        crop_windows = output["planting_calendars"]["crops"]
        row = {
            "country": country,
            "label_dataset": field["properties"]["dataset"],
            "label_index": field["properties"]["index"],
            "sample": output["sample"],
            "weather": output["weather"]["status"],
            "weather_days": output["weather"].get("valid_days_by_field", {}),
            "soil": output["soil"]["status"],
            "soil_samples": sum(sample["value"] is not None for sample in output["soil"].get("requests", [])),
            "crop_status": {crop: record["status"] for crop, record in crop_windows.items()},
            "fao_calendar": output["planting_calendars"]["sources"]["fao-crop-calendar"]["status"],
        }
        summaries.append(row)
        print(json.dumps(row), flush=True)
        write_atomic(
            args.output_dir / f"{country}.json",
            (json.dumps(output, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8"),
        )
    write_atomic(
        args.output_dir / "summary.json",
        (json.dumps({"seed": args.seed, "labels_sha256": fingerprint, "fields": summaries}, indent=2) + "\n").encode("utf-8"),
    )


if __name__ == "__main__":
    main()
