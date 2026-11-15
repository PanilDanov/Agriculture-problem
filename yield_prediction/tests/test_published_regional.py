"""Check the real, bundled release without downloading data or GIS extras."""

from datetime import date, datetime, timezone
import hashlib
import json
from pathlib import Path

import pytest

from yield_prediction.service import RequestError, predict_request

RELEASE = Path(__file__).resolve().parents[2] / "agronomy/regional_inputs"
REGISTRY = json.loads((RELEASE / "registry.json").read_text())
PROVENANCE = json.loads((RELEASE / "source_provenance.json").read_text())


@pytest.mark.parametrize("record", REGISTRY["regions"][0]["datasets"], ids=lambda row: row["cropId"])
def test_published_2026_region_reaches_real_estimator_with_honest_dates(record):
    body = (RELEASE / record["path"]).read_bytes()
    assert hashlib.sha256(body).hexdigest() == record["sha256"]
    raw = json.loads(body)
    result = predict_request({"crop": record["cropId"], "mode": "pre_season", "environmentalInput": raw})
    forecast, diagnostics = result["forecast"], result["diagnostics"]
    reference = next(row for row in PROVENANCE["verification"] if row["cropId"] == record["cropId"])
    assert result["status"] == "ready"
    assert forecast["predicted_yield_t_ha"] == pytest.approx(reference["referencePredictionTHa"], rel=0, abs=1e-8)
    assert forecast["spatial_level"] == "administrative_region"
    assert diagnostics["adapter"]["coverage"]["historical_seasons"] == 5
    assert diagnostics["adapter"]["coverage"]["mid_weather_fraction"] == 0
    assert diagnostics["dataThrough"] == record["dataThrough"] == reference["climateThrough"]
    assert diagnostics["dataThrough"].startswith("2023-")
    assert diagnostics["inputAsOf"] == raw["as_of"] == "2026-11-15"
    assert diagnostics["dataThrough"] != diagnostics["inputAsOf"]
    assert max(row["date"] for row in raw["weather"]["observations"]) == "2023-12-31"
    issued = forecast["forecast_date"]
    assert issued == reference["forecastDate"]
    assert PROVENANCE["conservativeAvailableOn"] <= issued
    assert all(row["available_on"] <= issued for row in raw["weather"]["observations"])
    assert all(row["available_on"] <= issued for row in raw["calendar"]["seasons"])
    assert raw["soil"]["available_on"] <= issued
    assert raw["region"]["adm_id"] == REGISTRY["regions"][0]["regionId"] == "ES112"
    assert raw["region"]["aggregation"] == "administrative_crop_mask"
    assert raw["weather"]["product"] == "CY-Bench AgERA5"
    assert forecast["is_replay"] is (date.fromisoformat(issued) < datetime.now(timezone.utc).date())
    assert forecast["temporal_status"] == ("retrospective_estimate" if forecast["is_replay"] else "current_forecast")
    calculated = datetime.fromisoformat(forecast["calculated_at"].replace("Z", "+00:00"))
    assert calculated.tzinfo is not None
    assert abs((datetime.now(timezone.utc) - calculated).total_seconds()) < 10
    assert diagnostics["isReplay"] is forecast["is_replay"]
    assert diagnostics["calculatedAt"] == forecast["calculated_at"]


@pytest.mark.parametrize("record", REGISTRY["regions"][0]["datasets"], ids=lambda row: row["cropId"])
def test_old_daily_archive_cannot_be_claimed_as_a_2026_midseason_update(record):
    raw = json.loads((RELEASE / record["path"]).read_text())
    with pytest.raises(RequestError) as caught:
        predict_request({"crop": record["cropId"], "mode": "mid_season", "environmentalInput": raw})
    assert caught.value.code == "INCOMPATIBLE_MODEL_INPUT"
    assert caught.value.diagnostics["adapter"]["status"] != "ready"
