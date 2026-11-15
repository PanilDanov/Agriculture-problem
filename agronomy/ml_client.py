"""The field API's bounded, explicit boundary to the independent ML runtime."""

import os
import math
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

import requests

from .assessment import load_profiles
from .regional_store import RegionalInputStore

CROPS = tuple(load_profiles()["crops"])


def validated_forecast(result, request):
    if not isinstance(result, dict) or result.get("crop") != request["crop"]:
        raise ValueError("The model response belongs to a different crop")
    payload = request.get("nationalInput", request.get("environmentalInput"))
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    diagnostics = result.get("diagnostics")
    if not isinstance(diagnostics, dict) or diagnostics.get("inputSha256") != fingerprint:
        raise ValueError("The model response belongs to a different input, season or data cutoff")
    forecast = result.get("forecast")
    if not isinstance(forecast, dict) or forecast.get("crop") != request["crop"]:
        raise ValueError("The model forecast has no matching crop identity")
    value = forecast.get("predicted_yield_t_ha")
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError("The model forecast must be a finite nonnegative yield")
    if not isinstance(forecast.get("model_version"), str) or not forecast["model_version"]:
        raise ValueError("The model forecast is missing its version")
    if not isinstance(forecast.get("warnings"), list) or any(not isinstance(w, str) for w in forecast["warnings"]):
        raise ValueError("The model forecast has invalid warnings")
    if request["mode"] == "annual_history":
        expected = request["nationalInput"]
        if (forecast.get("spatial_level") != "country" or forecast.get("mode") != "annual_history"
                or forecast.get("country_code") != expected["countryCode"]
                or forecast.get("harvest_year") != expected["harvestYear"]):
            raise ValueError("Country, year or scope differs from the requested national forecast")
    else:
        diagnostics = result.get("diagnostics") or {}
        source = diagnostics.get("source") or {}
        region = source.get("region") or {}
        expected = request["environmentalInput"]["region"]
        if (forecast.get("spatial_level") != "administrative_region"
                or region.get("adm_id") != expected["adm_id"]
                or region.get("country_code") != expected["country_code"]
                or forecast.get("mode") != diagnostics.get("resolvedMode")):
            raise ValueError("The regional model response has mismatched scope or provenance")
    return forecast


class YieldClient:
    def __init__(self, base_url=None, *, timeout=8, regional_store=None):
        self.base_url = (base_url if base_url is not None else os.environ.get("ORBITFARM_ML_URL", "")).rstrip("/")
        parsed = urlsplit(self.base_url)
        if self.base_url and (parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise ValueError("ORBITFARM_ML_URL must be an HTTP(S) service URL without credentials or query parameters")
        self.timeout = timeout
        token = os.environ.get("ORBITFARM_ML_TOKEN", "")
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.store = regional_store or RegionalInputStore(os.environ.get("ORBITFARM_REGIONAL_INPUT_DIR") or Path(__file__).with_name("regional_inputs"))

    def ready(self):
        if not self.base_url:
            return {"status": "unavailable", "reason": "ORBITFARM_ML_URL is not configured."}
        try:
            response = requests.get(f"{self.base_url}/ready", timeout=(1, 3), headers=self.headers)
            payload = response.json()
            return {"status": "ready" if response.ok else "degraded", "details": payload}
        except (requests.RequestException, ValueError):
            return {"status": "unavailable", "reason": "The independent ML service is not reachable."}

    def forecasts(self, boundary, country, as_of, *, harvest_year=None, mode="auto", crops=CROPS):
        year = harvest_year or int(as_of[:4]) + 1
        if not self.base_url:
            return [{"cropId": crop, "harvestYear": year, "status": "unavailable", "code": "ML_NOT_CONFIGURED",
                     "reason": "The yield service has not been configured for this installation."} for crop in crops]
        requests_body, contexts = [], []
        for crop in crops:
            regional_mode = "mid_season_v2" if mode == "mid_season" else "pre_season"
            regional = self.store.select(boundary, crop, regional_mode, year, as_of) if crop in ("maize", "wheat") and mode != "annual_history" else None
            if regional and regional["status"] == "available":
                request = {"crop": crop, "mode": regional_mode, "environmentalInput": regional["environmentalInput"]}
                context = {key: value for key, value in regional.items() if key != "environmentalInput"}
            elif mode in ("pre_season", "mid_season"):
                # Explicit regional requests must never silently change their scientific scope.
                requests_body.append(None)
                contexts.append({"cropId": crop, "status": "unavailable", "mode": mode,
                                 "reason": (regional or {}).get("reason", "This crop has no regional model."),
                                 "code": (regional or {}).get("code", "REGIONAL_MODEL_UNAVAILABLE")})
                continue
            else:
                request = {"crop": crop, "mode": "annual_history", "nationalInput": {
                    "countryCode": country, "harvestYear": year, "asOf": as_of}}
                context = {"scopeReason": (regional or {}).get("reason", "National yield-history model selected.")}
            requests_body.append(request)
            contexts.append({"cropId": crop, "harvestYear": year, **context})
        active = [request for request in requests_body if request is not None]
        try:
            if not active:
                return contexts
            response = requests.post(f"{self.base_url}/v1/yields", json={"requests": active}, timeout=(1, self.timeout), headers=self.headers)
            response.raise_for_status()
            results = response.json()["results"]
            if not isinstance(results, list) or len(results) != len(active):
                raise ValueError("The ML batch response does not match the request")
        except (requests.RequestException, ValueError, KeyError, TypeError):
            return [{**context, "status": "unavailable", "code": "ML_SERVICE_UNAVAILABLE",
                     "reason": "The yield service could not complete this analysis. Retry without losing the field analysis."}
                    if request is not None else context for context, request in zip(contexts, requests_body)]
        output, cursor = [], 0
        for context, request in zip(contexts, requests_body):
            if request is None:
                output.append(context)
                continue
            result = results[cursor]
            cursor += 1
            if isinstance(result, dict) and result.get("status") != "ready":
                error = result.get("error")
                error = error if isinstance(error, dict) else {}
                output.append({**context, "status": "unavailable", "code": result.get("code") or error.get("code", "MODEL_INPUT_UNAVAILABLE"),
                               "reason": result.get("message") or error.get("message", "The model has insufficient compatible inputs."),
                               "diagnostics": result.get("diagnostics")})
                continue
            try:
                forecast = validated_forecast(result, request)
            except (ValueError, TypeError, KeyError, AttributeError):
                output.append({**context, "status": "unavailable", "code": "INVALID_MODEL_RESPONSE",
                               "reason": "The yield service returned an incompatible forecast; no value has been substituted."})
                continue
            output.append({**context, "status": "available", "forecast": forecast,
                           "diagnostics": result.get("diagnostics", {}),
                           "usesNasaWeather": False,
                           "nasaContext": "NASA POWER weather is used independently in the field water and suitability assessments."})
        return output
