"""Prepare additional Brazilian wheat harvests using IBGE SIDRA table 1612."""

import argparse
from contextlib import ExitStack
from io import StringIO
import json
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import pandas as pd

from yield_prediction.data import GROUP_FILES, file_hash, prepare_group, read_csv
from yield_prediction.experiment import dump_json
from yield_prediction.features import KEY

LABEL_KEY = ["adm_id", "harvest_year"]


def sidra_labels(path):
    _, *records = json.loads(path.read_bytes())
    wheat = pd.DataFrame(records).loc[lambda frame: frame.D4C.eq("2716")].copy()
    if wheat.empty or not wheat[["NC", "MC", "D2C"]].eq(
        {"NC": "6", "MC": "33", "D2C": "112"}
    ).all().all():
        raise ValueError("Expected municipal wheat yields in kg/ha from SIDRA table 1612")
    values = pd.to_numeric(wheat.V, errors="coerce")
    labels = pd.DataFrame({
        "country_code": "BR",
        "adm_id": "BR" + wheat.D1C,
        "harvest_year": wheat.D3C.astype(int),
        "yield": values / 1000,
    })
    if labels.duplicated(LABEL_KEY).any() or not wheat.D1C.str.fullmatch(r"\d{7}").all():
        raise ValueError("Expected unique SIDRA municipality and year identifiers")
    valid = labels.loc[np.isfinite(labels["yield"]) & labels["yield"].ge(0)]
    return labels, valid


def prepare_wheat(archive_path, sidra_path, output, include_benchmark=False):
    all_labels, valid_labels = sidra_labels(sidra_path)
    with ExitStack() as stack:
        archive = stack.enter_context(ZipFile(archive_path))
        files = {}
        for name in archive.namelist():
            match = GROUP_FILES.fullmatch(Path(name).name)
            if match and match.groups()[1:] == ("wheat", "BR"):
                files[match[1]] = name
        if set(files) != {"yield", "crop_calendar", "meteo", "soil", "location"}:
            raise ValueError("Expected all five CY-Bench source members for wheat/BR")
        with archive.open(files["yield"]) as source:
            published = read_csv(source)[LABEL_KEY + ["yield"]]
        overlap = valid_labels.merge(published, on=LABEL_KEY, suffixes=("_sidra", "_cybench"), validate="one_to_one")
        if overlap.empty:
            raise ValueError("SIDRA and CY-Bench wheat observations have no municipality and year overlap")
        differences = (overlap.yield_sidra - overlap.yield_cybench).abs()
        first_year = int(published.harvest_year.max()) + 1
        fresh = valid_labels.loc[valid_labels.harvest_year.ge(first_year)]
        if fresh.empty:
            raise ValueError("SIDRA contains no harvests after the published CY-Bench wheat records")
        supplied = fresh
        if include_benchmark:
            benchmark = published.assign(country_code="BR")
            supplied = pd.concat([benchmark, fresh], ignore_index=True)
        csv = supplied.to_csv(index=False)

        def open_csv(kind):
            if kind == "yield":
                return stack.enter_context(StringIO(csv))
            return stack.enter_context(archive.open(files[kind]))

        data, group = prepare_group(open_csv, "wheat", "BR")

    if include_benchmark:
        data["label_source"] = np.where(data.harvest_year.ge(first_year), "IBGE SIDRA", "CY-Bench")
    output.parent.mkdir(parents=True, exist_ok=True)
    data.sort_values(KEY).to_csv(output, index=False)
    dump_json(output.with_suffix(".json"), {
        "files": [{"file": path.name, "sha256": file_hash(path)} for path in (archive_path, sidra_path)],
        "groups": [group],
        "dataset_sha256": file_hash(output),
        "sidra_table": 1612,
        "first_additional_year": first_year,
        "crosscheck": {"rows": len(overlap), "same_yield_to_0_001_t_ha": int(differences.lt(0.0005).sum()),
                       "mean_absolute_difference_t_ha": float(differences.mean())},
        "raw_rows_by_year": {int(year): int(size) for year, size in all_labels.groupby("harvest_year").size().items()},
        "valid_rows_by_year": {int(year): int(size) for year, size in valid_labels.groupby("harvest_year").size().items()},
    })
    print(f"Brazil wheat: {len(data)} labeled seasons (IBGE additions from {first_year})", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--sidra", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--include-benchmark", action="store_true",
                        help="Keep earlier benchmark seasons using the same weather pass")
    args = parser.parse_args()
    prepare_wheat(args.archive, args.sidra, args.output, include_benchmark=args.include_benchmark)


if __name__ == "__main__":
    main()
