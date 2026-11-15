"""Supervise the isolated field API and pinned ML process in one container.

PORT is the public container port. The ML port stays on loopback. Interpreter
overrides allow the same process lifecycle to be checked without local Docker.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def port(value):
    result = int(value)
    if not 1 <= result <= 65535:
        raise ValueError("Service ports must be between 1 and 65535")
    return result


def check_children(children):
    for name, process in children:
        code = process.poll()
        if code is not None:
            raise RuntimeError(f"{name} exited unexpectedly with code {code}")


def wait_ready(url, children, stop, timeout, token=None):
    deadline = time.monotonic() + timeout
    last = "not reachable"
    while not stop.is_set() and time.monotonic() < deadline:
        check_children(children)
        try:
            request = Request(url, headers={"Authorization": "Bearer " + token} if token else {})
            with urlopen(request, timeout=min(2, max(.1, deadline - time.monotonic()))) as response:
                payload = json.load(response)
            if payload.get("status") == "ready":
                check_children(children)
                return
            last = str(payload.get("status", "invalid readiness response"))
        except (OSError, URLError, ValueError) as error:
            last = type(error).__name__
        stop.wait(.2)
    if not stop.is_set():
        raise RuntimeError(f"Service readiness timed out ({last})")


def terminate(children):
    # Give the API time to finish requests while its private ML child remains
    # alive. Total cleanup stays below the platform's 30-second SIGTERM grace.
    deadline = time.monotonic() + 20
    for name, process in reversed(children):
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGTERM)
            elif process.poll() is None:
                process.terminate()
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=max(.1, min(10, deadline - time.monotonic())))
        except subprocess.TimeoutExpired:
            if os.name == "posix":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            else:
                process.kill()
            process.wait(timeout=2)


def serve(args):
    root = args.app_dir.resolve()
    env = os.environ.copy()
    api_port = port(env.get("PORT", "8000"))
    ml_port = port(env.get("ORBITFARM_ML_PORT", "8001"))
    if api_port == ml_port:
        raise ValueError("The public API and private ML ports must be different")
    # Preserve the venv's executable path: resolving its symlink would invoke
    # the base interpreter and lose the environment's isolated site-packages.
    api_python, ml_python = (Path(value).expanduser().absolute() for value in (args.api_python, args.ml_python))
    if not api_python.is_file() or not ml_python.is_file():
        raise RuntimeError("Both isolated Python interpreters must exist")
    frontend = Path(env.get("ORBITFARM_FRONTEND_DIR", str(root / "dist"))).resolve()
    if not (frontend / "index.html").is_file():
        raise RuntimeError("The built frontend dist/index.html is missing")
    cache = Path(env.get("ORBITFARM_CACHE_DIR", str(Path(tempfile.gettempdir()) / "orbitfarm/field-sources")))
    cache.mkdir(parents=True, exist_ok=True)
    ml_url = f"http://127.0.0.1:{ml_port}"
    env.update(ORBITFARM_ML_URL=ml_url, ORBITFARM_FRONTEND_DIR=str(frontend), ORBITFARM_CACHE_DIR=str(cache.resolve()),
               PYTHONDONTWRITEBYTECODE="1", PYTHONUNBUFFERED="1")
    env.setdefault("ORBITFARM_REGIONAL_INPUT_DIR", str(root / "agronomy/regional_inputs"))
    env.setdefault("ORBITFARM_PROVINCE_INPUT_DIR", str(root / "agronomy/province_inputs"))
    for setting in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
        env.setdefault(setting, "1")
    stop = threading.Event()
    previous = {}
    for signum in (signal.SIGTERM, signal.SIGINT):
        previous[signum] = signal.signal(signum, lambda number, frame: stop.set())
    children = []
    try:
        children.append(("ML", subprocess.Popen([str(ml_python), "-m", "yield_prediction.service", "--host", "127.0.0.1",
                                                 "--port", str(ml_port)], cwd=root, env=env, start_new_session=os.name == "posix")))
        wait_ready(ml_url + "/ready", children, stop, args.startup_timeout, env.get("ORBITFARM_ML_TOKEN"))
        if stop.is_set():
            return
        children.append(("API", subprocess.Popen([str(api_python), "-m", "uvicorn", "agronomy.api:app", "--host", "0.0.0.0",
                                                  "--port", str(api_port), "--workers", "1", "--timeout-graceful-shutdown", "8"],
                                                 cwd=root, env=env, start_new_session=os.name == "posix")))
        wait_ready(f"http://127.0.0.1:{api_port}/ready", children, stop, args.startup_timeout)
        if stop.is_set():
            return
        print(f"orbitFarm container ready: public port {api_port}; 38 models on private loopback port {ml_port}.", flush=True)
        while not stop.wait(.25):
            check_children(children)
    finally:
        terminate(children)
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-dir", type=Path, default=ROOT)
    parser.add_argument("--api-python", default=os.environ.get("ORBITFARM_API_PYTHON", "/opt/api/bin/python"))
    parser.add_argument("--ml-python", default=os.environ.get("ORBITFARM_ML_PYTHON", "/opt/ml/bin/python"))
    parser.add_argument("--startup-timeout", type=float, default=120)
    args = parser.parse_args()
    if not math.isfinite(args.startup_timeout) or args.startup_timeout <= 0:
        parser.error("startup-timeout must be finite and positive")
    try:
        serve(args)
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        print(f"Container startup/runtime failure: {error}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
