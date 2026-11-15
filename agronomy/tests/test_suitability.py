"""Evidence boundaries for the ten-crop reference screen and measured irrigation."""

import unittest
from datetime import date, timedelta

from agronomy.assessment import load_profiles
from agronomy.irrigation import assess_irrigation
from agronomy.rotation_planner import plan_rotations
from agronomy.suitability import evaluate_crop, load_crop_requirements, temperature_component


def historical_weather(temperature=18):
    start, end = date(2021, 1, 1), date(2025, 12, 31)
    return {"status": "available", "documentation": "https://power.larc.nasa.gov/",
            "version": "test", "request": {"retrieval": "fresh_cache"}, "records": [
                {"date": (start + timedelta(days=offset)).isoformat(),
                 "temperature_mean_c": temperature, "temperature_min_c": temperature - 2,
                 "temperature_max_c": temperature + 2}
                for offset in range((end - start).days + 1)]}


class SuitabilityTests(unittest.TestCase):
    def setUp(self):
        self.season = {"periodStart": "2026-03-01", "periodEnd": "2026-08-01"}
        self.inputs = {
            "analysisContext": {"areaHa": 2, "asOf": "2026-01-01"},
            "irrigation": {"availability": "available", "applicationEfficiency": .8,
                           "waterBudget": {"volumeM3": 2500, "basis": "field_inlet", **self.season}},
            "fieldObservations": {"seasonalWaterBalance": [{
                "cropId": "wheat", **self.season, "netIrrigationRequirementMm": 100,
                "source": "Measured field water balance", "method": "Validated local seasonal balance"}]},
        }
        self.weather = historical_weather()

    def screen(self, crop="wheat", soil=None):
        return evaluate_crop(crop, soil=soil or {"ph": 6.5, "texture": "loam"}, season=self.season,
                             weather=self.weather, inputs=self.inputs)

    def test_all_ten_reference_profiles_can_complete_with_matching_evidence(self):
        self.assertEqual(len(load_crop_requirements()), 10)
        for crop, requirements in load_crop_requirements().items():
            with self.subTest(crop=crop):
                temperature = sum(requirements["meanTemperature"]) / 2
                self.weather = historical_weather(temperature)
                self.inputs["fieldObservations"]["seasonalWaterBalance"][0]["cropId"] = crop
                result = self.screen(crop, {"ph": sum(requirements["ph"]) / 2,
                                           "texture": sorted(requirements["textures"])[0]})
                self.assertEqual(result["scoreStatus"], "complete")
                self.assertEqual(result["evaluationStatus"], "evaluated")
                self.assertEqual(result["score"], 100)
                self.assertEqual(result["knownWeight"], 1)

    def test_missing_water_stays_unknown_and_never_renormalizes_weights(self):
        self.inputs["irrigation"]["waterBudget"] = None
        result = self.screen()
        self.assertIsNone(result["score"])
        self.assertIsNone(result["componentScores"]["water"])
        self.assertEqual(result["knownWeight"], .7)
        self.assertIn("water", result["missingFields"])

    def test_known_zero_water_is_distinct_and_period_mismatch_cannot_reuse_allocation(self):
        self.inputs["irrigation"]["waterBudget"]["volumeM3"] = 0
        self.inputs["irrigation"]["applicationEfficiency"] = None
        result = self.screen()
        self.assertEqual(result["componentScores"]["water"], 0)
        self.assertEqual(result["score"], 70)
        self.inputs["irrigation"]["waterBudget"]["periodEnd"] = "2027-08-01"
        self.assertIsNone(self.screen()["componentScores"]["water"])

    def test_net_gross_depth_conversion_and_measured_requirement_are_required(self):
        self.inputs["irrigation"]["waterBudget"]["volumeM3"] = 1250
        self.assertEqual(self.screen()["componentScores"]["water"], 50)
        self.inputs["fieldObservations"]["seasonalWaterBalance"][0]["method"] = ""
        self.assertIsNone(self.screen()["componentScores"]["water"])

    def test_known_reference_incompatibility_is_excluded_not_hidden_in_an_average(self):
        result = self.screen(soil={"ph": 9, "texture": "loam"})
        self.assertEqual(result["evaluationStatus"], "excluded")
        self.assertIsNone(result["score"])
        self.assertTrue(result["exclusionReasons"])

    def test_farmer_documented_season_can_be_screened_without_inventing_a_calendar_date(self):
        result = evaluate_crop("wheat", soil={"ph": 6.5, "texture": "loam"}, season=None,
                               weather=self.weather, inputs=self.inputs)
        self.assertEqual(result["scoreStatus"], "complete")
        self.assertEqual(result["scenario"]["periodOrigin"], "farmer_supplied_water_balance_period")

    def test_seasonal_planning_is_independent_of_daily_field_observations(self):
        self.inputs["seasonalWaterBalance"] = self.inputs.pop("fieldObservations")["seasonalWaterBalance"]
        result = evaluate_crop("wheat", soil={"ph": 6.5, "texture": "loam"}, season=None,
                               weather=self.weather, inputs=self.inputs)
        self.assertEqual(result["scoreStatus"], "complete")
        self.assertEqual(result["componentScores"]["water"], 100)
        self.assertEqual(result["scenario"]["periodOrigin"], "farmer_supplied_water_balance_period")
        self.assertNotIn("fieldObservations", self.inputs)

    def test_explicit_empty_top_level_balance_clears_legacy_nested_planning_data(self):
        self.inputs["seasonalWaterBalance"] = []
        self.assertIsNone(self.screen()["componentScores"]["water"])
        self.inputs["seasonalWaterBalance"] = None
        self.assertEqual(self.screen()["componentScores"]["water"], 100)

    def test_no_irrigation_access_is_known_zero_when_a_positive_net_need_is_documented(self):
        self.inputs["irrigation"] = {"availability": "none", "waterBudget": None,
                                     "applicationEfficiency": None}
        self.assertEqual(self.screen()["componentScores"]["water"], 0)

    def test_cross_year_historical_window_needs_three_complete_seasons(self):
        season = {"periodStart": "2026-10-01", "periodEnd": "2027-05-01"}
        requirements = load_crop_requirements()["wheat"]
        value, evidence = temperature_component(self.weather, season, requirements)
        self.assertIsNotNone(value)
        self.assertEqual(evidence["completeSeasons"], 4)
        self.weather["records"] = [row for row in self.weather["records"]
                                   if row["date"] not in {"2022-01-15", "2023-01-15"}]
        value, evidence = temperature_component(self.weather, season, requirements)
        self.assertIsNone(value)
        self.assertEqual(evidence["completeSeasons"], 2)

    def test_historical_screen_never_reads_observations_after_the_analysis_cutoff(self):
        self.inputs["analysisContext"]["asOf"] = "2023-01-01"
        result = self.screen()
        self.assertIsNone(result["componentScores"]["temperature"])
        self.assertEqual(result["scenario"]["completeSeasons"], 2)
        self.assertTrue(all(row["end"] < "2023-01-02" for row in result["scenario"]["seasons"]))

    def test_duplicate_or_stale_weather_cannot_produce_a_complete_temperature_factor(self):
        self.weather["records"].append(self.weather["records"][0].copy())
        self.assertIsNone(self.screen()["componentScores"]["temperature"])
        self.weather["records"].pop()
        self.weather["request"]["retrieval"] = "stale_cache"
        self.assertIsNone(self.screen()["componentScores"]["temperature"])

    def test_historical_frost_risk_reduces_temperature_factor_without_claiming_a_future_event(self):
        good = self.screen()["componentScores"]["temperature"]
        for row in self.weather["records"]:
            if row["date"][5:] == "04-10":
                row["temperature_min_c"] = -15
        result = self.screen()
        self.assertLess(result["componentScores"]["temperature"], good)
        self.assertFalse(result["scenario"]["isForecast"])

    def test_known_soil_conflict_prevents_supported_rotation_labels(self):
        from agronomy.tests.test_api import field_fixture
        field = field_fixture()
        inputs = {"soil": {"source": "soil_test", "ph": 14, "texture": "loam"},
                  "irrigation": {}, "previousCropId": "wheat", "currentPlan": None}
        result = plan_rotations(field, inputs, date(2026, 1, 1), load_profiles(), "balanced")
        self.assertTrue(all(plan["planStatus"] == "provisional" for plan in result["rotationPlans"]))

    def test_dated_allocation_shortfall_changes_supported_plan_status(self):
        from agronomy.tests.test_api import field_fixture
        field = field_fixture()
        period = {"periodStart": "2026-04-20", "periodEnd": "2026-08-25"}
        inputs = {"soil": {"source": "soil_test", "ph": 6.8, "texture": "loam"},
                  "previousCropId": None,
                  "currentPlan": [{"seasonIndex": 1, "cropId": "maize"}, {"seasonIndex": 2, "cropId": "barley"}],
                  "analysisContext": {"areaHa": 2},
                  "irrigation": {"availability": "available", "applicationEfficiency": .8,
                                 "waterBudget": {"volumeM3": 0, "basis": "field_inlet", **period}},
                  "fieldObservations": {"seasonalWaterBalance": [{"cropId": "maize", **period,
                      "netIrrigationRequirementMm": 100, "source": "Local field balance", "method": "Measured balance"}]}}
        result = plan_rotations(field, inputs, date(2026, 1, 1), load_profiles(), "balanced")
        baseline = result["rotationPlans"][0]
        self.assertEqual(baseline["waterAllocationStatus"], "shortfall")
        self.assertEqual(baseline["planStatus"], "provisional")
        self.assertTrue(all(plan["sequence"][0] != "maize" for plan in result["rotationPlans"][1:]))
        inputs["irrigation"]["waterBudget"]["volumeM3"] = 100_000
        result = plan_rotations(field, inputs, date(2026, 1, 1), load_profiles(), "balanced")
        self.assertEqual(result["rotationPlans"][0]["planStatus"], "supported")


class IrrigationIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.observations = {
            "cropId": "tomato", "variant": "processing", "observedOn": "2026-07-01",
            "stage": "mid_season", "et0MmDay": 5, "source": "Measured soil test",
            "rootZoneLayers": [{"thicknessM": .3, "thetaFc": .30, "thetaWp": .15, "thetaNow": .22},
                               {"thicknessM": .3, "thetaFc": .28, "thetaWp": .14, "thetaNow": .18}],
        }
        self.irrigation = {"availability": "available", "applicationEfficiency": .8,
                           "waterBudget": {"volumeM3": 1300, "basis": "field_inlet",
                                           "periodStart": "2026-07-01", "periodEnd": "2026-07-31"}}

    def assess(self):
        return assess_irrigation(self.observations, self.irrigation, area_ha=2, as_of="2026-07-01")

    def test_measured_root_zone_engine_is_exposed_with_field_volumes(self):
        result = self.assess()
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["calculation"]["totalAvailableWaterMm"], 87)
        self.assertEqual(result["netRefillM3"], 1080)
        self.assertEqual(result["grossRefillM3"], 1350)
        self.assertFalse(result["allocationContext"]["canDeliverGrossRefill"])

    def test_missing_root_moisture_does_not_become_a_zero_deficit(self):
        self.observations["rootZoneLayers"][0]["thetaNow"] = None
        result = self.assess()
        self.assertEqual(result["status"], "needs_root_zone_moisture")
        self.assertIsNone(result["grossRefillM3"])
        self.assertNotIn("netRefillToFieldCapacityMm", result["calculation"])

    def test_old_or_future_measurements_do_not_produce_current_doses(self):
        for day, status in (("2026-06-25", "stale_observations"), ("2026-07-02", "invalid_observations")):
            with self.subTest(day=day):
                self.observations["observedOn"] = day
                result = self.assess()
                self.assertEqual(result["status"], status)
                self.assertIsNone(result["calculation"])

    def test_missing_variant_or_efficiency_is_preserved(self):
        self.observations["cropId"] = "wheat"
        self.observations.pop("variant")
        self.assertEqual(self.assess()["status"], "needs_variant")
        self.observations["cropId"] = "tomato"
        self.observations["variant"] = "processing"
        self.irrigation["applicationEfficiency"] = None
        result = self.assess()
        self.assertEqual(result["status"], "ready")
        self.assertIsNone(result["grossRefillM3"])
        self.assertEqual(result["netRefillM3"], 1080)


if __name__ == "__main__":
    unittest.main()
