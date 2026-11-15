"""Bounded HTTP inference for the released, candidate, and national yield models.

Run in the pinned Python 3.11 ML environment, separately from the field API.
The service never substitutes a forecast when input data or a model is absent.
"""

import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
import socket
import threading
from urllib.parse import urlsplit

from .inference import CANDIDATE_DIR, CANDIDATE_MODES, MODEL_DIR, load_bundle, predict_yield
from .input_adapter import build_model_features
from .native import prepare_native_runtime

LOG = logging.getLogger("orbitfarm.ml")
REGIONAL_MODES = ("pre_season", "mid_season", *CANDIDATE_MODES)
INPUT_KINDS = ("environmentalInput", "features", "nationalInput", "provinceInput")
MAX_BODY_BYTES = 4 * 1024 * 1024
SOCKET_TIMEOUT_SECONDS = 15
_model_lock = threading.Lock()


class RequestError(Exception):
    def __init__(self, code, message, *, status=422, diagnostics=None):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status
        self.diagnostics = diagnostics


def _metadata(crop, mode):
    # Loading and hashing are serialized because lru_cache does not deduplicate
    # concurrent first loads, and native estimators may initialize shared state.
    with _model_lock:
        try:
            bundle = load_bundle(crop, mode)
            directory = CANDIDATE_DIR if mode in CANDIDATE_MODES else MODEL_DIR
            # The sidecar contains the artifact hash; embedding the hash in the
            # binary itself would make it self-referential. load_bundle verifies it.
            sidecar = json.loads((directory / f"{crop}_{mode}.json").read_text(encoding="utf-8"))
            return {**sidecar, **bundle["metadata"], "artifact_sha256": sidecar["artifact_sha256"]}
        except Exception as error:
            raise RuntimeError(f"Model {crop}/{mode} is unavailable: {error}") from error


def readiness():
    """Verify every packaged regional model and the ten-crop national release."""
    models = []
    try:
        prepare_native_runtime()
    except (OSError, RuntimeError) as error:
        native_error = str(error)
    else:
        native_error = None
    for crop in ("maize", "wheat"):
        for mode in REGIONAL_MODES:
            record = {"crop": crop, "mode": mode,
                      "releaseStatus": "experimental" if mode in CANDIDATE_MODES else "released"}
            try:
                if native_error:
                    raise RuntimeError(native_error)
                metadata = _metadata(crop, mode)
                record.update(status="ready", modelVersion=metadata["model_version"],
                              artifactSha256=metadata["artifact_sha256"],
                              spatialLevel=metadata["spatial_level"])
            except Exception as error:
                LOG.warning("Model unavailable: %s/%s: %s", crop, mode, error)
                record.update(status="unavailable", reason=str(error))
            models.append(record)
    try:
        from .national import national_readiness
        national = national_readiness()
        if not isinstance(national, dict):
            raise RuntimeError("Invalid national readiness report")
    except (ImportError, OSError, ValueError, RuntimeError) as error:
        national = {"status": "unavailable", "reason": str(error)}
    try:
        from .province import province_readiness
        provincial = province_readiness()
    except (ImportError, OSError, ValueError, RuntimeError) as error:
        provincial = {"status": "unavailable", "reason": str(error)}
    regional_ready = all(model["status"] == "ready" for model in models)
    ready = regional_ready and national.get("status") == "ready" and provincial.get("status") == "ready"
    return {"status": "ready" if ready else "degraded", "service": "orbitfarm-yield",
            "regionalModels": models, "nationalModels": national, "provinceModels": provincial,
            "regionalReady": regional_ready, "nationalReady": national.get("status") == "ready"}


