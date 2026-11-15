"""Exercise the actual HTTP boundary and all packaged regional estimators."""

from contextlib import contextmanager
import hashlib
from http.client import HTTPConnection
import json
from pathlib import Path
import threading
from datetime import date

import pytest

from yield_prediction.service import InferenceServer, RequestError, predict_batch, predict_request

ROOT = Path(__file__).resolve().parents[1]


def model_examples():
    cases = []
    for path in sorted((ROOT / "artifacts/examples").glob("*.json")):
        row = json.loads(path.read_text())
        cases.append((path.name, row["crop"], row["mode"], row["features"], row["expected_yield_t_ha"]))
    for path in sorted((ROOT / "artifacts/generalization").glob("*candidate_example.json")):
        row = json.loads(path.read_text())
        mode = "mid_season_v2" if "midseason" in path.name else "cold_start_pre_season"
        cases.append((path.name, row["crop"], mode, row["features"], row["predicted_yield_t_ha"]))
    return cases


@contextmanager
def running_server(**kwargs):
    server = InferenceServer(("127.0.0.1", 0), **kwargs)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def request(server, path, payload=None, *, raw=None, headers=None, method=None):
    body = raw if raw is not None else json.dumps(payload) if payload is not None else None
    connection = HTTPConnection(*server.server_address, timeout=15)
    connection.request(method or ("POST" if body is not None else "GET"), path, body,
                       headers={"Content-Type": "application/json", **(headers or {})})
    response = connection.getresponse()
    result = json.loads(response.read())
    status = response.status
    connection.close()
    return status, result


@pytest.mark.parametrize("name,crop,mode,features,expected", model_examples(), ids=lambda item: item if isinstance(item, str) else None)
def test_actual_packaged_model_is_used(name, crop, mode, features, expected):
    result = predict_request({"crop": crop, "mode": mode, "features": features})
    assert result["status"] == "ready"
    assert result["forecast"]["predicted_yield_t_ha"] == pytest.approx(expected, rel=0, abs=1e-8)
    assert result["forecast"]["spatial_level"] == "administrative_region"
    assert result["diagnostics"]["source"]["spatialAggregationVerifiedByService"] is False
    canonical = json.dumps(features, sort_keys=True, separators=(",", ":"), allow_nan=False)
    assert result["diagnostics"]["inputSha256"] == hashlib.sha256(canonical.encode()).hexdigest()
    assert result["diagnostics"]["releaseStatus"] == ("experimental" if "candidate" in name else "released")
    json.dumps(result, allow_nan=False)


def test_http_round_trip_and_errors_do_not_replace_forecasts():
    _, crop, mode, features, expected = model_examples()[0]
    payload = {"crop": crop, "mode": mode, "features": features}
    with running_server() as server:
        assert request(server, "/health")[0] == 200
        status, result = request(server, "/v1/yield", payload)
        assert status == 200
        assert result["forecast"]["predicted_yield_t_ha"] == pytest.approx(expected, rel=0, abs=1e-8)
        status, result = request(server, "/v1/yield", {**payload, "features": {**features, "climate_precipitation_mm": -1}})
        assert status == 422
        assert result["code"] == "INVALID_MODEL_INPUT"
        assert "forecast" not in result
        assert request(server, "/missing")[0] == 404


def test_http_rejects_ambiguous_and_nonfinite_json():
    with running_server() as server:
        for raw in ('{"crop":"maize","crop":"wheat"}', '{"crop":"maize","features":{"x":NaN}}', '{"x":Infinity}'):
            status, result = request(server, "/v1/yield", raw=raw)
            assert status == 400
            assert result["code"] == "INVALID_JSON"
        assert request(server, "/v1/yield", {"crop": "maize", "features": {}, "nationalInput": {}})[0] == 422
        assert request(server, "/v1/yield", {"crop": "maize", "features": {}}, headers={"Content-Type": "text/plain"})[0] == 415
    with running_server(max_body_bytes=128) as server:
        assert request(server, "/v1/yield", raw=" " * 129)[0] == 413


