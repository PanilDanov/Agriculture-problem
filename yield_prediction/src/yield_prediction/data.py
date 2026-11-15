"""Read official CY-Bench ZIPs or the equivalent unpacked layout."""

from contextlib import ExitStack
from hashlib import sha256
from pathlib import Path
import re
from zipfile import ZipFile

import numpy as np
import pandas as pd

from .features import GEO, KEY, SOIL, TARGET, WEATHER, feature_table, seasons

GROUP_FILES = re.compile(r"(yield|crop_calendar|meteo|soil|location)_(maize|wheat)_([A-Z]{2})\.csv")
# CY-Bench v1.10 files for BR use the ISO alpha-3 code in their yield tables.
LABEL_COUNTRY_CODES = {"BR": ("BR", "BRA")}


def read_csv(path, **kwargs):
    return pd.read_csv(path, dtype={"adm_id": str}, **kwargs)


def distinct_metadata(frame, columns):
    frame = frame[["adm_id", *columns]].dropna(subset=["adm_id"]).drop_duplicates()
    # Conflicting administrative metadata have no unambiguous temporal alignment.
    return frame.loc[~frame.adm_id.duplicated(keep=False)]


def prepare_group(open_csv, crop, country):
    def load(kind, **kwargs):
        return read_csv(open_csv(kind), **kwargs)

    raw = load("yield")
    calendar = distinct_metadata(load("crop_calendar"), ["sos", "eos"])
    soil = distinct_metadata(load("soil"), SOIL)
    location = distinct_metadata(load("location"), GEO)
    calendar = calendar.merge(soil, how="left", on="adm_id").merge(location, how="left", on="adm_id")
    country_codes = LABEL_COUNTRY_CODES.get(country, (country,))
    labels = raw.loc[raw.country_code.isin(country_codes), ["adm_id", "harvest_year", "yield"]].copy()
    years = pd.to_numeric(labels.harvest_year, errors="coerce")
    values = pd.to_numeric(labels["yield"], errors="coerce")
    valid = years.between(1900, 2100) & years.mod(1).eq(0) & np.isfinite(values) & values.ge(0)
    if "harvest_area" in raw:
        area = pd.to_numeric(raw.harvest_area, errors="coerce").reindex(labels.index)
        valid &= area.isna() | area.gt(0)
    labels = labels.loc[valid].dropna(subset=["adm_id"]).rename(columns={"yield": TARGET})
    labels["harvest_year"] = years.loc[labels.index].astype(int)
    labels[TARGET] = values.loc[labels.index]
    labels = labels.drop_duplicates()
    duplicate = labels.duplicated(["adm_id", "harvest_year"], keep=False)
    labels = labels.loc[~duplicate]

    # Build seasons independently of the availability of a yield label in any year.
    grid = calendar.merge(pd.DataFrame({"harvest_year": range(
        max(1990, labels.harvest_year.min() - 7), labels.harvest_year.max() + 1
    )}), how="cross")
    windows = seasons(grid)
    if windows.empty:
        raise ValueError(f"Missing valid calendar for {crop}/{country}")
    with load("meteo", chunksize=100_000, usecols=["adm_id", "date", *WEATHER]) as daily:
        features = feature_table(windows, daily)
    result = features.merge(labels, on=["adm_id", "harvest_year"], validate="one_to_one")
    result = result.assign(crop=crop, country_code=country)
    audit = {
        "crop": crop, "country_code": country, "source_rows": len(raw),
        "invalid_or_duplicate_rows": len(raw) - len(labels),
        "missing_or_invalid_calendar": len(labels) - len(result),
        "insufficient_climate_history": int(result.climate_seasons.lt(2).sum()),
        "insufficient_mid_weather": int(result.mid_weather_through.isna().sum()),
        "rows": len(result), "first_year": int(result.harvest_year.min()) if len(result) else None,
        "last_year": int(result.harvest_year.max()) if len(result) else None,
        "yield_above_paper_range": int(result[TARGET].gt({"maize": 14, "wheat": 9}[crop]).sum()),
    }
    return result, audit


def file_hash(path):
    with open(path, "rb") as stream:
        return sha256_chunks(iter(lambda: stream.read(1024**2), b""))


def sha256_chunks(chunks):
    digest = sha256()
    for chunk in chunks:
        digest.update(chunk)
    return digest.hexdigest()


def prepare(sources):
    groups = {}
    with ExitStack() as stack:
        for source in map(Path, sources):
            if source.is_dir():
                files = [(path.name, path) for path in source.rglob("*.csv")]
                archive = None
            else:
                archive = stack.enter_context(ZipFile(source))
                files = [(Path(name).name, name) for name in archive.namelist()]
            for name, path in files:
                match = GROUP_FILES.fullmatch(name)
                if not match:
                    continue
                kind, crop, country = match.groups()
                group = groups.setdefault((crop, country), {})
                if kind in group:
                    raise ValueError(f"Duplicate source for {crop}/{country}/{kind}")
                group[kind] = (archive, path)

        data, audits = [], []
        for (crop, country), group in sorted(groups.items()):
            required = {"yield", "crop_calendar", "meteo", "soil", "location"}
            if required - group.keys():
                raise ValueError(f"Missing {sorted(required - group.keys())} for {crop}/{country}")
            with ExitStack() as streams:
                def open_csv(kind):
                    archive, path = group[kind]
                    return path if archive is None else streams.enter_context(archive.open(path))

                table, audit = prepare_group(open_csv, crop, country)
            data.append(table)
            audits.append(audit)
            print(f"{crop}/{country}: {len(table)} labeled seasons", flush=True)
    if not data:
        raise ValueError("No matching crop and country files")
    return pd.concat(data, ignore_index=True).sort_values(KEY).reset_index(drop=True), audits