def _fingerprint(value):
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def predict_request(body):
    """Validate one HTTP payload and perform actual model inference."""
    if not isinstance(body, dict):
        raise RequestError("INVALID_REQUEST", "A JSON object is required.")
    extra = set(body) - {"crop", "mode", *INPUT_KINDS}
    if extra:
        raise RequestError("INVALID_REQUEST", "Unknown request fields: " + ", ".join(sorted(extra)))
    if not isinstance(body.get("crop"), str):
        raise RequestError("INVALID_REQUEST", "crop must be a crop identifier.")
    present = [key for key in INPUT_KINDS if key in body]
    if len(present) != 1 or not isinstance(body[present[0]], dict):
        raise RequestError("INVALID_REQUEST", "Supply exactly one object: environmentalInput, features, nationalInput, or provinceInput.")
    kind = present[0]
    crop = body["crop"]
    mode = body.get("mode", "annual_history" if kind == "nationalInput" else "pre_season")
    if not isinstance(mode, str):
        raise RequestError("INVALID_REQUEST", "mode must be a string.")
    payload = body[kind]
    diagnostics = {"requestedMode": mode, "inputKind": kind, "inputSha256": _fingerprint(payload)}
    try:
        prepare_native_runtime()
        if kind == "nationalInput":
            if mode != "annual_history":
                raise RequestError("INVALID_MODE", "National annual history does not provide an intra-season weather update.")
            extra = set(payload) - {"countryCode", "harvestYear", "asOf"}
            if extra:
                raise RequestError("INVALID_REQUEST", "Unknown national input fields: " + ", ".join(sorted(extra)))
            from .national import predict_national_yield
            forecast = predict_national_yield(crop=crop, country_code=payload.get("countryCode"),
                                             harvest_year=payload.get("harvestYear"), as_of=payload.get("asOf"))
            diagnostics.update(resolvedMode="annual_history", source=forecast.get("source"),
                               dataThrough=forecast.get("data_through"),
                               forecastScope="country", usesCurrentSeasonWeather=False)
            issued = date.fromisoformat(forecast["forecast_date"])
        elif kind == "provinceInput":
            from .province import predict_province_yield
            forecast, provincial_diagnostics = predict_province_yield(crop=crop, mode=mode, province_input=payload)
            diagnostics.update(provincial_diagnostics)
            issued = date.fromisoformat(forecast["forecast_date"])
        else:
            if crop not in ("maize", "wheat") or mode not in REGIONAL_MODES:
                raise RequestError("UNSUPPORTED_MODEL", "Regional models support maize/wheat and their documented forecast modes.")
            if kind == "environmentalInput":
                prepared = build_model_features(payload, crop, mode)
                diagnostics["adapter"] = prepared
                if prepared["status"] != "ready":
                    raise RequestError("INCOMPATIBLE_MODEL_INPUT", "Environmental data cannot support this regional forecast.",
                                       diagnostics=diagnostics)
                features = prepared["features"]
                resolved_mode = prepared["recommended_mode"]
                diagnostics["source"] = {"weather": payload.get("weather", {}).get("product"),
                                         "weatherVersion": payload.get("weather", {}).get("version"),
                                         "region": payload.get("region"), "asOf": payload.get("as_of")}
                diagnostics["inputAsOf"] = payload.get("as_of")
                # Avoid returning daily input or a second copy of all model inputs.
                diagnostics["adapter"] = {key: value for key, value in prepared.items() if key != "features"}
            else:
                features, resolved_mode = payload, mode
                diagnostics["source"] = {"kind": "client_supplied_seasonal_features",
                                         "spatialAggregationVerifiedByService": False}
            metadata = _metadata(crop, resolved_mode)
            forecast = predict_yield(features, crop, resolved_mode)
            start = date.fromisoformat(features["season_start"])
            end = date.fromisoformat(features["season_end"])
            schema_mode = CANDIDATE_MODES.get(resolved_mode, resolved_mode)
            issued = start + timedelta(days=(end - start).days // 2) if schema_mode == "mid_season" else start - timedelta(days=1)
            diagnostics.update(resolvedMode=resolved_mode, forecastScope="administrative_region",
                               releaseStatus="experimental" if resolved_mode in CANDIDATE_MODES else "released",
                               artifactSha256=metadata["artifact_sha256"],
                               forecastDate=issued.isoformat(),
                               dataThrough=features.get("mid_weather_through", features.get("climate_through")))
        if not isinstance(forecast, dict):
            raise RuntimeError("The model did not return a forecast object")
        # A calendar-derived issue date describes the scenario being evaluated;
        # it is not evidence that this service issued a forecast on that date.
        # Keep the actual calculation timestamp separate, especially for public
        # archives prepared after a nominal issue date or a completed season.
        calculated = datetime.now(timezone.utc)
        is_replay = issued < calculated.date()
        temporal_status = "retrospective_estimate" if is_replay else "current_forecast"
        calculated_at = calculated.isoformat(timespec="seconds").replace("+00:00", "Z")
        forecast.update(forecast_date=issued.isoformat(), calculated_at=calculated_at,
                        is_replay=is_replay, temporal_status=temporal_status)
        diagnostics.update(forecastDate=issued.isoformat(), calculatedAt=calculated_at,
                           isReplay=is_replay, temporalStatus=temporal_status)
        if is_replay:
            forecast.setdefault("warnings", []).append(
                "Historical replay: calculated after the nominal forecast date using the installed model and data release; "
                "this is not evidence of a forecast actually issued on that date.")
        result = {"status": "ready", "forecast": forecast, "diagnostics": diagnostics}
        json.dumps(result, allow_nan=False)
        return result
    except RequestError:
        raise
    except (TypeError, ValueError) as error:
        raise RequestError("INVALID_MODEL_INPUT", str(error), diagnostics=diagnostics) from error
    except (ImportError, OSError, RuntimeError, KeyError) as error:
        LOG.exception("Yield model unavailable for %s/%s", crop, mode)
        raise RequestError("MODEL_UNAVAILABLE", str(error), status=503, diagnostics=diagnostics) from error


def _object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON object key: " + key)
        result[key] = value
    return result


def _constant(value):
    raise ValueError("Non-finite JSON numbers are not accepted: " + value)


def predict_batch(body):
    if not isinstance(body, dict) or set(body) != {"requests"} or not isinstance(body["requests"], list):
        raise RequestError("INVALID_REQUEST", "Supply an object containing a requests array.")
    if not 1 <= len(body["requests"]) <= 20:
        raise RequestError("INVALID_REQUEST", "A batch must contain between 1 and 20 requests.")
    results = []
    for request in body["requests"]:
        try:
            result = predict_request(request)
        except RequestError as error:
            result = {"status": "unavailable" if error.status >= 500 else "rejected",
                      "code": error.code, "message": error.message,
                      "diagnostics": error.diagnostics, "httpStatus": error.status}
        results.append({"crop": request.get("crop") if isinstance(request, dict) else None, **result})
    return {"status": "ready" if all(row["status"] == "ready" for row in results) else "partial", "results": results}


class InferenceServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, *, token=None, max_body_bytes=MAX_BODY_BYTES, max_concurrent=4):
        if max_body_bytes < 1 or max_concurrent < 1:
            raise ValueError("Body and concurrency limits must be positive")
        self.token = token
        self.max_body_bytes = max_body_bytes
        self.inference_slots = threading.BoundedSemaphore(max_concurrent)
        super().__init__(address, InferenceHandler)


