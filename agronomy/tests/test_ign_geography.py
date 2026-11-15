"""Validate the actual IGN selection release and its unchanged NASA inputs."""

import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

from shapely.geometry import Point, shape

from agronomy.province_store import ProvinceInputStore
from agronomy.regional_store import RegionalInputStore


ROOT = Path(__file__).resolve().parents[2]


class OfficialIGNReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "yield_prediction/artifacts/provincial/provinces.json"
        cls.release = json.loads(cls.path.read_text())
        cls.audit = json.loads((ROOT / "yield_prediction/artifacts/reference/ign_geometry_audit.json").read_text())
        cls.registry = json.loads((ROOT / "agronomy/province_inputs/registry.json").read_text())

    def test_complete_official_code_crosswalk_and_source_identity(self):
        self.assertEqual(self.release["license"], "CC-BY-4.0")
        self.assertTrue(self.release["source_url"].startswith("https://www.ign.es/wfs-inspire/unidades-administrativas?"))
        self.assertEqual(self.release["source_semantic_sha256"],
                         "0eb56bdbb9b1bd1b5123f3be660d1b9713a7c7dc028f4c74453b5c8ab666185c")
        self.assertEqual(self.audit["province_snapshot_sha256"], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual({row["region_id"] for row in self.release["records"]},
                         {f"{value:02d}" for value in range(1, 51)})
        self.assertEqual({row["province_code"] for row in self.audit["excluded_units"]}, {"51", "52", "54"})
        for row in self.release["records"]:
            self.assertEqual(row["official_national_code"][4:6], row["region_id"])
            self.assertEqual(row["country_code"], "ES")

    def test_real_geometries_keep_all_fixed_points_and_audited_area(self):
        audits = {row["province_code"]: row for row in self.audit["records"]}
        registry = {row["regionId"]: row for row in self.registry["regions"]}
        for row in self.release["records"]:
            with self.subTest(province=row["region_id"]):
                polygon = shape(row["geometry"])
                self.assertTrue(polygon.is_valid and not polygon.is_empty)
                self.assertIn(polygon.geom_type, ("Polygon", "MultiPolygon"))
                self.assertTrue(polygon.covers(Point(row["longitude"], row["latitude"])))
                self.assertEqual(registry[row["region_id"]]["geometry"], row["geometry"])
                self.assertEqual(registry[row["region_id"]]["longitude"], row["longitude"])
                self.assertEqual(registry[row["region_id"]]["latitude"], row["latitude"])
                audit = audits[row["region_id"]]
                self.assertTrue(audit["point_unchanged"] and audit["point_inside_original"])
                self.assertLessEqual(audit["absolute_area_change_fraction"], 0.001)
                self.assertEqual(audit["repairs"], [])

    def test_original_nasa_archive_remains_bound_to_released_registry(self):
        weather = (ROOT / "agronomy/province_inputs/weather.json.gz").read_bytes()
        self.assertEqual(hashlib.sha256(weather).hexdigest(), self.registry["weatherSha256"])
        self.assertEqual(self.registry["geometrySource"]["license"], "CC-BY-4.0")

    def test_a_later_download_cannot_be_labelled_with_the_frozen_access_date(self):
        spec = importlib.util.spec_from_file_location("orbitfarm_ign_release", ROOT / "yield_prediction/prepare_ign_geography.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with patch.object(module, "datetime") as clock, patch.object(module.subprocess, "run") as download:
            clock.now.return_value = datetime(2027, 1, 1, tzinfo=timezone.utc)
            with patch("sys.argv", ["prepare_ign_geography.py", "--download"]):
                with self.assertRaisesRegex(ValueError, "later retrieval requires a newly reviewed release"):
                    module.main()
            download.assert_not_called()

    def test_real_zaragoza_and_lugo_smoke_fields_match_their_actual_units(self):
        province_field = json.loads((ROOT / "deployment/smoke-province-field.json").read_text())["boundary"]
        province = ProvinceInputStore().select(province_field, "wheat", "pre_season", 2026, "2026-11-15")
        self.assertEqual(province["status"], "available")
        self.assertEqual(province["regionId"], "50")
        regional_field = json.loads((ROOT / "deployment/smoke-regional-field.json").read_text())["boundary"]
        regional = RegionalInputStore(ROOT / "agronomy/regional_inputs").select(
            regional_field, "wheat", "pre_season", 2026, "2026-11-15")
        self.assertEqual(regional["status"], "available")
        self.assertEqual(regional["regionId"], "ES112")
        selection = json.loads((ROOT / "agronomy/regional_inputs/registry.json").read_text())["regions"][0]
        self.assertEqual(selection["boundarySource"]["license"], "CC-BY-4.0")
        provenance = json.loads((ROOT / "agronomy/regional_inputs/source_provenance.json").read_text())
        self.assertEqual(provenance["selectionBoundary"]["province_code"], "27")
        self.assertIn("Historical source verification only", provenance["historicalCybenchBoundary"]["role"])


if __name__ == "__main__":
    unittest.main()
