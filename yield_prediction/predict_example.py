"""Load the packaged model and run a real held-out CY-Bench record."""

import argparse
import json
from math import isclose
from pathlib import Path

from yield_prediction import predict_yield

ROOT = Path(__file__).resolve().parent
CANDIDATE_EXAMPLES = {
    "cold_start_pre_season": "cold_start_candidate_example",
    "mid_season_v2": "midseason_candidate_example",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crop", choices=["maize", "wheat"], default="maize")
    parser.add_argument("--mode", choices=["pre_season", "mid_season", *CANDIDATE_EXAMPLES],
                        default="pre_season")
    args = parser.parse_args()
    candidate = CANDIDATE_EXAMPLES.get(args.mode)
    path = (ROOT / "artifacts" / "generalization" / f"{args.crop}_{candidate}.json" if candidate
            else ROOT / "artifacts" / "examples" / f"{args.crop}_{args.mode}.json")
    example = json.loads(path.read_text(encoding="utf-8"))
    result = predict_yield(example["features"], example["crop"], args.mode)
    expected = example["predicted_yield_t_ha"] if candidate else example["expected_yield_t_ha"]
    if not isclose(result["predicted_yield_t_ha"], expected, abs_tol=1e-8):
        raise RuntimeError("Prediction differs from the saved run")
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