def test_optional_service_auth_and_concurrency_limit():
    _, crop, mode, features, _ = model_examples()[0]
    payload = {"crop": crop, "mode": mode, "features": features}
    with running_server(token="test-service-token", max_concurrent=1) as server:
        assert request(server, "/health")[0] == 200
        assert request(server, "/v1/yield", payload)[0] == 401
        headers = {"Authorization": "Bearer test-service-token"}
        assert server.inference_slots.acquire(blocking=False)
        try:
            status, result = request(server, "/v1/yield", payload, headers=headers)
            assert status == 503
            assert result["code"] == "SERVICE_BUSY"
        finally:
            server.inference_slots.release()
        assert request(server, "/v1/yield", payload, headers=headers)[0] == 200


def test_batch_keeps_crop_association_and_partial_errors():
    _, crop, mode, features, expected = model_examples()[0]
    with running_server() as server:
        status, result = request(server, "/v1/yields", {"requests": [
            {"crop": crop, "mode": mode, "features": features},
            {"crop": "tomato", "mode": "pre_season", "features": features},
        ]})
    assert status == 200
    assert result["status"] == "partial"
    assert result["results"][0]["crop"] == crop
    assert result["results"][0]["forecast"]["predicted_yield_t_ha"] == pytest.approx(expected, rel=0, abs=1e-8)
    assert result["results"][1]["crop"] == "tomato"
    assert result["results"][1]["code"] == "UNSUPPORTED_MODEL"
    with pytest.raises(RequestError):
        predict_batch({"requests": []})


def test_point_nasa_input_cannot_be_relabelled_as_regional_features():
    raw = json.loads((ROOT / "docs/examples/raw_synthetic.json").read_text())
    raw["weather"]["product"] = "NASA POWER"
    with pytest.raises(RequestError) as caught:
        predict_request({"crop": "maize", "environmentalInput": raw})
    assert caught.value.code == "INCOMPATIBLE_MODEL_INPUT"
    assert caught.value.diagnostics["adapter"]["status"] == "rejected"


def test_national_mode_does_not_claim_a_midseason_weather_update():
    with pytest.raises(RequestError) as caught:
        predict_request({"crop": "barley", "mode": "mid_season", "nationalInput": {"countryCode": "US"}})
    assert caught.value.code == "INVALID_MODE"


def test_absent_model_is_a_service_failure_not_a_bad_farm_input(monkeypatch, tmp_path):
    import yield_prediction.inference as inference
    import yield_prediction.service as service

    _, crop, mode, features, _ = model_examples()[0]
    monkeypatch.setattr(inference, "MODEL_DIR", tmp_path)
    monkeypatch.setattr(service, "MODEL_DIR", tmp_path)
    inference.load_bundle.cache_clear()
    try:
        with running_server() as server:
            status, result = request(server, "/v1/yield", {"crop": crop, "mode": mode, "features": features})
        assert status == 503
        assert result["code"] == "MODEL_UNAVAILABLE"
        assert "forecast" not in result
    finally:
        inference.load_bundle.cache_clear()


def test_real_national_forecasts_for_every_product_crop_and_readiness():
    from yield_prediction.national import CROP_ITEMS, load_national

    requests = []
    for crop in CROP_ITEMS:
        bundle, metadata = load_national(crop)
        # Use a real country with a complete five-year history. One country need
        # not grow every crop; absent production is not a fabricated yield.
        country = next(code for code, records in bundle["history"].items()
                       if date.today().year - max(int(row[0]) for row in records) <= 5
                       and all(year in {int(row[0]) for row in records}
                              for year in range(max(int(row[0]) for row in records) - 4,
                                                max(int(row[0]) for row in records) + 1)))
        requests.append({"crop": crop, "mode": "annual_history", "nationalInput": {
            "countryCode": country, "asOf": date.today().isoformat(), "harvestYear": date.today().year,
        }})
    with running_server() as server:
        status, result = request(server, "/v1/yields", {"requests": requests})
        assert status == 200
        assert result["status"] == "ready", result
        assert {row["crop"] for row in result["results"]} == set(CROP_ITEMS)
        for row in result["results"]:
            assert row["forecast"]["predicted_yield_t_ha"] > 0
            assert row["forecast"]["spatial_level"] == "country"
            assert row["forecast"]["mode"] == "annual_history"
            assert row["diagnostics"]["usesCurrentSeasonWeather"] is False
            assert row["forecast"]["model_version"]
        status, ready = request(server, "/ready")
    assert status == 200, ready
    assert ready["nationalModels"]["readyModels"] == 10
    assert len(ready["regionalModels"]) == 8
    assert all(row["status"] == "ready" for row in ready["regionalModels"])
