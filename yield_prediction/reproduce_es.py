"""Recompute the original Spain maize experiment from the official sample archive."""

import argparse
import json
from pathlib import Path
from zipfile import ZipFile

import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from threadpoolctl import threadpool_limits

from yield_prediction.validation import score

ROOT = Path(__file__).resolve().parent
KEY = ["adm_id", "harvest_year"]
METEO = ["tavg", "tmax", "prec", "cwb", "rad"]
FEATURES = [
    "mean_temperature_c", "mean_max_temperature_c", "gdd_base10_c_days",
    "precipitation_mm", "water_balance_mm", "mean_radiation_mj_m2_day", "awc", "bulk_density",
]


def reproduce(path):
    with ZipFile(path) as archive:
        def read(name, **kwargs):
            member = next(n for n in archive.namelist() if Path(n).name == f"{name}_maize_ES.csv")
            with archive.open(member) as stream:
                return pd.read_csv(stream, **kwargs)

        targets = read("yield")
        calendar = read("crop_calendar")[["adm_id", "sos", "eos"]]
        soil = read("soil")[["adm_id", "awc", "bulk_density"]]
        weather = read("meteo", usecols=["adm_id", "date", *METEO])
    usable = targets.harvest_area.gt(0) & targets["yield"].ge(0)
    regions = targets.loc[usable, KEY + ["yield"]].merge(calendar, on="adm_id", validate="many_to_one")
    regions = regions.merge(soil, on="adm_id", validate="many_to_one")
    year_start = pd.to_datetime(regions.harvest_year.astype(str), format="%Y")
    season_start = year_start + pd.to_timedelta(regions.sos.astype(int) - 1, unit="D")
    season_end = year_start + pd.to_timedelta(regions.eos.astype(int) - 1, unit="D")
    length = (season_end - season_start).dt.days
    assert length.gt(0).all(), "Original Spain maize experiment uses calendar-year seasons"
    regions = regions.assign(start=season_start,
                             forecast=season_end - pd.to_timedelta(length // 2, unit="D"))
    weather["date"] = pd.to_datetime(weather.date.astype(str), format="%Y%m%d")
    records = weather.assign(harvest_year=weather.date.dt.year).merge(regions, on=KEY)
    records = records.loc[records.date.between(records.start, records.forecast)].dropna(subset=METEO)
    records = records.assign(gdd=(records.tavg - 10).clip(lower=0), rad_mj=records.rad / 1_000_000)
    summary = records.groupby(KEY).agg(
        days=("date", "size"), mean_temperature_c=("tavg", "mean"),
        mean_max_temperature_c=("tmax", "mean"), gdd_base10_c_days=("gdd", "sum"),
        precipitation_mm=("prec", "sum"), water_balance_mm=("cwb", "sum"),
        mean_radiation_mj_m2_day=("rad_mj", "mean"),
    ).reset_index()
    dataset = regions.merge(summary, on=KEY)
    dataset = dataset.loc[dataset.days.eq((dataset.forecast - dataset.start).dt.days + 1)]
    train = dataset.loc[dataset.harvest_year.lt(2018)]
    test = dataset.loc[dataset.harvest_year.ge(2018)].sort_values(["harvest_year", "adm_id"])
    model = HistGradientBoostingRegressor(
        max_iter=120, max_leaf_nodes=7, min_samples_leaf=20, learning_rate=0.05,
        l2_regularization=5.0, early_stopping=False, random_state=42,
    )
    with threadpool_limits(limits=1):
        model.fit(train[FEATURES], train["yield"])
        forecast = model.predict(test[FEATURES]).clip(min=0)
    historical = test.adm_id.map(train.groupby("adm_id")["yield"].median()).fillna(train["yield"].median())
    return {"crop": "maize", "country_code": "ES", "train_rows": len(train), "test_rows": len(test),
            "train_years": sorted(train.harvest_year.unique().tolist()),
            "test_years": sorted(test.harvest_year.unique().tolist()), "features": FEATURES,
            "model": score(test["yield"], forecast), "region_median": score(test["yield"], historical)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=ROOT / "data/raw/sample/sample-b55e691.zip")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/metrics/legacy_spain_maize.json")
    args = parser.parse_args()
    result = json.dumps(reproduce(args.archive), indent=2, allow_nan=False) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding="utf-8")
    print(result, end="")


if __name__ == "__main__":
    main()
