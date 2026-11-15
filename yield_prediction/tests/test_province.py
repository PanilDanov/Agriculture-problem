"""Temporal exclusions and real inference for the separate NASA point models."""
from copy import deepcopy
from datetime import date
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import joblib
import numpy as np
import pytest

from yield_prediction.national import CROP_ITEMS
from yield_prediction.province import (MODES, issue_date, load_province, make_features,
                                       monthly_weather, province_readiness)
from yield_prediction.service import RequestError, predict_request

RELEASE = Path(__file__).resolve().parents[2] / "agronomy/province_inputs"
REGISTRY = json.loads((RELEASE / "registry.json").read_text())
WEATHER_BYTES = (RELEASE / "weather.json.gz").read_bytes()
assert hashlib.sha256(WEATHER_BYTES).hexdigest() == REGISTRY["weatherSha256"]
WEATHER = json.loads(gzip.decompress(WEATHER_BYTES))["records"]
AS_OF = date.fromisoformat(REGISTRY["asOf"])


def history_fixture():
    # Deliberately artificial numbers test exclusion rules, never train a model
    # or serve as operational predictions. Actual model tests below use MAPA.
    return {year: 2 + (year - 1990) / 100 for year in range(1990, 2027)}


def features(history, weather, calendar, mode):
    return make_features(history, weather, calendar, 2026, mode, as_of=AS_OF, provinces=["02"], province_id="02")


@pytest.mark.parametrize("calendar,mode,cutoff", [
    ({"sowing_month": 4, "harvest_month": 9}, "pre_season", 2024),
    ({"sowing_month": 11, "harvest_month": 6}, "pre_season", 2023),
    ({"sowing_month": 11, "harvest_month": 6}, "mid_season", 2024),
])
def test_target_and_unpublished_recent_yields_cannot_enter_live_features(calendar, mode, cutoff):
    weather = monthly_weather(WEATHER["02"], as_of=AS_OF)
    history = history_fixture()
    original, diagnostics = features(history, weather, calendar, mode)
    for year in range(cutoff + 1, 2027):
        history[year] = 10000
    changed, _ = features(history, weather, calendar, mode)
    np.testing.assert_array_equal(original, changed)
    assert diagnostics["labelCutoffYear"] == diagnostics["labelDataThrough"] == cutoff


def test_preseason_excludes_target_weather_and_midseason_excludes_later_months():
    weather = monthly_weather(WEATHER["02"], as_of=AS_OF)
    calendar = {"sowing_month": 4, "harvest_month": 9}
    history = history_fixture()
    pre, _ = features(history, weather, calendar, "pre_season")
    mid, diagnostics = features(history, weather, calendar, "mid_season")
    changed = dict(weather)
    for key in weather:
        if key >= "2026-01":
            changed[key] = (45.0, 70.0, 50.0)
    np.testing.assert_array_equal(pre, features(history, changed, calendar, "pre_season")[0])
    later = dict(weather)
    for key in weather:
        if key > diagnostics["dataThrough"]:
            later[key] = (45.0, 70.0, 50.0)
    np.testing.assert_array_equal(mid, features(history, later, calendar, "mid_season")[0])
    observed = dict(weather)
    observed[diagnostics["dataThrough"]] = (45.0, 70.0, 50.0)
    assert not np.array_equal(mid, features(history, observed, calendar, "mid_season")[0])
    assert diagnostics["availabilityInterpretation"] == "retrospective_observation_cutoff"
    assert diagnostics["weatherSupport"] == "point_proxy"


def test_midseason_requires_actual_observed_current_season_months():
    weather = monthly_weather(WEATHER["02"], as_of=AS_OF)
    weather = {key: value for key, value in weather.items() if key < "2026-01"}
    with pytest.raises(ValueError, match="No complete current-season"):
        features(history_fixture(), weather, {"sowing_month": 4, "harvest_month": 9}, "mid_season")


@pytest.mark.parametrize("missing", ["2026-02", "2026-04"])
def test_midseason_rejects_interior_and_latest_expected_month_gaps(missing):
    weather = monthly_weather(WEATHER["02"], as_of=AS_OF)
    calendar = {"sowing_month": 1, "harvest_month": 9}
    _, diagnostics = features(history_fixture(), weather, calendar, "mid_season")
    assert diagnostics["dataThrough"] == "2026-04"
    del weather[missing]
    with pytest.raises(ValueError, match="missing eligible months"):
        features(history_fixture(), weather, calendar, "mid_season")


def test_future_nominal_issue_is_not_labelled_as_a_current_forecast():
    weather = monthly_weather(WEATHER["02"], as_of=AS_OF)
    with pytest.raises(ValueError, match="precedes the nominal forecast"):
        features(history_fixture(), weather, {"sowing_month": 11, "harvest_month": 12}, "mid_season")


def test_monthly_input_rejects_wrong_support_and_fill_or_annual_summary():
    for modify in (lambda row: row.update(support="administrative_crop_mask"),
                   lambda row: row["observations"][0].update(temperatureMeanC=-999),
                   lambda row: row["observations"][0].update(month="2024-13")):
        raw = deepcopy(WEATHER["02"])
        modify(raw)
        with pytest.raises(ValueError):
            monthly_weather(raw, as_of=AS_OF)


