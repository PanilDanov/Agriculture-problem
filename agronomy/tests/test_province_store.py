import json
from pathlib import Path
import shutil
import tempfile
import unittest

from agronomy.province_store import ProvinceInputStore


class ProvinceStoreTests(unittest.TestCase):
    def setUp(self):
        self.store = ProvinceInputStore()
        registry = json.loads((self.store.directory / "registry.json").read_text())
        self.region = next(row for row in registry["regions"] if row["regionId"] == "02")
        lon, lat = self.region["longitude"], self.region["latitude"]
        self.boundary = {"type": "Polygon", "coordinates": [[[lon-.001, lat-.001], [lon+.001, lat-.001],
                         [lon+.001, lat+.001], [lon-.001, lat+.001], [lon-.001, lat-.001]]]}

    def test_actual_release_selects_complete_field_and_preserves_point_support(self):
        result = self.store.select(self.boundary, "chickpea", "mid_season", 2026, "2026-11-15")
        self.assertEqual(result["status"], "available", result)
        self.assertEqual(result["regionId"], "02")
        payload = result["provinceInput"]
        self.assertEqual(payload["weather"]["support"], "representative_point")
        self.assertEqual(payload["weather"]["observations"][0]["month"], "1990-01")
        self.assertEqual(payload["weather"]["latitude"], self.region["latitude"])

    def test_unverified_location_and_backdated_snapshot_have_no_numeric_substitute(self):
        egypt = {"type": "Polygon", "coordinates": [[[31,31],[31.01,31],[31.01,31.01],[31,31.01],[31,31]]]}
        self.assertEqual(self.store.select(egypt, "lentil", "pre_season", 2026, "2026-11-15")["status"], "unavailable")
        self.assertEqual(self.store.select(self.boundary, "lentil", "pre_season", 2026, "2025-11-15")["code"], "PROVINCE_INPUTS_INVALID")
        self.assertEqual(self.store.select({}, "lentil", "pre_season", 2026, "2026-11-15")["status"], "unavailable")

    def test_changed_weather_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            shutil.copy(self.store.directory / "registry.json", target)
            (target / "weather.json.gz").write_bytes(b"changed")
            result = ProvinceInputStore(target).select(self.boundary, "barley", "pre_season", 2026, "2026-11-15")
            self.assertEqual(result["code"], "PROVINCE_INPUTS_INVALID")
            self.assertIn("SHA-256", result["reason"])


if __name__ == "__main__":
    unittest.main()
