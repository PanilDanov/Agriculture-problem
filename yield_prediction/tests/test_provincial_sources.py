"""Regressions for actual MAPA formats and the portable provincial release."""

import copy
import gzip
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("mapa_prepare", ROOT / "prepare_provincial_data.py")
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


class ProvincialSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tables = json.loads((Path(__file__).with_name("fixtures") / "mapa_source_tables.json").read_text())["tables"]
        cls.aliases = PREPARE.province_aliases()

    def parsed(self, index):
        table = self.tables[index]
        rows = [{} for _ in range(max(map(int, table["rows"])))]
        for row, cells in table["rows"].items():
            rows[int(row) - 1] = {int(column): value for column, value in cells.items()}
        source = {"yearbook": table["yearbook"], "source_id": table["source_id"], "retrieved_on": "2026-11-15"}
        return source, table["source_sheet"], rows

    def test_old_reported_area_uses_tonnes_per_hectare_and_keeps_its_basis(self):
        source, name, rows = self.parsed(0)
        found, _ = PREPARE.extract_sheet(source, name, rows, self.aliases)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["region_id"], "01")
        self.assertEqual(found[0]["yield_t_ha"], 4.2)
        self.assertEqual(found[0]["area_basis"], "reported_total_area")
        self.assertEqual(found[0]["production_cell"], "G18")

    def test_modern_layout_uses_harvested_area_and_harvested_grain(self):
        source, name, rows = self.parsed(3)
        found, _ = PREPARE.extract_sheet(source, name, rows, self.aliases)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["area_ha"], 70857)
        self.assertEqual(found[0]["production_t"], 354501)
        self.assertAlmostEqual(found[0]["yield_t_ha"], 354501 / 70857)
        self.assertEqual(found[0]["area_basis"], "harvested")

    def test_open_tomato_excludes_protected_area_in_both_actual_formats(self):
        for index, expected_area, expected_yield in [(1, 57, 54.09), (2, 209, 65.5)]:
            with self.subTest(format=index):
                source, name, rows = self.parsed(index)
                found, _ = PREPARE.extract_sheet(source, name, rows, self.aliases)
                self.assertEqual(len(found), 1)
                self.assertEqual(found[0]["area_ha"], expected_area)
                self.assertAlmostEqual(found[0]["yield_t_ha"], expected_yield)
                self.assertGreater(found[0]["tomato_components"]["excluded_protected_area_ha"], 0)
                self.assertIsNone(found[0]["production_t"])
                self.assertEqual(found[0]["production_scope"], "open_field_rainfed_and_irrigated")

    def test_zero_production_is_retained_and_missing_production_is_audited(self):
        source, name, rows = self.parsed(0)
        for value in (0, "–", None):
            with self.subTest(source_value=value):
                changed = copy.deepcopy(rows)
                changed[17][7] = value
                found, audit = PREPARE.extract_sheet(source, name, changed, self.aliases)
                if value == 0:
                    self.assertEqual(found[0]["yield_t_ha"], 0)
                    self.assertEqual(found[0]["production_t"], 0)
                    self.assertIn("zero_yield_source_audit", found[0])
                else:
                    self.assertEqual(found, [])
                    self.assertEqual(audit["exclusion_counts"], {"missing_reported_production": 1})
                    self.assertEqual(audit["excluded_rows"][0]["production_cell"], "G18")

    def test_sweet_maize_and_buckwheat_are_not_grain_maize_or_wheat(self):
        source, name, rows = self.parsed(0)
        for title in ("7.7.29.1 Maíz dulce: Análisis provincial detallado, 2024",
                      "7.1.14.1 Alforfón o trigo sarraceno: Análisis provincial detallado, 2024"):
            changed = copy.deepcopy(rows)
            changed[2][1] = title
            self.assertEqual(PREPARE.extract_sheet(source, name, changed, self.aliases), ([], None))

    def test_frozen_real_corpus_is_complete_finite_and_source_bound(self):
        folder = ROOT / "artifacts/provincial"
        blob = (folder / "mapa_yields.json.gz").read_bytes()
        data = json.loads(gzip.decompress(blob))
        self.assertEqual(len(data["rows"]), 8885)
        self.assertEqual(set(row["crop"] for row in data["rows"]), set(PREPARE.CROP_PATTERNS))
        keys = [(row["crop"], row["region_id"], row["harvest_year"]) for row in data["rows"]]
        self.assertEqual(len(keys), len(set(keys)))
        for crop in PREPARE.CROP_PATTERNS:
            self.assertEqual({row["harvest_year"] for row in data["rows"] if row["crop"] == crop}, set(range(2004, 2025)))
        sources = {row["source_id"]: row for row in data["sources"]}
        for row in data["rows"]:
            self.assertTrue(math.isfinite(row["yield_t_ha"]))
            self.assertGreaterEqual(row["yield_t_ha"], 0)
            self.assertTrue(sources[row["source_id"]]["url"].startswith("https://www.mapa.gob.es/"))
            if row["crop"] != "tomato":
                self.assertAlmostEqual(row["yield_t_ha"], row["production_t"] / row["area_ha"])
        audit = json.loads((folder / "mapa_source_audit.json").read_text())
        self.assertEqual(audit["label_snapshot_sha256"], hashlib.sha256(blob).hexdigest())
        self.assertEqual(audit["numeric_zero_yield_rows"], [])
        self.assertEqual(audit["excluded_positive_area_numeric_zero_production_rows"], [])
        exclusions = json.loads(gzip.decompress((folder / "mapa_excluded_rows.json.gz").read_bytes()))
        self.assertEqual(len(exclusions["rows"]), sum(audit["excluded_row_counts"].values()))
