"""Select audited crop-mask regional inputs by geometry, crop and harvest year.

An empty store is a coverage gap. It must never cause NASA point observations or
an unrelated CY-Bench example to be passed off as regional AgERA5 observations.
"""

import hashlib
import json
from pathlib import Path

from shapely.geometry import shape


class RegionalInputStore:
    def __init__(self, directory=None):
        self.directory = Path(directory).resolve() if directory else None

    def select(self, boundary, crop, mode, harvest_year, as_of):
        missing = {"status": "unavailable", "code": "REGIONAL_INPUTS_UNAVAILABLE",
                   "reason": "No verified crop-mask regional dataset is installed for this field and season."}
        if self.directory is None or not (self.directory / "registry.json").is_file():
            return missing
        try:
            registry = json.loads((self.directory / "registry.json").read_text(encoding="utf-8"))
            if registry.get("schemaVersion") != "1.0":
                raise ValueError("Unsupported regional registry version")
            if not isinstance(boundary, dict) or boundary.get("type") not in ("Polygon", "MultiPolygon"):
                raise ValueError("A polygon field boundary is required for regional matching")
            field = shape(boundary)
            if field.is_empty or not field.is_valid:
                raise ValueError("A nonempty valid polygon field boundary is required for regional matching")
            matches = [region for region in registry["regions"] if shape(region["boundary"]).covers(field)]
            if len(matches) != 1:
                return {**missing, "code": "REGION_MATCH_UNVERIFIED",
                        "reason": "The complete field must fall inside exactly one verified model region."}
            region = matches[0]
            candidates = [row for row in region["datasets"] if row["cropId"] == crop
                          and row["harvestYear"] == harvest_year and row["mode"] == mode]
            if len(candidates) != 1:
                return missing
            record = candidates[0]
            path = (self.directory / record["path"]).resolve()
            if not path.is_relative_to(self.directory) or path.stat().st_size > 20_000_000:
                raise ValueError("Invalid regional input file")
            body = path.read_bytes()
            if hashlib.sha256(body).hexdigest() != record["sha256"]:
                raise ValueError("Regional input SHA-256 mismatch")
            raw = json.loads(body)
            actual_region = raw["region"]
            if (actual_region["match"] != "cybench_verified"
                    or actual_region["aggregation"] != "administrative_crop_mask"
                    or actual_region["adm_id"] != region["regionId"]
                    or actual_region["country_code"] != region["countryCode"]):
                raise ValueError("Regional geometry and input identifiers do not match")
            if raw["harvest_year"] != harvest_year or raw["as_of"] > as_of:
                raise ValueError("Regional dataset uses a different year or a future data cutoff")
            return {"status": "available", "environmentalInput": raw, "mode": mode,
                    "regionId": region["regionId"], "regionName": region.get("name"),
                    "inputSha256": record["sha256"], "inputAsOf": raw["as_of"]}
        except (OSError, ValueError, KeyError, TypeError) as error:
            return {**missing, "code": "REGIONAL_INPUTS_INVALID", "reason": str(error)}
