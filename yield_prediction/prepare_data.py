"""Prepare seasonal features by crop and country using bounded weather windows."""

import argparse
import json
from pathlib import Path

from yield_prediction.data import file_hash, prepare

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=["sample", "zenodo"], default="zenodo")
    parser.add_argument("--input", type=Path, nargs="+")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    inputs = args.input or sorted((ROOT / "data/raw" / args.source).glob("*.zip"))
    output = args.output or ROOT / "data/processed" / f"{args.source}.csv"
    table, audit = prepare(inputs)
    output.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(output, index=False)
    files = []
    for source in inputs:
        members = sorted(source.rglob("*.csv")) if source.is_dir() else [source]
        for member in members:
            name = member.relative_to(source).as_posix() if source.is_dir() else member.name
            files.append({"file": name, "sha256": file_hash(member)})
    output.with_suffix(".json").write_text(json.dumps(
        {"files": files, "groups": audit, "dataset_sha256": file_hash(output)}, indent=2
    ) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
