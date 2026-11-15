import copy
import json
import math
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock
from uuid import UUID

from fastapi.testclient import TestClient

from agronomy.api import create_app
from agronomy.assessment import load_profiles
from agronomy.rotation_planner import place_rotation, published_seasons
from agronomy.water_screen import reference_eto, season_water_screen

CLOCK = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)


def day(month, number):
    return {"month": month, "day": number}


def window(first, last, *, scope="sampled_grid_cell"):
    return {
        "source_id": "test-calendar",
        "scope": scope,
        "source_region_level": 2,
        "planting": {"typical": first},
        "harvest": {"typical": last},
    }


def calendar_entry(first, last):
    return {"status": "available", "windows": [window(first, last)]}


def field_fixture():
    start, end = date(2022, 1, 1), date(2025, 12, 31)
    records = []
    for offset in range((end - start).days + 1):
        current = start + timedelta(days=offset)
        records.append({
            "date": current.isoformat(),
            "temperature_mean_c": 21.5,
            "temperature_min_c": 13.0,
            "temperature_max_c": 30.0,
            "dew_point_c": 10.0,
            "precipitation_mm": 0.5,
            "solar_radiation_mj_m2_day": 15.0,
            "wind_speed_2m_m_s": 2.0,
            "surface_pressure_kpa": 100.0,
            "modeled_root_zone_moisture": None,
        })
    calendars = {
        crop: {"status": "unavailable", "windows": [], "missing_reason": "no_source_coverage"}
        for crop in load_profiles()["crops"]
    }
    calendars.update(
        barley=calendar_entry(day(2, 20), day(5, 15)),
        maize=calendar_entry(day(4, 20), day(8, 25)),
        sunflower=calendar_entry(day(5, 20), day(8, 25)),
        chickpea=calendar_entry(day(3, 10), day(9, 5)),
        lentil={"status": "regional_candidates", "windows": [window(day(4, 1), day(7, 8), scope="regional_candidate")]},
        tomato={"status": "modeled_candidates", "windows": [window(day(5, 2), day(9, 2), scope="modeled_grid_candidate")]},
    )
    return {
        "weather": {
            "status": "available",
            "records": records,
            "source_geometry": {"coordinates": [3, 41, 100]},
            "documentation": "https://power.larc.nasa.gov/docs/services/api/temporal/daily/",
            "version": "test",
            "request": {"retrieval": "fresh_cache", "retrieved_at_utc": "2026-01-01T12:00:00Z"},
        },
        "soil": {"source_id": "isric-soilgrids", "layers": {"0-5cm": {"ph_water": 6.8}}, "topsoil_usda_texture": "loam"},
        "sample": {"longitude": 3.0, "latitude": 41.0},
        "country": {"country_code": "ES"},
        "planting_calendars": {"crops": calendars},
    }


class WaterAndCalendarTests(unittest.TestCase):
    def test_reference_et_matches_the_fao_daily_example(self):
        # FAO-56 example 18 gives actual vapor pressure 1.410 kPa.
        log_pressure = math.log(1.410 / 0.6108)
        dew_point = 237.3 * log_pressure / (17.27 - log_pressure)
        daily = {
            "temperature_min_c": 12.3,
            "temperature_max_c": 21.5,
            "dew_point_c": dew_point,
            "solar_radiation_mj_m2_day": 22.07,
            "wind_speed_2m_m_s": 2.078,
            "surface_pressure_kpa": 100.1,
        }
        eto = reference_eto(daily, date(2025, 7, 6), 50.8, 100)
        self.assertAlmostEqual(eto, 3.9, delta=0.15)

    def test_water_screen_needs_complete_historical_seasons(self):
        daily = {
            date(year, 3, day): (4.0, rain)
            for year in (2022, 2023, 2024)
            for day, rain in ((1, 2.0), (2, 10.0))
        }
        start, end = date(2026, 3, 1), date(2026, 3, 2)
        self.assertEqual(season_water_screen(daily, start, end, 1.25), {"depth_mm": 3.0, "complete_seasons": 3})
        del daily[date(2023, 3, 1)]
        self.assertIsNone(season_water_screen(daily, start, end, 1.25))

    def test_rotation_uses_the_next_non_overlapping_season_across_years(self):
        start, end = date(2026, 10, 1), date(2028, 9, 30)
        first = published_seasons(calendar_entry(day(10, 1), day(5, 15)), start, end)
        second = published_seasons(calendar_entry(day(4, 10), day(9, 1)), start, end)
        (winter, follow_up), complete = place_rotation(first, second, end)
        self.assertTrue(complete)
        self.assertEqual(winter.harvest, date(2027, 5, 15))
        self.assertEqual(follow_up.planting, date(2028, 4, 10))

    def test_partial_month_and_unmatched_region_do_not_generate_dates(self):
        entry = {
            "status": "available",
            "windows": [
                window({"month": 3, "day": None}, day(7, 1)),
                window(day(4, 1), day(7, 1), scope="regional_candidate"),
            ],
        }
        self.assertEqual(published_seasons(entry, date(2026, 1, 1), date(2027, 12, 1)), [])

    def test_follow_up_can_use_the_rest_of_a_published_planting_window(self):
        maize = calendar_entry(day(5, 13), day(10, 17))
        wheat = calendar_entry(day(10, 3), day(7, 16))
        wheat["windows"][0]["planting"]["latest"] = day(10, 30)
        wheat["windows"][0]["harvest"]["latest"] = day(8, 7)
        start, end = date(2027, 1, 1), date(2028, 12, 31)
        (_, second), complete = place_rotation(
            published_seasons(maize, start, end), published_seasons(wheat, start, end), end,
        )
        self.assertTrue(complete)
        self.assertEqual(second.planting, date(2027, 10, 18))
        self.assertEqual(second.harvest, date(2028, 7, 31))


