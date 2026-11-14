"""Synthetic boundary tests and real CY-Bench training/inference checks."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from threadpoolctl import threadpool_limits

from yield_prediction import predict_yield
from yield_prediction.data import prepare
from yield_prediction.experiment import run
from yield_prediction.features import CLIMATE, MID, TARGET, WEATHER, feature_table, seasons
from yield_prediction.inference import load_bundle
from yield_prediction.models import HISTORY, YieldHistory
from yield_prediction.validation import eligible, make_fold, read_prepared

ROOT = Path(__file__).resolve().parents[1]


def test_season_and_units_without_future_weather():
    """Synthetic only: later temperatures must not affect upcoming-season or mid forecasts."""
    calendar = seasons(pd.DataFrame({
        "adm_id": "THERE", "harvest_year": [2015, 2016, 2017, 2018],
        "sos": 300, "eos": 65,
    }))
    row = calendar.iloc[-1]
    assert row.season_start == pd.Timestamp("2017-10-27")
    assert row.season_end == pd.Timestamp("2018-03-06")
    dates = pd.date_range("2014-01-01", "2018-04-01")
    weather = pd.DataFrame({"adm_id": "THERE", "date": dates.strftime("%Y%m%d"),
                            **dict(zip(WEATHER, [10, 24, 17, 2, 12_000_000, 4, 15, -2]))})
    before = feature_table(calendar.copy(), [weather.copy()])
    assert before.iloc[-1].climate_radiation_mj_m2_day == 12
    assert before.iloc[-1].mid_vpd_kpa == 1.5
    assert before.iloc[-1].mid_precipitation_mm == 2 * ((row.mid_weather_cutoff - row.season_start).days + 1)
    weather.loc[dates > row.mid_weather_cutoff, ["tavg", "tmax"]] = 550
    after = feature_table(calendar.copy(), [weather.copy()])
    pd.testing.assert_series_equal(before.loc[3, CLIMATE + MID], after.loc[3, CLIMATE + MID])
    changed = feature_table(calendar.copy(), [weather.assign(tavg=19)])
    assert changed.loc[3, "climate_temperature_c"] != before.loc[3, "climate_temperature_c"]


def test_label_history_publication_and_country_boundary():
    """Synthetic only: labels at and after July's proxy timestamp cannot leak backwards."""
    observations = pd.DataFrame({"crop": "maize", "country_code": "ES", "adm_id": "ES1",
                                 "harvest_year": [2014, 2016, 2017, 2018], TARGET: [8, 9, 777, 888]})
    history = YieldHistory(observations)
    assert history.at("maize", "ES", "ES1", pd.Timestamp("2018-06-30")) == [8.5, 8.5, 2]
    assert history.at("maize", "ES", "ES1", pd.Timestamp("2018-07-01")) == [9, 9, 3]
    assert history.at("maize", "NL", "ES1", pd.Timestamp("2018-08-01"))[-1] == 0
    snapshot = history.snapshot(pd.Timestamp("2018-06-30"), "maize")
    assert snapshot.at("maize", "ES", "ES1", pd.Timestamp("2019-12-01")) == [8.5, 8.5, 2]


@pytest.fixture(scope="module")
def examples():
    return [json.loads(path.read_text(encoding="utf-8"))
            for path in sorted((ROOT / "artifacts/examples").glob("*.json"))]


def test_all_packaged_forecasts(examples):
    assert {(row["crop"], row["mode"]) for row in examples} == {
        (crop, mode) for crop in ("maize", "wheat") for mode in ("pre_season", "mid_season")
    }
    for row in examples:
        result = predict_yield(row["features"], row["crop"], row["mode"])
        assert result["predicted_yield_t_ha"] == pytest.approx(row["expected_yield_t_ha"], abs=1e-8)
        assert result["prediction_interval_t_ha"] is None
        assert result["spatial_level"] == "administrative_region"
        json.dumps(result, allow_nan=False)
        load_bundle.cache_clear()
        assert predict_yield(row["features"], row["crop"], row["mode"]) == result


