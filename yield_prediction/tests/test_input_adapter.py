"""Contract scenarios; synthetic weather is used only to exercise the interface."""

from datetime import date, timedelta
from pathlib import Path
import copy
import json

import pytest

from yield_prediction import build_model_features, predict_yield
from yield_prediction.input_adapter import COLD, schema_validator


@pytest.fixture()
def raw():
    date_ranges = [(year, date(year, 4, 1), date(year, 7, 3)) for year in (2018, 2019, 2020, 2021)]
    return {
        "schema_version": "1.0", "as_of": "2021-05-17", "harvest_year": 2021,
        "region": {"country_code": "ES", "adm_id": "ES412", "boundary_source": "CY-Bench polygons",
                   "boundary_version": "1.10", "match": "cybench_verified", "latitude": 42.3,
                   "longitude": -3.7, "aggregation": "administrative_crop_mask"},
        "calendar": {"source": "TEST_FIXTURE", "seasons": [
            {"harvest_year": year, "start": start.isoformat(), "end": end.isoformat(),
             "available_on": "2017-12-31"} for year, start, end in date_ranges]},
        "soil": {"product": "CY-Bench WISE", "version": "1.10", "available_on": "2018-01-01",
                 "awc": 15.2, "awc_unit": "CY-Bench WISE", "bulk_density": 1.35,
                 "bulk_density_unit": "kg/dm3"},
        "weather": {"product": "AgERA5", "version": "2.0", "time_standard": "LST",
                    "units": {"tmin": "C", "tavg": "C", "tmax": "C", "prec": "mm/day",
                              "rad": "J/m2/day", "et0": "mm/day", "vpd": "hPa", "cwb": "mm/day"},
                    "observations": [{
                        "date": day.isoformat(), "available_on": (day + timedelta(days=14)).isoformat(),
                        "tmin": 10, "tavg": 17, "tmax": 22, "prec": 1.9, "rad": 19_000_000,
                        "et0": 3, "vpd": 14, "cwb": -1.1,
                    } for _, start, end in date_ranges for day in (
                        start + timedelta(days=i) for i in range((end - start).days + 1)
                    )]},
    }


def codes(result):
    return {item["code"] for item in result["diagnostics"]}


@pytest.mark.parametrize("mode", ["pre_season", "mid_season", "mid_season_v2"])
def test_known_region_and_no_moisture_required(raw, mode):
    result = build_model_features(raw, "maize", mode)
    assert result["status"] == "ready", result
    assert result["recommended_mode"] == mode
    assert "soil_unavailable" not in codes(result)
    assert result["features"]["climate_seasons"] == 3
    prediction = predict_yield(result["features"], "maize", mode)
    assert prediction["predicted_yield_t_ha"] >= 0
    assert prediction["spatial_level"] == "administrative_region"


@pytest.mark.parametrize("country", ["ES", "NZ", None])
def test_new_region_or_country_uses_cold_start(raw, country):
    raw["region"].update(match="unmapped")
    raw["region"].pop("adm_id")
    if country is None:
        raw["region"].pop("country_code")
    else:
        raw["region"]["country_code"] = country
    raw.pop("soil")
    result = build_model_features(raw, "maize")
    assert result["status"] == "ready", result
    assert result["recommended_mode"] == COLD and "adm_id" not in result["features"]
    assert "soil_unavailable" in codes(result)
    prediction = predict_yield(result["features"], "maize", COLD)
    assert any("Experimental cold-start" in warning for warning in prediction["warnings"])
    external_mid = build_model_features(raw, "maize", "mid_season")
    assert external_mid["status"] == "rejected" and external_mid["recommended_mode"] == COLD


def test_point_or_annual_payload_cannot_be_used(raw):
    annual = build_model_features({"year": 2020, "average_air_temperature_c": 12}, "maize")
    assert annual["status"] == "rejected" and "invalid_schema" in codes(annual)
    raw["region"]["aggregation"] = "field_point"
    assert "incompatible_spatial_support" in codes(build_model_features(raw, "maize"))
    raw["region"]["aggregation"] = "administrative_crop_mask"
    raw["weather"]["product"] = "NASA POWER"
    assert "incompatible_weather_source" in codes(build_model_features(raw, "maize"))


