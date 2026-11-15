"""Regressions for season keys, record order and cross-chunk duplication."""

from io import StringIO

import pandas as pd
import pytest

from yield_prediction.data import prepare_group
from yield_prediction.features import MID, WEATHER, feature_table, seasons


def observations(regions, start, end):
    records = []
    for region, value in regions.items():
        for day in pd.date_range(start, end):
            record = dict(zip(WEATHER, [value - 2, value + 3, value, 2, 18_000_000, 3, 14, -1]))
            records.append({"adm_id": region, "date": day.strftime("%Y%m%d"), **record})
    return pd.DataFrame(records)


def test_keyed_midseason_survives_gap_permutation_and_cross_year():
    windows = seasons(pd.DataFrame({
        "adm_id": ["A", "BROKEN", "B", "A", "C"],
        "harvest_year": [2020, 2020, 2020, 2021, 2021],
        "sos": [300, None, 35, 300, 35], "eos": [100, 100, 140, 100, 140],
    }, index=[8, 16, 4, 23, 100]))
    daily = observations({"A": 10, "B": 24}, "2019-01-01", "2021-12-31")
    dates = pd.to_datetime(daily.date)
    daily.loc[daily.adm_id.eq("A") & dates.ge("2020-10-01"), ["tavg", "tmin", "tmax"]] = 18
    original = feature_table(windows, [daily.copy()]).set_index(["adm_id", "harvest_year"]).sort_index()
    shuffled = daily.sample(frac=1, random_state=8)
    changed = feature_table(windows.iloc[::-1], [shuffled.iloc[:900].copy(), shuffled.iloc[900:].copy()]
                            ).set_index(["adm_id", "harvest_year"]).sort_index()
    pd.testing.assert_frame_equal(original, changed, check_exact=False)
    assert original.mid_temperature_c.dropna().to_dict() == {("A", 2020): 10, ("A", 2021): 18, ("B", 2020): 24}
    assert original.loc[("C", 2021), MID].isna().all()
    assert original.loc[("A", 2020), "mid_weather_through"] == original.loc[("A", 2020), "mid_weather_cutoff"]
    # Altering weather after a particular issue's cutoff cannot change that issue.
    later = daily.adm_id.eq("B") & dates.gt(original.loc[("B", 2020), "mid_weather_cutoff"])
    dirty = feature_table(windows, [daily.assign(tavg=daily.tavg.where(~later, 60))])
    assert dirty.loc[4, "mid_temperature_c"] == 24


def test_weather_duplicates_across_chunks_fail_closed():
    calendar = seasons(pd.DataFrame({"adm_id": ["A"], "harvest_year": [2020], "sos": [1], "eos": [100]}))
    daily = observations({"A": 10}, "2020-01-01", "2020-04-10")
    with pytest.raises(ValueError, match="Duplicate daily weather"):
        feature_table(calendar, [daily.copy(), daily.iloc[:1].copy()])


def test_preparation_isolates_countries_with_the_same_raw_region_key():
    def country(code, temp, target):
        raw = {
            "yield": f"adm_id,country_code,harvest_year,yield\nA,{code},2020,{target}\nA,OTHER,2020,999",
            "crop_calendar": "adm_id,sos,eos\nA,15,135",
            "soil": "adm_id,awc,bulk_density\nA,13,1.3",
            "location": "adm_id,latitude,longitude\nA,40,5",
            "meteo": observations({"A": temp}, "2017-01-01", "2020-08-01").to_csv(index=False),
        }
        return prepare_group(lambda kind: StringIO(raw[kind]), "maize", code)[0].iloc[0]

    a, b = country("ES", 12, 4), country("FR", 23, 7)
    assert (a.country_code, a.observed_yield_t_ha, a.mid_temperature_c) == ("ES", 4, 12)
    assert (b.country_code, b.observed_yield_t_ha, b.mid_temperature_c) == ("FR", 7, 23)


def test_cold_folds_exclude_countries_for_both_crops_and_future_labels():
    from yield_prediction.generalization import cold_candidates, group_splits, temporal_upper_bound
    from yield_prediction.models import columns_for

    frame = pd.DataFrame([
        {"crop": crop, "country_code": country, "harvest_year": year, "climate_seasons": 3,
         "pre_forecast_date": pd.Timestamp(year=year, month=4, day=1)}
        for crop in ("maize", "wheat") for country in ("DE", "ES", "FR", "NL") for year in (2015, 2017, 2018, 2020)
    ])
    test = frame.loc[frame.harvest_year.ge(2018)]
    for train, held, meta in group_splits(frame, test, 2, "pre_season"):
        assert set(train.country_code).isdisjoint(held.country_code)
        assert train.harvest_year.max() <= temporal_upper_bound(held.pre_forecast_date.min(), 2018) == 2016
        assert meta["fit_max_year"] == 2016
    for candidate in cold_candidates():
        assert not {"adm_id", "country_code", "regional_median_t_ha"}.intersection(
            columns_for(candidate, "pre_season"))
