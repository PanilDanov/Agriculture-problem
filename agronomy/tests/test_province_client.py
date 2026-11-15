import hashlib
import json
from json import dumps
from unittest.mock import Mock, patch
import unittest

from agronomy.ml_client import YieldClient
from agronomy.province_store import ProvinceInputStore


class ProvinceClientTests(unittest.TestCase):
    def setUp(self):
        store = ProvinceInputStore()
        registry = json.loads((store.directory / "registry.json").read_text())
        row = next(region for region in registry["regions"] if region["regionId"] == "02")
        lon, lat = row["longitude"], row["latitude"]
        self.boundary = {"type": "Polygon", "coordinates": [[[lon-.001,lat-.001],[lon+.001,lat-.001],
                         [lon+.001,lat+.001],[lon-.001,lat+.001],[lon-.001,lat-.001]]]}

    def response(self, *, wrong_year=False):
        def post(url, *, json, **kwargs):
            output = []
            for index, request in enumerate(json["requests"]):
                self.assertIn("provinceInput", request)
                payload = request["provinceInput"]
                fingerprint = hashlib.sha256(dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
                output.append({"crop": request["crop"], "status": "ready", "forecast": {
                    "crop": request["crop"], "mode": request["mode"], "country_code": "ES", "region_id": "02",
                    "harvest_year": 2025 if wrong_year and index == 0 else 2026,
                    "predicted_yield_t_ha": 1.0, "model_version": "unit-test-response",
                    "spatial_level": "administrative_region", "weather_support": "representative_point", "warnings": []},
                    "diagnostics": {"inputSha256": fingerprint, "source": {"region": {"adm_id": "02", "country_code": "ES"}}}})
            return Mock(json=lambda: {"results": output}, raise_for_status=lambda: None)
        return post

    def test_explicit_seasonal_route_uses_ten_province_inputs_and_reports_nasa_use(self):
        with patch("agronomy.ml_client.requests.post", side_effect=self.response()):
            results = YieldClient("http://unit.invalid").forecasts(self.boundary, "ES", "2026-11-15", harvest_year=2026, mode="mid_season")
        self.assertEqual(len(results), 10)
        self.assertTrue(all(row["status"] == "available" and row["usesNasaWeather"] for row in results))
        self.assertTrue(all(row["regionId"] == "02" for row in results))

    def test_wrong_province_forecast_year_does_not_discard_other_crop_results(self):
        with patch("agronomy.ml_client.requests.post", side_effect=self.response(wrong_year=True)):
            results = YieldClient("http://unit.invalid").forecasts(self.boundary, "ES", "2026-11-15", harvest_year=2026, mode="pre_season")
        self.assertEqual(results[0]["code"], "INVALID_MODEL_RESPONSE")
        self.assertNotIn("forecast", results[0])
        self.assertTrue(all(row["status"] == "available" for row in results[1:]))


if __name__ == "__main__":
    unittest.main()
