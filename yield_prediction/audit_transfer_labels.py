"""Audit public label distributions and Brazilian reporting years without weather downloads."""

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pandas as pd

from download_data import central_directory, stream_member
from yield_prediction.data import file_hash
from yield_prediction.experiment import dump_json
from yield_prediction.features import TARGET
from yield_prediction.validation import read_prepared

FILES = {"yield_wheat_BR.csv", "yield_maize_BR.csv", "yield_maize_US.csv", "yield_wheat_US.csv"}


def fetch(destination):
    if destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    names = [m for m in central_directory() if Path(m.filename).name in FILES]
    if len(names) != len(FILES):
        raise ValueError("Missing CY-Bench label members")
    temporary = destination.with_suffix(".tmp")
    with ZipFile(temporary, "w", ZIP_DEFLATED) as archive:
        for member in names:
            stream_member(member, archive)
    temporary.replace(destination)


def describe(series):
    return {"n": len(series), "p01_t_ha": series.quantile(.01), "median_t_ha": series.median(),
            "p99_t_ha": series.quantile(.99), "max_t_ha": series.max()}


def sidra_rows(path):
    source = pd.DataFrame(json.loads(path.read_text(encoding="utf-8-sig"))[1:])
    if (source.empty or not source[["NC", "MC", "D2C"]].eq(
            {"NC": "6", "MC": "33", "D2C": "112"}).all().all()
            or not source.D1C.str.fullmatch(r"\d{7}").all()):
        raise ValueError("Expected SIDRA municipal yield observations measured in kg/ha")
    values = pd.to_numeric(source.V.str.replace(",", ".", regex=False), errors="coerce") / 1000
    return pd.DataFrame({"adm_id": "BR" + source.D1C, "year": source.D3C.astype(int),
                         "product": source.D4C, "sidra_t_ha": values}).dropna(subset=["sidra_t_ha"])


def audit(archive, training, ibge):
    sources = []
    with ZipFile(archive) as release:
        for name in release.namelist():
            _, crop, country = Path(name).stem.split("_")
            with release.open(name) as file:
                fields = pd.read_csv(file, dtype={"adm_id": str})
            source = fields.loc[fields.harvest_year.ge(2021) & fields["yield"].notna(),
                                ["adm_id", "harvest_year", "yield"]].copy()
            source = source.drop_duplicates()
            raw_rows = len(source)
            source = source.loc[~source.duplicated(["adm_id", "harvest_year"], keep=False)]
            surveys = {"crop": crop, "country": country, "valid_unique_label_rows": len(source),
                       "ambiguous_rows": raw_rows - len(source), "labels": describe(source["yield"]),
                       "train_2003_2019": describe(training.loc[
                           training.crop.eq(crop) & training.climate_seasons.ge(2) &
                           training.harvest_year.between(2003, 2019), TARGET])}
            if country == "BR":
                product = {"maize": "2711", "wheat": "2716"}[crop]
                reference = ibge.loc[ibge["product"].eq(product)].drop_duplicates()
                for shift in (0, -1):
                    pairs = source.assign(year=source.harvest_year + shift).merge(
                        reference, on=["adm_id", "year"], validate="one_to_one")
                    close = pairs["yield"].sub(pairs.sidra_t_ha).abs().le(.00100001)
                    surveys[f"sidra_year_shift_{shift}"] = {"matched": len(pairs), "within_0_001_t_ha": int(close.sum()),
                        "by_harvest_year": pairs.assign(close=close).groupby("harvest_year").close.agg(
                            matched="size", within_0_001_t_ha="sum").reset_index().to_dict("records")}
            sources.append(surveys)
    return sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--sidra", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    fetch(args.labels)
    result = audit(args.labels, read_prepared(args.reference), sidra_rows(args.sidra))
    dump_json(args.output, {"inputs": {p.name: file_hash(p) for p in (args.labels, args.reference, args.sidra)},
                            "distributions": result})


if __name__ == "__main__":
    main()