def test_inference_validation_and_missing_soil(examples):
    example = next(row for row in examples if row["crop"] == "maize" and row["mode"] == "pre_season")
    payload = example["features"]
    with pytest.raises(ValueError, match="Unsupported crop"):
        predict_yield(payload, "tomato")
    with pytest.raises(ValueError, match="Unsupported mode"):
        predict_yield(payload, "maize", "post_season")
    with pytest.raises(ValueError, match="latitude"):
        predict_yield({**payload, "latitude": 100}, "maize")
    with pytest.raises(ValueError, match="precipitation"):
        predict_yield({**payload, "climate_precipitation_mm": float("inf")}, "maize")
    with pytest.raises(ValueError, match="climate_through"):
        predict_yield({**payload, "climate_through": payload["season_start"]}, "maize")
    with pytest.raises(ValueError, match="Unknown features"):
        predict_yield({**payload, "mid_temperature_c": 10}, "maize")
    result = predict_yield({**payload, "awc": None, "bulk_density": None, "country_code": "US",
                            "adm_id": "Iowa-region"}, "maize")
    assert np.isfinite(result["predicted_yield_t_ha"])
    assert any("outside training coverage" in text for text in result["warnings"])
    assert any("soil or location" in text for text in result["warnings"])
    example = next(row for row in examples if row["crop"] == "maize" and row["mode"] == "mid_season")
    payload = example["features"]
    with pytest.raises(ValueError, match="outside the available"):
        predict_yield({**payload, "mid_weather_through": payload["season_end"]}, "maize", "mid_season")


@pytest.fixture(scope="module")
def sample():
    path = ROOT / "data/raw/sample/sample-b55e691.zip"
    if not path.exists():
        pytest.skip("download_data.py sample is required for the real-data integration tests")
    table, audits = prepare([path])
    assert len(audits) == 4
    assert len(table) > 2_000
    assert not table.duplicated(["crop", "country_code", "adm_id", "harvest_year"]).any()
    return table


def test_real_split_prevents_temporal_and_spatial_leakage(sample):
    eligible_rows = eligible(sample, "pre_season")
    test = eligible_rows.loc[eligible_rows.harvest_year.eq(2018) & eligible_rows.country_code.eq("ES")]
    train, test, history = make_fold(sample, "pre_season", test, excluded_country="ES", learning_size=60)
    assert train.harvest_year.max() <= 2016
    assert set(train.crop) == {"maize", "wheat"}
    assert set(train.country_code) == {"NL"}
    assert test[HISTORY[0]].isna().all()
    assert test.climate_through.lt(test.pre_forecast_date).all()
    assert not any(key[1] == "ES" for key in history.groups)


def test_real_sample_load_train_reload_and_repeat(sample, tmp_path, monkeypatch):
    import yield_prediction.inference as inference

    monkeypatch.setattr(inference, "MODEL_DIR", tmp_path / "models")
    config = json.loads((ROOT / "configs/sample.json").read_text())
    meta = {"dataset": "sample test", "dataset_sha256": "fixture-data"}
    results = []
    with threadpool_limits(limits=2):
        for _ in range(2):
            report = run(sample, "pre_season", "maize", config, ["ridge"], 0,
                         tmp_path, tmp_path / "models", meta, diagnostics=False)
            inference.load_bundle.cache_clear()
            example = json.loads((tmp_path / "examples/maize_pre_season.json").read_text())
            result = predict_yield(example["features"], "maize")
            assert result["predicted_yield_t_ha"] == pytest.approx(example["expected_yield_t_ha"], abs=1e-8)
            results.append((report["metadata"]["selected_model"], result["predicted_yield_t_ha"]))
    inference.load_bundle.cache_clear()
    assert results[0] == results[1]
