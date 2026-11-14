"""Load the packaged model and run a real held-out CY-Bench record."""

import argparse
import json
from math import isclose
from pathlib import Path

from yield_prediction import predict_yield

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crop", choices=["maize", "wheat"], default="maize")
    parser.add_argument("--mode", choices=["pre_season", "mid_season"], default="pre_season")
    args = parser.parse_args()
    path = ROOT / "artifacts" / "examples" / f"{args.crop}_{args.mode}.json"
    example = json.loads(path.read_text(encoding="utf-8"))
    result = predict_yield(example["features"], example["crop"], example["mode"])
    if not isclose(result["predicted_yield_t_ha"], example["expected_yield_t_ha"], abs_tol=1e-8):
        raise RuntimeError("Prediction differs from the saved run")
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
