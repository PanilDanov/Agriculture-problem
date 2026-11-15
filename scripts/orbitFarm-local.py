"""Set up, check and run orbitFarm without changing global Python packages.

Usage: python3 scripts/orbitFarm-local.py setup|check|run
"""

import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def run(command, *, env=None):
    subprocess.run([str(item) for item in command], cwd=ROOT, env=env, check=True)


def env_python(directory):
    return Path(directory) / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def load_environment():
    values = os.environ.copy()
    path = ROOT / ".env"
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key.startswith(("ORBITFARM_", "VITE_")):
                if value[:1] in ("'", '"') and value[-1:] == value[:1]:
                    value = value[1:-1]
                values.setdefault(key, value)
    native = ROOT / ".runtime/native"
    if native.joinpath("libomp.dylib").is_file():
        values.setdefault("ORBITFARM_NATIVE_LIB_DIR", str(native))
    values.setdefault("ORBITFARM_CACHE_DIR", str(ROOT / ".cache/field-sources"))
    bundled = ROOT / "agronomy/regional_inputs"
    values.setdefault("ORBITFARM_REGIONAL_INPUT_DIR", str(bundled if (bundled / "registry.json").is_file()
                                                        else ROOT / ".runtime/regional-inputs"))
    return values


def python_version(command):
    output = subprocess.check_output([str(command), "-c", "import json,sys; print(json.dumps(list(sys.version_info[:3])))"], text=True)
    return tuple(json.loads(output))


def choose_python(explicit, *, ml):
    candidates = [explicit] if explicit else (["python3.11", sys.executable] if ml else ["python3.12", "python3.11", sys.executable])
    for candidate in candidates:
        resolved = shutil.which(candidate) if candidate else None
        if not resolved:
            continue
        try:
            version = python_version(resolved)
        except (OSError, subprocess.SubprocessError, ValueError):
            continue
        eligible = version[:2] == (3, 11) if ml else (3, 11) <= version[:2] <= (3, 12)
        if eligible:
            return resolved
    raise RuntimeError("Python 3.11 is required for ML; the field API supports Python 3.11 or 3.12. Supply --ml-python / --api-python.")


def node_environment(env):
    candidates = []
    if shutil.which("node"):
        candidates.append(Path(shutil.which("node")))
    candidates.extend(sorted(ROOT.glob(".runtime/node-v*/bin/node"), reverse=True))
    candidates.extend(sorted(ROOT.glob(".runtime/node-v*/node.exe"), reverse=True))
    for candidate in candidates:
        try:
            version = subprocess.check_output([str(candidate), "--version"], text=True).strip().lstrip("v")
            major, minor = (int(value) for value in version.split(".")[:2])
        except (OSError, ValueError, subprocess.SubprocessError):
            continue
        if major > 22 or (major == 22 and minor >= 12):
            result = dict(env)
            result["PATH"] = str(candidate.parent) + os.pathsep + env.get("PATH", "")
            return result
    raise RuntimeError("Node.js 22.12+ is required (Node 24 LTS is recommended). Install it or place its official distribution under .runtime/node-v*/.")


def ensure_env(directory, interpreter):
    python = env_python(directory)
    if not python.is_file():
        run([interpreter, "-m", "venv", directory])
    actual, expected = python_version(python), python_version(interpreter)
    if actual[:2] != expected[:2]:
        raise RuntimeError(f"{directory} uses Python {actual[0]}.{actual[1]}, expected {expected[0]}.{expected[1]}. Select another environment directory.")
    return python


def setup(args):
    env = node_environment(load_environment())
    api = ensure_env(args.api_env, choose_python(args.api_python, ml=False))
    ml = ensure_env(args.ml_env, choose_python(args.ml_python, ml=True))
    run([api, "-m", "pip", "install", "-r", ROOT / "agronomy/requirements-api.txt",
         "-r", ROOT / "agronomy/requirements-copernicus.txt"], env=env)
    run([ml, "-m", "pip", "install", str(ROOT / "yield_prediction") + "[candidates]", "pytest>=7,<10"], env=env)
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        run([ml, ROOT / "yield_prediction/install_native.py"], env=env)
    run(["npm.cmd" if os.name == "nt" else "npm", "ci", "--no-audit", "--no-fund"], env=env)
    (ROOT / ".runtime/regional-inputs").mkdir(parents=True, exist_ok=True)
    check(args)