class InferenceHandler(BaseHTTPRequestHandler):
    server_version = "orbitFarmML/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(SOCKET_TIMEOUT_SECONDS)

    def _send(self, status, result):
        data = json.dumps(result, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.close_connection = True

    def _error(self, error):
        response = {"status": "unavailable" if error.status >= 500 else "rejected",
                    "code": error.code, "message": error.message}
        if error.diagnostics is not None:
            response["diagnostics"] = error.diagnostics
        self._send(error.status, response)

    def _authorized(self):
        if self.server.token:
            supplied = self.headers.get("Authorization", "")
            if not hmac.compare_digest(supplied, "Bearer " + self.server.token):
                raise RequestError("UNAUTHORIZED", "A valid service token is required.", status=401)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/health":
            self._send(200, {"status": "ok", "service": "orbitfarm-yield"})
        elif path == "/ready":
            result = readiness()
            self._send(200 if result["status"] == "ready" else 503, result)
        else:
            self._error(RequestError("NOT_FOUND", "Unknown endpoint.", status=404))

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ("/v1/yield", "/v1/yields"):
            self._error(RequestError("NOT_FOUND", "Unknown endpoint.", status=404))
            return
        acquired = False
        try:
            self._authorized()
            if self.headers.get("Transfer-Encoding"):
                raise RequestError("INVALID_REQUEST", "Chunked requests are not supported.", status=400)
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                raise RequestError("UNSUPPORTED_MEDIA_TYPE", "Use application/json.", status=415)
            length = self.headers.get("Content-Length", "")
            if not length.isascii() or not length.isdecimal():
                raise RequestError("INVALID_LENGTH", "A Content-Length header is required.", status=411)
            size = int(length)
            if size < 1:
                raise RequestError("INVALID_JSON", "An empty request body is not valid JSON.", status=400)
            if size > self.server.max_body_bytes:
                raise RequestError("REQUEST_TOO_LARGE", "The request exceeds the configured body limit.", status=413)
            data = self.rfile.read(size)
            if len(data) != size:
                raise RequestError("INCOMPLETE_REQUEST", "The request body is incomplete.", status=400)
            try:
                body = json.loads(data.decode("utf-8"), object_pairs_hook=_object_pairs, parse_constant=_constant)
            except (UnicodeError, ValueError, RecursionError) as error:
                raise RequestError("INVALID_JSON", str(error), status=400) from error
            acquired = self.server.inference_slots.acquire(blocking=False)
            if not acquired:
                raise RequestError("SERVICE_BUSY", "The inference worker is busy. Retry shortly.", status=503)
            self._send(200, predict_batch(body) if path == "/v1/yields" else predict_request(body))
        except RequestError as error:
            self._error(error)
        except (socket.timeout, TimeoutError):
            self._error(RequestError("REQUEST_TIMEOUT", "The request body timed out.", status=408))
        except (BrokenPipeError, ConnectionResetError):
            LOG.info("Inference client disconnected")
        except Exception:
            LOG.exception("Unexpected inference error")
            self._error(RequestError("INTERNAL_ERROR", "An unexpected inference error occurred.", status=500))
        finally:
            if acquired:
                self.server.inference_slots.release()

    def log_message(self, format, *args):
        LOG.info("%s %s", self.client_address[0], format % args)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("ORBITFARM_ML_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("ORBITFARM_ML_PORT", "8001")))
    parser.add_argument("--check", action="store_true", help="Validate model readiness and exit")
    args = parser.parse_args()
    logging.basicConfig(level=os.environ.get("ORBITFARM_LOG_LEVEL", "INFO"))
    if args.check:
        result = readiness()
        print(json.dumps(result, indent=2, allow_nan=False))
        raise SystemExit(0 if result["status"] == "ready" else 1)
    with InferenceServer((args.host, args.port), token=os.environ.get("ORBITFARM_ML_TOKEN")) as server:
        LOG.info("Serving pinned yield inference at %s:%s", *server.server_address)
        try:
            server.serve_forever(poll_interval=0.25)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
