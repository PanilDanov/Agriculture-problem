import copy
import json
import unittest
from pathlib import Path

from agronomy.assessment import assess, load_profiles


class AssessmentTests(unittest.TestCase):
    def setUp(self):
        self.profiles = load_profiles()
        self.example = json.loads(
            (Path(__file__).parents[1] / "example_request.json").read_text(encoding="utf-8")
        )

    def test_every_crop_variant_runs_and_has_traceable_references(self):
        expected_ids = {
            "wheat", "barley", "maize", "sorghum", "chickpea",
            "lentil", "faba-bean", "sunflower", "potato", "tomato",
        }
        crops = self.profiles["crops"]
        self.assertEqual(set(crops), expected_ids)
        self.assertEqual(
            {crop for crop, profile in crops.items() if profile["yield_forecast_scope"] == "grain"},
            {"wheat", "maize"},
        )
        hazards = self.profiles["rotation_hazards"]
        self.assertEqual({crop for hazard in hazards for crop in hazard["candidate_crops"]}, expected_ids)
        for hazard in hazards:
            self.assertLessEqual(set(hazard["preceding_crops"]), expected_ids)
            self.assertTrue(hazard["evidence"])
            for source in hazard["evidence"]:
                self.assertIn(source["source_id"], self.profiles["sources"])

        self.assertEqual(sum(len(profile["irrigation"]["variants"]) for profile in crops.values()), 24)
        for crop, profile in crops.items():
            for variant_id, variant in profile["irrigation"]["variants"].items():
                with self.subTest(crop=crop, variant=variant_id):
                    result = assess({
                        "crop_id": crop,
                        "irrigation": {
                            "local_date": "2026-07-18", "et0_mm_day": 5,
                            "variant": variant_id, "stage": "late", "stage_progress": 1,
                        },
                    }, self.profiles)["irrigation"]
                    self.assertEqual(result["kc"], variant["kc"]["end"])
                    self.assertEqual(result["kc_reference"]["source_id"], "fao56-rev1")
                    self.assertEqual(result["threshold_status"], "needs_root_zone_layers")

    def test_cross_year_tomato_water_and_potato_host(self):
        result = assess(self.example, self.profiles)
        water = result["irrigation"]
        self.assertEqual(water["etc_standard_mm_day"], 5.5)
        self.assertEqual(water["total_available_water_mm"], 87)
        self.assertEqual(water["readily_available_water_mm"], 33.06)
        self.assertEqual(water["net_refill_to_field_capacity_mm"], 54)
        self.assertEqual(water["gross_refill_at_supplied_efficiency_mm"], 67.5)
        self.assertEqual(water["threshold_status"], "reached")
        rotation = result["rotation"]
        self.assertEqual(rotation["status"], "review_recorded_crop_matches")
        self.assertEqual(rotation["matches"][0]["hazard_id"], "potato-tomato-verticillium")
        self.assertEqual(rotation["matches"][0]["latest_harvest_by_matching_crop"], {"potato": "2024-04-12"})
        self.assertFalse(rotation["same_crop_in_latest_recorded_harvest"])

    def test_missing_moisture_keeps_water_demand_without_refill_estimate(self):
        self.example["irrigation"]["root_zone_layers"][1]["theta_now"] = None
        water = assess(self.example, self.profiles)["irrigation"]
        self.assertEqual(water["etc_standard_mm_day"], 5.5)
        self.assertEqual(water["total_available_water_mm"], 87)
        self.assertEqual(water["threshold_status"], "needs_root_zone_moisture")
        self.assertNotIn("gross_refill_at_supplied_efficiency_mm", water)

    def test_harvest_profile_and_locally_supplied_coefficients(self):
        request = {
            "crop_id": "maize",
            "irrigation": {
                "local_date": "2026-09-20", "et0_mm_day": 4,
                "variant": "dry-grain", "stage": "late", "stage_progress": 0.5,
            },
        }
        self.assertEqual(assess(request, self.profiles)["irrigation"]["etc_standard_mm_day"], 3.0)
        request["irrigation"]["variant"] = "wet-grain"
        self.assertEqual(assess(request, self.profiles)["irrigation"]["etc_standard_mm_day"], 3.7)
        request["irrigation"]["local_kc"] = {
            "initial": 0.32, "mid_season": 1.25, "end": 0.70, "source": "Synthetic test adjustment",
        }
        water = assess(request, self.profiles)["irrigation"]
        self.assertEqual(water["etc_standard_mm_day"], 3.9)
        self.assertEqual(water["kc_basis"], "Synthetic test adjustment")

    def test_shared_host_and_unknown_history_use_distinct_statuses(self):
        request = {"crop_id": "sunflower", "rotation": {"planting_date": "2026-05-01"}}
        self.assertEqual(assess(request, self.profiles)["rotation"]["status"], "needs_field_history")
        request["rotation"]["history"] = []
        self.assertEqual(assess(request, self.profiles)["rotation"]["status"], "needs_history_coverage")
        request["rotation"]["history_complete_since"] = "2022-04-01"
        self.assertEqual(
            assess(request, self.profiles)["rotation"]["status"], "no_catalog_match_in_supplied_history"
        )
        request["rotation"]["history"] = [{"crop_id": "lentil", "harvest_date": "2025-09-01"}]
        matches = assess(request, self.profiles)["rotation"]["matches"]
        self.assertEqual(matches[0]["hazard_id"], "sunflower-lentil-sclerotinia")

    def test_unknown_variant_and_unphysical_or_future_observations_fail(self):
        for key, invalid in (
            ("variant", "greenhouse"), ("et0_mm_day", float("nan")), ("application_efficiency", 0),
        ):
            with self.subTest(field=key):
                request = copy.deepcopy(self.example)
                request["irrigation"][key] = invalid
                with self.assertRaises(ValueError):
                    assess(request, self.profiles)
        self.example["rotation"]["history"][0]["harvest_date"] = "2026-04-12"
        with self.assertRaises(ValueError):
            assess(self.example, self.profiles)

    def test_team_faba_alias_matches_canonical_history(self):
        request = {
            "crop_id": "faba_bean",
            "rotation": {
                "planting_date": "2026-06-28",
                "history": [{"crop_id": "faba-bean", "harvest_date": "2026-06-28"}],
            },
        }
        result = assess(request, self.profiles)
        self.assertEqual(result["crop_id"], "faba-bean")
        self.assertTrue(result["rotation"]["same_crop_in_latest_recorded_harvest"])
        self.assertEqual(result["rotation"]["matches"][0]["days_since_latest_matching_harvest"], 0)


if __name__ == "__main__":
    unittest.main()