def test_unit_errors_and_supported_conversions(raw):
    original = build_model_features(raw, "maize")
    converted = copy.deepcopy(raw)
    converted["weather"]["units"].update(rad="MJ/m2/day", vpd="kPa")
    for day in converted["weather"]["observations"]:
        day["rad"] /= 1_000_000
        day["vpd"] /= 10
    assert build_model_features(converted, "maize")["features"] == original["features"]
    raw["weather"]["units"]["rad"] = "W/m2"
    assert "invalid_schema" in codes(build_model_features(raw, "maize"))
    raw["weather"]["units"]["rad"] = "MJ/m2/day"
    assert "unusable_model_input" in codes(build_model_features(raw, "maize"))


def test_future_and_delayed_weather_are_excluded(raw):
    before = build_model_features(raw, "maize", "mid_season")
    assert before["status"] == "ready"
    assert before["features"]["mid_weather_through"] == "2021-05-03"
    late = next(d for d in raw["weather"]["observations"] if d["date"] == "2021-05-03")
    late.update(available_on="2021-05-18", tavg=99)
    after = build_model_features(raw, "maize", "mid_season")
    assert after["features"]["mid_weather_through"] == "2021-05-02"
    assert after["features"]["mid_temperature_c"] == before["features"]["mid_temperature_c"]
    assert "weather_unavailable_at_forecast" in codes(after)
    assert after["features"]["climate_temperature_c"] == before["features"]["climate_temperature_c"]


def test_missing_seasons_and_dates(raw):
    raw["calendar"]["seasons"] = raw["calendar"]["seasons"][-2:]
    assert "insufficient_climate_history" in codes(build_model_features(raw, "maize"))
    raw["calendar"]["seasons"][-1].pop("start")
    assert "invalid_schema" in codes(build_model_features(raw, "maize"))


def test_saved_candidate_predictions_have_no_region_history():
    from yield_prediction.inference import load_bundle

    root = Path(__file__).resolve().parents[1]
    for crop in ("maize", "wheat"):
        bundle = load_bundle(crop, COLD)
        assert "history" not in bundle
        assert not {"adm_id", "country_code", "regional_median_t_ha"}.intersection(bundle["model"]["columns"])
        example = json.loads((root / "artifacts/examples" / f"{crop}_pre_season.json").read_text())
        features = example["features"]
        prediction = predict_yield(features, crop, COLD)["predicted_yield_t_ha"]
        features = {**features, "country_code": "ZZ", "adm_id": "changed"}
        assert predict_yield(features, crop, COLD)["predicted_yield_t_ha"] == prediction
        candidate = json.loads((root / "artifacts/generalization" / f"{crop}_midseason_candidate_example.json").read_text())
        assert predict_yield(candidate["features"], crop, "mid_season_v2")["predicted_yield_t_ha"] == pytest.approx(
            candidate["predicted_yield_t_ha"], abs=1e-10)


def test_adapter_matches_real_cybench_feature_extraction(raw):
    """Compare an actual Spanish weather series to the independent CSV preparation route."""
    from zipfile import ZipFile

    import pandas as pd

    from yield_prediction.features import CLIMATE, MID, WEATHER, feature_table, seasons

    root = Path(__file__).resolve().parents[1]
    archive = root / "data/raw/sample/sample-b55e691.zip"
    if not archive.is_file():
        pytest.skip("Download the pinned sample to exercise real weather")
    with ZipFile(archive) as source:
        name = next(m for m in source.namelist() if m.endswith("/meteo_maize_ES.csv"))
        daily = pd.read_csv(source.open(name), usecols=["adm_id", "date", *WEATHER])
    daily = daily.loc[daily.adm_id.eq("ES412") & daily.date.between(20180401, 20210517)]
    windows = seasons(pd.DataFrame({"adm_id": "ES412", "harvest_year": [2018, 2019, 2020, 2021],
                                    "sos": 91, "eos": 184}))
    # Use the identical date windows, including the leap year's day-of-year dates.
    for example, row in zip(raw["calendar"]["seasons"], windows.itertuples()):
        example["start"] = row.season_start.date().isoformat()
        example["end"] = row.season_end.date().isoformat()
    raw["weather"]["observations"] = []
    for day in daily.to_dict("records"):
        observed = pd.to_datetime(str(day["date"]), format="%Y%m%d").date()
        row = {name: float(day[name]) if pd.notna(day[name]) else None for name in WEATHER}
        raw["weather"]["observations"].append({
            "date": observed.isoformat(), "available_on": (observed + timedelta(days=14)).isoformat(), **row})
    result = build_model_features(raw, "maize", "mid_season")
    assert result["status"] == "ready", result
    expected = feature_table(windows, [daily.copy()]).iloc[-1]
    for field in [*CLIMATE, *MID]:
        assert result["features"][field] == pytest.approx(expected[field], abs=1e-8)
