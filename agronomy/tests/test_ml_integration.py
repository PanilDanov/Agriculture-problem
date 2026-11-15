import json
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from agronomy.api import create_app
from agronomy.ml_client import CROPS, YieldClient
from agronomy.regional_store import RegionalInputStore
from agronomy.assessment import load_profiles
from test_api import CLOCK, field_fixture


class YieldIntegrationTests(unittest.TestCase):
    @patch("agronomy.ml_client.requests.post")
    def test_explicit_regional_request_does_not_become_a_national_prediction(self, post):
        client = YieldClient("http://127.0.0.1:8001", regional_store=RegionalInputStore())
        results = client.forecasts({}, "EG", "2026-11-15", mode="mid_season")
        self.assertEqual(len(results), 10)
        self.assertTrue(all(row["status"] == "unavailable" for row in results))
        post.assert_not_called()

    @patch("agronomy.ml_client.requests.post")
    def test_auto_routes_all_ten_to_actual_country_batch_with_provenance(self, post):
        post.return_value.json.return_value = {"results": [{"crop": crop, "status": "ready", "forecast": {
            "crop": crop, "mode": "annual_history", "predicted_yield_t_ha": 2.0,
            "spatial_level": "country", "country_code": "EG", "harvest_year": 2027,
            "model_version": "fixture", "warnings": []}, "diagnostics": {
                "inputSha256": hashlib.sha256(json.dumps({"countryCode": "EG", "harvestYear": 2027, "asOf": "2026-11-15"}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}}
            for crop in CROPS]}
        results = YieldClient("http://127.0.0.1:8001").forecasts({}, "EG", "2026-11-15")
        self.assertEqual([row["cropId"] for row in results], list(CROPS))
        self.assertTrue(all(row["status"] == "available" and not row["usesNasaWeather"] for row in results))
        batch = post.call_args.kwargs["json"]["requests"]
        self.assertTrue(all(row["nationalInput"] == {"countryCode": "EG", "harvestYear": 2027, "asOf": "2026-11-15"} for row in batch))

    @patch("agronomy.ml_client.requests.post")
    def test_invalid_or_cross_crop_responses_do_not_escape_into_the_field_result(self, post):
        for invalid in (None, {"crop": "tomato", "status": "ready", "forecast": {}},
                        {"crop": "wheat", "status": "ready", "forecast": {"crop": "wheat", "predicted_yield_t_ha": float("nan")}}):
            with self.subTest(invalid=invalid):
                post.return_value.json.return_value = {"results": [invalid]}
                output = YieldClient("http://127.0.0.1:8001").forecasts({}, "EG", "2026-11-15", crops=("wheat",))
                self.assertEqual(output[0]["status"], "unavailable")
                self.assertEqual(output[0]["code"], "INVALID_MODEL_RESPONSE")

    def test_field_api_forwards_forecast_settings_and_preserves_nasa_analysis(self):
        payload = json.loads((Path(__file__).parents[1] / "example_analysis_request.json").read_text())
        payload["yieldForecast"] = {"mode": "annual_history", "harvestYear": 2027}
        ml = Mock()
        ml.forecasts.return_value = [{"cropId": crop, "status": "unavailable", "reason": "test"} for crop in CROPS]
        response = TestClient(create_app(collector=Mock(return_value=field_fixture()), now=lambda: CLOCK,
                                         yield_client=ml)).post("/v1/analysis", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(len(result["yieldForecasts"]), 10)
        self.assertEqual(len(result["cropOptions"]), 10)
        self.assertTrue(all(signal["origin"] == "nasa" for signal in result["signals"]))
        self.assertEqual(ml.forecasts.call_args.kwargs, {"harvest_year": 2027, "mode": "annual_history"})

    def test_allocation_period_is_validated_before_source_collection(self):
        payload = json.loads((Path(__file__).parents[1] / "example_analysis_request.json").read_text())
        payload["localInputs"]["irrigation"] = {"availability": "available", "method": "drip",
            "waterBudget": {"volumeM3": 100, "basis": "field_inlet", "periodStart": "2026-11-01"},
            "applicationEfficiency": .8}
        collector = Mock()
        response = TestClient(create_app(collector=collector)).post("/v1/analysis", json=payload)
        self.assertEqual(response.status_code, 422)
        collector.assert_not_called()

    def test_seasonal_planning_does_not_require_invented_current_measurements(self):
        payload = json.loads((Path(__file__).parents[1] / "example_analysis_request.json").read_text())
        period = {"periodStart": "2026-02-20", "periodEnd": "2026-05-15"}
        payload["localInputs"]["soil"].update(ph=6.5, texture="loam", source="soil_test")
        payload["localInputs"]["irrigation"] = {"availability": "available", "method": "drip",
            "waterBudget": {"volumeM3": 10000, "basis": "field_inlet", **period}, "applicationEfficiency": .8}
        payload["localInputs"]["seasonalWaterBalance"] = [{"cropId": "barley", **period,
            "netIrrigationRequirementMm": 100, "source": "Local measured seasonal assessment", "method": "Documented field water balance"}]
        response = TestClient(create_app(collector=Mock(return_value=field_fixture()), now=lambda: CLOCK)).post("/v1/analysis", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        barley = next(row for row in response.json()["cropOptions"] if row["cropId"] == "barley")
        self.assertEqual(barley["scoreStatus"], "complete", barley)
        self.assertEqual(response.json()["irrigationAssessment"]["status"], "needs_observations")

    def test_an_unrepresentable_efficiency_does_not_leak_infinity_into_json(self):
        payload = json.loads((Path(__file__).parents[1] / "example_analysis_request.json").read_text())
        variant = next(iter(load_profiles()["crops"]["barley"]["irrigation"]["variants"]))
        payload["localInputs"]["irrigation"] = {"availability": "available", "method": "drip", "waterBudget": None, "applicationEfficiency": 1e-323}
        payload["localInputs"]["fieldObservations"] = {"observedOn": "2026-01-01", "cropId": "barley", "stage": "mid_season",
            "variant": variant, "et0MmDay": 5, "source": "Test measurement", "rootZoneLayers": [
                {"thicknessM": .5, "thetaFc": .3, "thetaWp": .1, "thetaNow": .1}]}
        response = TestClient(create_app(collector=Mock(return_value=field_fixture()), now=lambda: CLOCK)).post("/v1/analysis", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["irrigationAssessment"]["status"], "invalid_observations")

    @unittest.skipUnless(os.environ.get("ORBITFARM_TEST_LIVE_ML") == "1", "Run with the actual local ML service")
    def test_real_http_service_returns_all_ten_trained_forecasts(self):
        payload = json.loads((Path(__file__).parents[1] / "example_analysis_request.json").read_text())
        field = field_fixture()
        field["country"]["country_code"] = "EG"
        response = TestClient(create_app(collector=Mock(return_value=field),
            yield_client=YieldClient("http://127.0.0.1:8001"))).post("/v1/analysis", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        forecasts = response.json()["yieldForecasts"]
        self.assertEqual(len(forecasts), 10)
        self.assertTrue(all(row["status"] == "available" for row in forecasts), forecasts)
        model_dir = Path(__file__).parents[2] / "yield_prediction/src/yield_prediction/national_models"
        for row in forecasts:
            metadata = json.loads((model_dir / f"{row['cropId']}.json").read_text())
            self.assertEqual(row["forecast"]["model_version"], metadata["model_version"])
        self.assertTrue(all(row["forecast"]["spatial_level"] == "country" for row in forecasts))