@pytest.mark.parametrize("crop,mode", [(crop, mode) for crop in CROP_ITEMS for mode in MODES])
def test_all_twenty_real_mapa_nasa_estimators_and_provenance(crop, mode):
    bundle, metadata = load_province(crop, mode)
    # At least one registered real province must support a current target. A
    # crop absent from a province must never borrow another province's labels.
    successes = []
    for code in metadata["provinces"]:
        payload = {"countryCode": "ES", "regionId": code, "harvestYear": 2026,
                   "asOf": REGISTRY["asOf"], "weather": WEATHER[code]}
        try:
            result = predict_request({"crop": crop, "mode": mode, "provinceInput": payload})
        except RequestError as error:
            if error.code == "INVALID_MODEL_INPUT":
                continue
            raise
        successes.append(result)
        forecast, diagnostics = result["forecast"], result["diagnostics"]
        assert forecast["predicted_yield_t_ha"] > 0
        assert forecast["crop"] == crop and forecast["mode"] == mode
        assert forecast["region_id"] == code and forecast["harvest_year"] == 2026
        assert forecast["weather_support"] == "representative_point"
        assert forecast["spatial_level"] == "administrative_region"
        assert forecast["release_status"] == "experimental"
        assert diagnostics["weatherSupport"] == "point_proxy"
        assert diagnostics["inputKind"] == "provinceInput"
        assert diagnostics["labelDataThrough"] <= diagnostics["labelCutoffYear"]
        assert diagnostics["dataThrough"] <= issue_date(bundle["regions"][code]["calendar"], 2026, mode).isoformat()[:7]
        assert forecast["training_through"] < 2026
        validation = forecast["validation"]
        assert max(validation["training_years_before_holdout"]) < min(validation["holdout_years"])
        assert len(validation["holdout_years"]) == 3
        assert validation["conservative_policy_metrics"]["count"] > 0
        assert all(np.isfinite(value) for key, value in validation["metrics"].items() if key != "count")
        assert "published_on" in forecast["source"]["calendar"]
        assert forecast["source"]["calendar"]["published_on"] is None
        assert forecast["is_replay"] is True
        break
    assert successes, f"No real released province supports {crop}/{mode} in 2026"


def test_province_response_cannot_borrow_weather_from_a_different_point_or_country():
    _, metadata = load_province("barley", "pre_season")
    code = metadata["provinces"][0]
    payload = {"countryCode": "ES", "regionId": code, "harvestYear": 2026,
               "asOf": REGISTRY["asOf"], "weather": deepcopy(WEATHER[code])}
    payload["weather"]["longitude"] += 1
    with pytest.raises(RequestError, match="coordinates"):
        predict_request({"crop": "barley", "mode": "pre_season", "provinceInput": payload})
    payload["countryCode"] = "FR"
    with pytest.raises(RequestError, match="Spain"):
        predict_request({"crop": "barley", "mode": "pre_season", "provinceInput": payload})
    assert province_readiness()["readyModels"] == 20


def test_real_barley_retraining_is_reproducible_from_tracked_portable_weather(tmp_path):
    root = Path(__file__).resolve().parents[1]
    env = {**os.environ, "PYTHONPATH": str(root / "src"), "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"}
    subprocess.run([sys.executable, str(root / "train_province.py"), "--crops", "barley",
                    "--output", str(tmp_path / "models"), "--report", str(tmp_path / "report.json")],
                   cwd=tmp_path, env=env, capture_output=True, text=True, check=True, timeout=120)
    report = json.loads((tmp_path / "report.json").read_text())
    assert report["weather_source"]["kind"] == "hash_verified_portable_release"
    assert report["weather_source"]["sha256"] == REGISTRY["weatherSha256"]
    for mode in MODES:
        model_path = tmp_path / "models" / f"barley_{mode}.joblib"
        actual = json.loads(model_path.with_suffix(".json").read_text())
        original, released = load_province("barley", mode)
        assert actual["model_version"] == released["model_version"]
        for key in ("features", "provinces", "runtime", "source", "training_code_sha256", "feature_code_sha256"):
            assert actual[key] == released[key]
        # Each artifact retains strict checksum integrity. Serialized bytes and
        # BLAS rounding need not be identical across macOS ARM and Linux x86.
        assert hashlib.sha256(model_path.read_bytes()).hexdigest() == actual["artifact_sha256"]
        retrained = joblib.load(model_path)
        assert retrained["regions"] == original["regions"]
        features = []
        for code in released["current_coverage_regions"]:
            region = original["regions"][code]
            history = {int(year): float(value) for year, value in region["history"]}
            row, _ = make_features(history, monthly_weather(WEATHER[code], as_of=AS_OF), region["calendar"],
                                   2026, mode, as_of=AS_OF, provinces=released["provinces"], province_id=code)
            features.append(row)
        assert features
        matrix = np.stack(features)
        np.testing.assert_allclose(np.exp(retrained["model"].predict(matrix)),
                                   np.exp(original["model"].predict(matrix)), rtol=1e-8, atol=1e-10)
        assert actual["validation"]["selected_estimator"] == released["validation"]["selected_estimator"]
        checks = [(actual["validation"][name], released["validation"][name])
                  for name in ("metrics", "conservative_policy_metrics")]
        checks.extend((actual["validation"]["metrics_by_label_age"][age], stats)
                      for age, stats in released["validation"]["metrics_by_label_age"].items())
        for measured, expected in checks:
            assert measured["count"] == expected["count"]
            for key in expected:
                np.testing.assert_allclose(measured[key], expected[key], rtol=1e-8, atol=1e-10)
