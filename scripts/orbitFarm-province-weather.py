#!/usr/bin/env python3
"""Collect auditable NASA monthly point covariates for verified MAPA provinces."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from agronomy.field_providers import SourceClient, write_atomic
from agronomy.province_weather import fetch_monthly_weather


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provinces", type=Path, default=ROOT / "yield_prediction/artifacts/provincial/provinces.json")
    parser.add_argument("--directory", type=Path, default=ROOT / ".data/province-nasa")
    parser.add_argument("--cache", type=Path, default=ROOT / ".cache/province-nasa")
    parser.add_argument("--start-year", type=int, default=1990)
    parser.add_argument("--as-of", default=date.today().isoformat())
    parser.add_argument("--only", nargs="+", help="Optional verified two-digit province identifiers")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    as_of = date.fromisoformat(args.as_of)
    if as_of > date.today():
        parser.error("The input snapshot cannot use a future date")
    provinces = json.loads(args.provinces.read_text())
    rows = provinces["records"]
    if args.only:
        selected = set(args.only)
        rows = [row for row in rows if row["region_id"] in selected]
        if {row["region_id"] for row in rows} != selected:
            parser.error("Every requested province must have a verified geometry and point")
    args.directory.mkdir(parents=True, exist_ok=True)

    def collect(region):
        identity = region["region_id"]
        if not isinstance(identity, str) or len(identity) != 2 or not identity.isdecimal() or region["country_code"] != "ES":
            raise ValueError("Expected a verified Spanish INE province identifier")
        client = SourceClient(args.cache, offline=args.offline)
        weather = fetch_monthly_weather(client, region["longitude"], region["latitude"],
                                        args.start_year, as_of.year, as_of=as_of)
        value = {"schemaVersion": "1.0", "regionId": identity, "countryCode": "ES",
                 "asOf": args.as_of, "weather": weather}
        body = encode(value)
        filename = identity + ".json"
        write_atomic(args.directory / filename, body)
        return {"regionId": identity, "path": filename, "sha256": hashlib.sha256(body).hexdigest(),
                "status": "available", "months": len(weather["observations"]),
                "dataThrough": weather["observations"][-1]["month"], "source": weather["provenance"]}

    results = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = {pool.submit(collect, row): row["region_id"] for row in rows}
        for future in as_completed(jobs):
            region = jobs[future]
            try:
                result = future.result()
                print(f"Province {region}: {result['months']} actual months through {result['dataThrough']}", flush=True)
            except Exception as error:
                result = {"regionId": region, "status": "unavailable", "reason": str(error)}
                print(f"Province {region}: unavailable ({type(error).__name__})", flush=True)
            results.append(result)
    available = sum(row["status"] == "available" for row in results)
    manifest = {"schemaVersion": "1.0", "asOf": args.as_of, "startYear": args.start_year,
                "status": "complete" if available == len(rows) else "partial",
                "availableRegions": available, "expectedRegions": len(rows),
                "spatialSupport": "Fixed representative point per verified province; not crop-mask aggregation.",
                "geometrySource": {key: provinces.get(key) for key in ("source_url", "source_sha256", "region_namespace")},
                "records": sorted(results, key=lambda row: row["regionId"])}
    write_atomic(args.directory / "manifest.json", encode(manifest))
    print(f"NASA province weather: {available}/{len(rows)} complete; {args.directory / 'manifest.json'}", flush=True)
    return 0 if manifest["status"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
