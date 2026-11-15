import json
import tempfile
import unittest
from pathlib import Path

from agronomy.regional_store import RegionalInputStore


class RegionalStoreBoundaryTests(unittest.TestCase):
    def test_installed_registry_rejects_malformed_empty_and_nonpolygon_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "registry.json").write_text(json.dumps({"schemaVersion": "1.0", "regions": []}))
            store = RegionalInputStore(directory)
            for boundary in ({}, None, {"type": "Point", "coordinates": [0, 0]},
                             {"type": "Polygon", "coordinates": []},
                             {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]}):
                with self.subTest(boundary=boundary):
                    result = store.select(boundary, "wheat", "pre_season", 2027, "2026-11-15")
                    self.assertEqual(result["status"], "unavailable")
                    self.assertEqual(result["code"], "REGIONAL_INPUTS_INVALID")
