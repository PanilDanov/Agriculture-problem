import copy
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

from agronomy.province_weather import fetch_monthly_weather, parse_monthly

FIXTURE = Path(__file__).with_name("fixtures") / "nasa_monthly.json"


class ProvinceWeatherTests(unittest.TestCase):
    def setUp(self):
        self.raw = json.loads(FIXTURE.read_text())

    def test_actual_source_months_do_not_include_annual_or_fill_values(self):
        result = parse_monthly(self.raw, -4.5, 37.5, 1990, 2026)
        self.assertEqual([r["month"] for r in result["observations"]], ["2023-01", "2023-02", "2026-07"])
        self.assertEqual(result["observations"][-1]["temperatureMeanC"], 29.51)

    def test_source_units_and_point_cannot_be_relabelled(self):
        parse_monthly(self.raw, -4.500346, 37.500375, 1990, 2026)
        wrong_unit = copy.deepcopy(self.raw)
        wrong_unit["parameters"]["T2M"]["units"] = "K"
        with self.assertRaises(ValueError):
            parse_monthly(wrong_unit, -4.5, 37.5, 1990, 2026)
        with self.assertRaises(ValueError):
            parse_monthly(self.raw, 31.0, 31.0, 1990, 2026)
        invalid = copy.deepcopy(self.raw)
        invalid["properties"]["parameter"]["PRECTOTCORR"]["202301"] = float("nan")
        with self.assertRaises(ValueError):
            parse_monthly(invalid, -4.5, 37.5, 1990, 2026)

    def client(self, retrieved="2026-11-01T12:00:00+00:00"):
        def get(url, **kwargs):
            return SimpleNamespace(value=kwargs["decode"](json.dumps(self.raw).encode()), provenance={
                "url": url, "retrieved_at_utc": retrieved, "sha256": "a" * 64, "retrieval": "fresh_cache"})
        return SimpleNamespace(get=get)

    def test_incomplete_recent_month_is_excluded_and_retrieval_is_not_backdated(self):
        for name in ("T2M", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN"):
            self.raw["properties"]["parameter"][name]["202610"] = 10.0
        result = fetch_monthly_weather(self.client(), -4.5, 37.5, 1990, 2026, as_of="2026-11-01")
        self.assertEqual(result["observations"][-1]["month"], "2026-07")
        self.assertTrue(all(r["availableOn"] == "2026-11-01" for r in result["observations"]))
        self.assertEqual(result["support"], "representative_point")
        with self.assertRaises(ValueError):
            fetch_monthly_weather(self.client("2026-11-02T12:00:00+00:00"), -4.5, 37.5, 1990, 2026, as_of="2026-11-01")


if __name__ == "__main__":
    unittest.main()