class AnalysisApiTests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads((Path(__file__).parents[1] / "example_analysis_request.json").read_text())
        self.field = field_fixture()
        self.collector = Mock(return_value=self.field)
        self.client = TestClient(create_app(collector=self.collector, now=lambda: CLOCK))

    def test_api_returns_field_based_rotation_alternatives_and_calendar_gaps(self):
        self.payload["localInputs"]["previousCropId"] = "sorghum"
        response = self.client.post("/v1/analysis", json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["requestId"], self.payload["requestId"])
        self.assertEqual(result["farmId"], self.payload["farmId"])
        self.assertEqual(result["boundaryVersion"], self.payload["boundaryVersion"])
        UUID(result["analysisId"])
        self.assertGreater(result["areaHa"], 1)
        self.assertEqual(result["dataMode"], "nasa-cache")
        self.assertTrue(all(signal["origin"] == "nasa" for signal in result["signals"]))
        soil_signal = next(signal for signal in result["signals"] if signal["signalId"] == "soil-moisture")
        self.assertEqual(soil_signal["quality"], "missing")
        self.assertIsNone(soil_signal["value"])
        plans = result["rotationPlans"]
        self.assertEqual([plan["planId"] for plan in plans], ["current", "save-water", "improve-soil"])
        self.assertEqual(plans[0]["baselineOrigin"], "example")
        save, improve = plans[1:]
        self.assertNotEqual(save["sequence"], improve["sequence"])
        self.assertIn("chickpea", improve["sequence"])
        self.assertLessEqual(save["waterScreenMm"], improve["waterScreenMm"])
        for plan in plans:
            self.assertEqual(len(plan["sequence"]), 2)
            self.assertEqual([season["cropId"] for season in plan["seasons"]], plan["sequence"])
        for plan in (save, improve):
            a, b = plan["seasons"]
            self.assertLess(a["calendarHarvestDate"], b["recommendedPlantingDate"])
        options = {crop["cropId"]: crop for crop in result["cropOptions"]}
        self.assertEqual(len(options), 10)
        self.assertIsNotNone(options["barley"]["recommendedPlantingDate"])
        for crop in ("lentil", "tomato", "sorghum"):
            self.assertIsNone(options[crop]["recommendedPlantingDate"])
        self.assertTrue(all(crop["score"] is None for crop in options.values()))
        self.collector.assert_called_once_with(self.payload["boundary"], date(2022, 1, 1), date(2025, 12, 31))

    def test_known_previous_crop_changes_a_tied_rotation_choice(self):
        response = self.client.post("/v1/analysis", json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        plans = {plan["planId"]: plan for plan in response.json()["rotationPlans"]}
        self.assertEqual(plans["current"]["sequence"], ["wheat", "wheat"])
        self.assertNotEqual(plans["improve-soil"]["sequence"][0], "chickpea")

    def test_dates_remain_optional_when_all_local_calendars_are_missing(self):
        self.field["planting_calendars"]["crops"] = {
            crop: {"status": "unavailable", "windows": []} for crop in load_profiles()["crops"]
        }
        response = self.client.post("/v1/analysis", json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        for plan in result["rotationPlans"]:
            self.assertEqual(plan["planStatus"], "provisional")
            self.assertEqual(len(plan["sequence"]), 2)
            self.assertIsNone(plan["waterScreenMm"])
            self.assertTrue(all(season["recommendedPlantingDate"] is None for season in plan["seasons"]))
        self.assertTrue(all(crop["recommendedPlantingDate"] is None for crop in result["cropOptions"]))

    def test_national_grids_are_comparison_scenarios_without_field_dates(self):
        for crop in self.field["planting_calendars"]["crops"].values():
            for scenario in crop["windows"]:
                scenario["source_region_level"] = 1
        response = self.client.post("/v1/analysis", json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertTrue(all(crop["recommendedPlantingDate"] is None for crop in result["cropOptions"]))
        save = next(plan for plan in result["rotationPlans"] if plan["planId"] == "save-water")
        self.assertEqual(save["planStatus"], "provisional")
        self.assertIsNotNone(save["waterScreenMm"])
        self.assertTrue(all(season["recommendedPlantingDate"] is None for season in save["seasons"]))

    def test_rejects_client_dates_and_invalid_polygons_before_collection(self):
        bad_date = copy.deepcopy(self.payload)
        bad_date["plantingDate"] = "2026-05-15"
        invalid_boundary = copy.deepcopy(self.payload)
        invalid_boundary["boundary"]["coordinates"] = [[[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]]
        for request in (bad_date, invalid_boundary):
            with self.subTest(request=request):
                self.assertEqual(self.client.post("/v1/analysis", json=request).status_code, 422)
        self.collector.assert_not_called()

    def test_cors_and_weather_coverage_statuses_follow_the_frontend_contract(self):
        path = "/v1/analysis"
        preflight = self.client.options(path, headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        })
        self.assertEqual(preflight.status_code, 200)
        self.assertEqual(preflight.headers["access-control-allow-origin"], "http://127.0.0.1:5173")
        self.field["weather"] = {"status": "unavailable"}
        missing = self.client.post(path, json=self.payload)
        self.assertEqual((missing.status_code, missing.json()["code"]), (422, "NO_COVERAGE"))
        self.field["weather"] = {"status": "provider_error"}
        outage = self.client.post(path, json=self.payload)
        self.assertEqual((outage.status_code, outage.json()["code"]), (503, "WEATHER_UNAVAILABLE"))
