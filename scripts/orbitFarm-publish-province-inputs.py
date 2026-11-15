#!/usr/bin/env python3
"""Publish verified geometry and actual NASA covariates for province inference."""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from agronomy.field_providers import write_atomic


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provinces", type=Path, default=ROOT / "yield_prediction/artifacts/provincial/provinces.json")
    parser.add_argument("--weather-directory", type=Path, default=ROOT / ".data/province-nasa")
    parser.add_argument("--output", type=Path, default=ROOT / "agronomy/province_inputs")
    args = parser.parse_args()
    provinces = json.loads(args.provinces.read_text())
    manifest = json.loads((args.weather_directory / "manifest.json").read_text())
    if manifest["status"] != "complete":
        raise ValueError("Finish the source collection before publishing a release")
    metadata = {row["regionId"]: row for row in manifest["records"]}
    weather, regions = {}, []
    for province in provinces["records"]:
        identity = province["region_id"]
        if len(identity) != 2 or not identity.isdecimal():
            raise ValueError("Expected the verified two-digit INE province namespace")
        record = metadata[identity]
        source = args.weather_directory / (identity + ".json")
        body = source.read_bytes()
        if hashlib.sha256(body).hexdigest() != record["sha256"]:
            raise ValueError("NASA source file changed after collection: " + identity)
        value = json.loads(body)
        if value["regionId"] != identity or value["countryCode"] != "ES" or value["asOf"] != manifest["asOf"]:
            raise ValueError("NASA source snapshot identity mismatch")
        weather[identity] = value["weather"]
        regions.append({"regionId": identity, "countryCode": "ES", "name": province["province_name"],
                        "latitude": province["latitude"], "longitude": province["longitude"],
                        "geometry": province["geometry"], "nuts3Ids": province["nuts3_ids"],
                        "pointMethod": province["point_method"], "geometryVersion": province["geometry_version"],
                        "islandMembershipSource": province.get("island_membership_source")})
    packed = gzip.compress(encode({"schemaVersion": "1.0", "records": weather}), mtime=0)
    registry = {"schemaVersion": "1.0", "countryCode": "ES", "asOf": manifest["asOf"],
                "weatherSha256": hashlib.sha256(packed).hexdigest(),
                "spatialSupport": "Fixed representative point; not crop-mask aggregation or a field-yield estimate.",
                "geometrySource": {key: value for key, value in provinces.items() if key != "records"},
                "regions": regions}
    args.output.mkdir(parents=True, exist_ok=True)
    write_atomic(args.output / "weather.json.gz", packed)
    write_atomic(args.output / "registry.json", encode(registry))
    print(f"Published {len(regions)} verified province inputs ({len(packed)} compressed weather bytes).")


if __name__ == "__main__":
    main()
