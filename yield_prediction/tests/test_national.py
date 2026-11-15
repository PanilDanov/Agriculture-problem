"""National models use real FAOSTAT artifacts, country scope, and preceding labels."""
from datetime import date
import json
import math

import numpy as np
import pytest

from yield_prediction.national import (
    CROP_ITEMS, FEATURES, load_national, model_features, national_readiness,
    predict_national_yield,
)


def test_features_do_not_read_target_or_future_labels():
    observations = {year: 2 + (year - 2010) / 10 for year in range(2010, 2025)}
    expected = model_features(observations, 2020)
    observations.update({2020: 999, 2021: 888, 2024: 777})
    np.testing.assert_array_equal(expected, model_features(observations, 2020))
    assert expected.shape == (len(FEATURES),)
    assert expected[0] == pytest.approx(math.log(observations[2019]))


def test_gaps_and_nonphysical_history_are_rejected():
    observations = {year: 2.0 for year in range(2015, 2020)}
    observations.pop(2017)
    with pytest.raises(ValueError, match="consecutive"):
        model_features(observations, 2020)
    observations[2017] = float("nan")
    with pytest.raises(ValueError, match="positive"):
        model_features(observations, 2020)


def test_all_ten_real_released_models_and_forecasts():
    readiness = national_readiness()
    assert readiness["status"] == "ready"
    assert readiness["readyModels"] == 10
    assert {model["crop"] for model in readiness["models"]} == set(CROP_ITEMS)
    for crop in CROP_ITEMS:
        bundle, meta = load_national(crop)
        # Use an observed producing country with complete recent history.
        country = next(country for country, history in sorted(bundle["history"].items())
                       if max(row[0] for row in history) == meta["training_through"])
        result = predict_national_yield(crop=crop, country_code=country,
                                       as_of=meta["source"]["published_on"], harvest_year=2025)
        assert result["predicted_yield_t_ha"] > 0
        assert result["mode"] == "annual_history"
        assert result["spatial_level"] == "country"
        assert result["prediction_interval_t_ha"] is None
        assert result["source"]["dataset"].startswith("FAOSTAT")
        assert result["training_through"] == 2024
        assert result["validation"]["holdout"]["n"] > 30
        assert any("not current-season NASA" in warning for warning in result["warnings"])
        json.dumps(result, allow_nan=False)
        load_national.cache_clear()
        assert predict_national_yield(crop=crop, country_code=country,
                  as_of=meta["source"]["published_on"], harvest_year=2025) == result


def test_invalid_country_dates_and_horizon_fail_without_substitution():
    with pytest.raises(ValueError, match="country_code"):
        predict_national_yield(crop="wheat", country_code="USA")
    with pytest.raises(ValueError, match="Unsupported crop"):
        predict_national_yield(crop="rice", country_code="US")
    with pytest.raises(ValueError, match="No observed"):
        predict_national_yield(crop="wheat", country_code="ZZ")
    with pytest.raises(ValueError, match="publication"):
        predict_national_yield(crop="wheat", country_code="US", as_of="2020-01-01")
    with pytest.raises(ValueError, match="Historical replay"):
        predict_national_yield(crop="wheat", country_code="US", as_of="2025-12-31", harvest_year=2024)
    with pytest.raises(ValueError, match="horizon"):
        predict_national_yield(crop="wheat", country_code="US", as_of="2025-12-31", harvest_year=2030)
    with pytest.raises(ValueError, match="integer"):
        predict_national_yield(crop="wheat", country_code="US", harvest_year=True)


def test_missing_country_is_not_filled_from_world_average():
    bundle, metadata = load_national("wheat")
    assert "ZZ" not in bundle["history"]
    assert "World" not in bundle["country_names"].values()
    assert metadata["source"]["archive_sha256"]
    assert metadata["source"]["country_mapping_sha256"]
