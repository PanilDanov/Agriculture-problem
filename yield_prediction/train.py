"""Run chronological tuning, model selection and frozen test evaluation."""

import argparse
import json
from pathlib import Path

from threadpoolctl import threadpool_limits

from yield_prediction.data import file_hash
from yield_prediction.experiment import FAMILIES, run
from yield_prediction.features import MODE_FEATURES
from yield_prediction.validation import read_prepared

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=ROOT / "data/processed/zenodo.csv")
    parser.add_argument("--config", type=Path, default=ROOT / "configs/temporal.json")
    parser.add_argument("--mode", choices=MODE_FEATURES, nargs="+", default=list(MODE_FEATURES))
    parser.add_argument("--crop", choices=["maize", "wheat"], nargs="+", default=["maize", "wheat"])
    parser.add_argument("--family", choices=FAMILIES, nargs="+", default=FAMILIES)
    parser.add_argument("--trials", type=int)
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts")
    parser.add_argument("--models", type=Path, default=ROOT / "src/yield_prediction/models")
    parser.add_argument("--skip-diagnostics", action="store_true")
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    trials = config["tuning_trials_per_family"] if args.trials is None else args.trials
    data = read_prepared(args.dataset)
    source = json.loads(args.dataset.with_suffix(".json").read_text(encoding="utf-8"))
    if source["dataset_sha256"] != file_hash(args.dataset):
        raise ValueError("Prepared data differs from its manifest. Rerun preparation.")
    data_info = {"dataset": args.dataset.name, "dataset_sha256": source["dataset_sha256"],
                 "source_files": len(source["files"]), "total_labeled_rows": len(data)}
    with threadpool_limits(limits=2):
        for mode in args.mode:
            for crop in args.crop:
                run(data, mode, crop, config, args.family, trials, args.output, args.models, data_info,
                    diagnostics=not args.skip_diagnostics)


if __name__ == "__main__":
    main()