def check(args):
    env = node_environment(load_environment())
    api, ml = env_python(args.api_env), env_python(args.ml_env)
    if not api.is_file() or not ml.is_file():
        raise RuntimeError("Local Python environments are missing. Run the setup command first.")
    run([api, "-c", "import agronomy.api, rasterio, netCDF4; print('Field API imports: ready')"], env=env)
    run([ml, "-m", "yield_prediction.service", "--check"], env=env)
    print("Local environments and all model artifacts are ready.")


def ready(url, token=None, *, timeout=50):
    until = time.monotonic() + timeout
    last = None
    while time.monotonic() < until:
        try:
            headers = {"Authorization": "Bearer " + token} if token else {}
            with urlopen(Request(url.rstrip("/") + "/ready", headers=headers), timeout=3) as response:
                result = json.load(response)
            if result.get("status") == "ready":
                return
            last = result.get("status")
        except (OSError, URLError, ValueError) as error:
            last = type(error).__name__
        time.sleep(0.3)
    raise RuntimeError(f"Service readiness did not succeed ({last}). Check the service logs.")


def serve(args):
    env = node_environment(load_environment())
    api, ml = env_python(args.api_env), env_python(args.ml_env)
    if not api.is_file() or not ml.is_file():
        raise RuntimeError("Run setup before starting the local stack.")
    if not args.no_build:
        build_env = {**env, "VITE_ORBITFARM_LIVE_API": "1", "VITE_API_BASE_URL": ""}
        run(["npm.cmd" if os.name == "nt" else "npm", "run", "build"], env=build_env)
    if not (ROOT / "dist/index.html").is_file():
        raise RuntimeError("The built website is missing. Run without --no-build.")
    host = env.get("ORBITFARM_API_HOST", "127.0.0.1")
    port = int(env.get("ORBITFARM_API_PORT", "8000"))
    ml_port = int(env.get("ORBITFARM_ML_PORT", "8001"))
    ml_url = env.get("ORBITFARM_ML_URL") or f"http://127.0.0.1:{ml_port}"
    env.update(ORBITFARM_ML_URL=ml_url, ORBITFARM_FRONTEND_DIR=str(ROOT / "dist"))
    children = []
    try:
        if not args.reuse_ml:
            if ml_url.rstrip("/") != f"http://127.0.0.1:{ml_port}":
                raise RuntimeError("An external ML URL is configured. Use --reuse-ml to connect to that running service.")
            children.append(subprocess.Popen([str(ml), "-m", "yield_prediction.service", "--host", "127.0.0.1", "--port", str(ml_port)], cwd=ROOT, env=env))
        ready(ml_url, env.get("ORBITFARM_ML_TOKEN"))
        children.append(subprocess.Popen([str(api), "-m", "uvicorn", "agronomy.api:app", "--host", host, "--port", str(port)], cwd=ROOT, env=env))
        ready(f"http://127.0.0.1:{port}")
        print(f"orbitFarm is ready at http://127.0.0.1:{port} (real field API and ML).", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
        failed = next(child.returncode for child in children if child.poll() is not None)
        if failed:
            raise RuntimeError(f"A local service exited with code {failed}.")
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("setup", "check", "run"))
    parser.add_argument("--api-env", type=Path, default=ROOT / ".venv-api")
    parser.add_argument("--ml-env", type=Path, default=ROOT / ".venv-ml")
    parser.add_argument("--api-python")
    parser.add_argument("--ml-python")
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument("--reuse-ml", action="store_true")
    args = parser.parse_args()
    try:
        {"setup": setup, "check": check, "run": serve}[args.command](args)
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
