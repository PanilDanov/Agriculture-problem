import gzip
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
import requests
from netCDF4 import Dataset
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import Point, shape

from agronomy.assessment import load_profiles
from agronomy.field_calendars import fao_windows, fetch_calendars, fetch_gridded_window, fetch_modeled_window
from agronomy.field_context import collect_field_context, read_sources
from agronomy.field_geometry import CountryLookup, field_point
from agronomy.field_providers import Retrieval, SourceClient, fetch_soil, fetch_weather
from data_pipeline import SOIL_NATIVE_CRS


def polygon(west=-3, south=41, east=-2, north=42):
    return {
        "type": "Polygon",
        "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    }


def geotiff(x, y, raw):
    with MemoryFile() as memory:
        with memory.open(
            driver="GTiff", width=1, height=1, count=1, dtype="int16",
            crs=SOIL_NATIVE_CRS, transform=from_origin(x - 125, y + 125, 250, 250), nodata=-32768,
        ) as dataset:
            dataset.write(np.array([[raw]], dtype="int16"), 1)
        return memory.read()


def calendar_fixture(x, y, variables, data_format):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "calendar.nc"
        with Dataset(path, "w", format=data_format) as dataset:
            for axis in (x, y):
                dataset.createDimension(axis, 2)
                dataset.createVariable(axis, "f", (axis,))[:] = [0.25, 0.75]
            for variable, value in variables.items():
                dataset.createVariable(variable, "f", (y, x), fill_value=9e20)[:] = [
                    [value, 9e20], [value, 9e20],
                ]
        return path.read_bytes()


class FieldContextTests(unittest.TestCase):
    def setUp(self):
        self.config = read_sources()
        self.day = date(2024, 2, 29)

    def test_probe_is_on_field_and_crosses_the_dateline_safely(self):
        boundary = polygon()
        boundary["coordinates"].append([[-2.9, 41.1], [-2.1, 41.1], [-2.1, 41.9], [-2.9, 41.9], [-2.9, 41.1]])
        self.assertTrue(shape(boundary).contains(Point(*field_point(boundary))))
        longitude, latitude = field_point(polygon(179.8, -18, -179.9, -17.7))
        self.assertGreater(abs(longitude), 179.8)
        self.assertAlmostEqual(latitude, -17.85)
        self.assertEqual(field_point({"type": "Feature", "geometry": boundary}), field_point(boundary))

    def test_country_is_a_point_in_polygon_lookup_with_an_ambiguity_status(self):
        lookup = CountryLookup({
            "type": "FeatureCollection",
            "features": [
                {"geometry": polygon(), "properties": {"ISO_A2_EH": "AA", "GEOUNIT": "First"}},
                {"geometry": polygon(-2, 41, -1, 42), "properties": {"ISO_A2": "BB", "GEOUNIT": "Second"}},
            ],
        })
        self.assertEqual(lookup.locate(-2.5, 41.5)["country_code"], "AA")
        self.assertEqual(lookup.locate(-2, 41.5)["status"], "ambiguous")
        self.assertEqual(lookup.locate(1, 1)["status"], "unavailable")

    def test_power_preserves_dates_and_keeps_fill_values_distinct_from_zero(self):
        first = date(2024, 2, 28)
        columns = {"T2M": ["temperature_mean_c", "degC"], "PRECTOTCORR": ["precipitation_mm", "mm/day"]}
        config = {**self.config["weather"], "parameters": columns}
        payload = {
            "header": {"time_standard": "LST", "fill_value": -999, "api": {"version": "test"}},
            "parameters": {"T2M": {"units": "C"}, "PRECTOTCORR": {"units": "mm/day"}},
            "properties": {"parameter": {
                "T2M": {"20240228": 9, "20240229": -999},
                "PRECTOTCORR": {"20240228": 0, "20240229": 3.25},
            }},
        }
        client = Mock()
        client.get.return_value = Retrieval(payload, {"retrieval": "test"})
        result = fetch_weather(client, config, -2.5, 41.5, first, self.day)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["records"][0]["precipitation_mm"], 0)
        self.assertIsNone(result["records"][1]["temperature_mean_c"])
        self.assertEqual(result["records"][1]["date"], "2024-02-29")
        self.assertEqual(result["valid_days_by_field"]["temperature_mean_c"], 1)

    @patch("agronomy.field_providers.transform", return_value=([0], [0]))
    def test_soil_decodes_projected_geotiffs_and_leaves_nodata_missing(self, transform_mock):
        raw = {"wv0010": 310, "wv0033": 272, "wv1500": -32768}
        source = {
            **self.config["soil"], "depths": ["0-5cm"],
            "properties": {key: self.config["soil"]["properties"][key] for key in raw},
        }
        client = Mock()
        client.get.side_effect = lambda url, **kwargs: Retrieval(geotiff(0, 0, raw[url.split("/")[-1]]), {})
        output = fetch_soil(client, source, 0, 0)
        layer = output["layers"]["0-5cm"]
        self.assertEqual(layer["water_content_33kpa"], 0.272)
        self.assertIsNone(layer["water_content_1500kpa"])
        self.assertEqual(output["status"], "partial")
        self.assertEqual(client.get.call_count, 3)

    def test_fao_maps_species_and_keeps_all_published_seasons(self):
        crop = {"id_country": "BD", "crop": {"id": "0054"}, "aez": {"id": "003", "name": "Zone 3"}}
        seasons = [
            {"early_sowing": {"month": "11", "day": "20"}, "later_sowing": {"month": "1", "day": "5"}},
            {"early_sowing": {"month": "4", "day": "0"}},
        ]
        unrelated = {**crop, "crop": {"id": "0027"}, "sessions": seasons}
        data = [{**crop, "sessions": seasons}, unrelated]
        source = self.config["fao_calendar"]
        crops = fao_windows(data, source, "BD", None)
        beans = crops["faba-bean"]
        self.assertEqual(len(beans), 2)
        self.assertEqual(beans[0]["scope"], "regional_candidate")
        self.assertEqual(beans[0]["planting"]["latest"], {"month": 1, "day": 5})
        self.assertIsNone(beans[1]["planting"]["earliest"]["day"])
        self.assertEqual(fao_windows(data, source, "BD", "004")["faba-bean"], [])
        self.assertEqual(set(crops), set(load_profiles()["crops"]))

    def test_grid_missing_cell_does_not_borrow_a_neighboring_calendar(self):
        variables = dict.fromkeys(("plant", "plant.start", "plant.end", "harvest", "harvest.start", "harvest.end"), 1)
        payload = gzip.compress(calendar_fixture("longitude", "latitude", variables, "NETCDF3_CLASSIC"))
        client = Mock()
        client.get.side_effect = lambda url, **kwargs: Retrieval(kwargs["decode"](payload), {})
        source = self.config["gridded_calendar"]
        window, audit = fetch_gridded_window(client, source, "main", "Maize", 0.2, 0.3)
        self.assertEqual(window["planting"]["typical"], {"month": 1, "day": 1})
        missing, audit = fetch_gridded_window(client, source, "main", "Maize", 0.8, 0.3)
        self.assertIsNone(missing)
        self.assertEqual(audit["status"], "no_grid_value")

    def test_modeled_calendar_distinguishes_maturity_from_harvest(self):
        payload = calendar_fixture(
            "lon", "lat", {"planting_day": 151, "maturity_day": 283, "data_source_used": 8}, "NETCDF4",
        )
        client = Mock()
        client.get.side_effect = lambda url, **kwargs: Retrieval(kwargs["decode"](payload), {})
        source = self.config["modeled_calendar"]
        window, audit = fetch_modeled_window(client, source, "main", "mai", "rf", 0.2, 0.3)
        self.assertEqual(audit["status"], "available")
        self.assertEqual(window["scope"], "modeled_grid_candidate")
        self.assertEqual(window["water_regime"], "rainfed")
        self.assertEqual(window["planting"]["typical"], {"month": 5, "day": 31})
        self.assertEqual(window["maturity"]["typical"], {"month": 10, "day": 10})
        self.assertEqual(window["upstream_source_code"], 8)
        self.assertNotIn("harvest", window)

    @patch("agronomy.field_providers.requests.get")
    def test_cache_can_replay_a_file_and_marks_stale_fallback(self, get):
        get.return_value.content = b'{"ok": true}'
        with tempfile.TemporaryDirectory() as directory:
            client = SourceClient(directory)
            url = "https://example.test/source"
            asset = client.get(url)
            self.assertEqual(asset.value, {"ok": True})
            self.assertTrue((Path(directory) / asset.provenance["cache_file"]).is_file())
            get.side_effect = requests.ConnectionError("test outage")
            stale = client.get(url, ttl_days=0)
            self.assertEqual(stale.provenance["retrieval"], "stale_cache")
            replayed = SourceClient(directory, offline=True).get(url)
            self.assertEqual(replayed.provenance["sha256"], asset.provenance["sha256"])
            self.assertEqual(get.call_count, 2)

    def test_all_ten_statuses_survive_offline_provider_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            client = SourceClient(directory, offline=True)
            result = collect_field_context(polygon(), self.day, self.day, client=client)
        self.assertEqual(result["weather"]["status"], "provider_error")
        self.assertEqual(result["soil"]["status"], "unavailable")
        crops = result["planting_calendars"]["crops"]
        self.assertEqual(set(crops), set(load_profiles()["crops"]))
        self.assertTrue(all(record["status"] == "unavailable" for record in crops.values()))
        self.assertTrue(all(record["missing_reason"] == "lookup_incomplete" for record in crops.values()))
        self.assertEqual(json.loads(json.dumps(result, allow_nan=False))["schema_version"], 1)

    @patch("agronomy.field_calendars.fetch_gridded_window", return_value=(None, {"status": "provider_error"}))
    @patch("agronomy.field_calendars.fetch_fao_calendar")
    def test_a_failed_grid_lookup_does_not_change_unrelated_crop_coverage(self, fao, _grid):
        config = {key: source for key, source in self.config.items() if key != "modeled_calendar"}
        fao.return_value = {}, {"status": "country_not_covered"}
        crops = fetch_calendars(Mock(), config, ("maize", "faba-bean"), -2.5, 41.5, "ES")["crops"]
        self.assertEqual(crops["faba-bean"]["missing_reason"], "no_source_coverage")
        self.assertEqual(crops["maize"]["missing_reason"], "lookup_incomplete")

    @patch("agronomy.field_calendars.fetch_fao_calendar", return_value=({}, {"status": "country_unavailable"}))
    def test_unresolved_country_explains_a_missing_fao_calendar(self, _fao):
        crops = fetch_calendars(Mock(), self.config, ("tomato",), -2.5, 41.5, None)["crops"]
        self.assertEqual(crops["tomato"]["missing_reason"], "country_unresolved")


if __name__ == "__main__":
    unittest.main()
