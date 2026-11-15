"""Season boundaries and weather aggregates in CY-Bench units."""

import numpy as np
import pandas as pd

KEY = ["crop", "country_code", "adm_id", "harvest_year"]
TARGET = "observed_yield_t_ha"
SOIL = ["awc", "bulk_density"]
GEO = ["latitude", "longitude"]
STATIC = ["season_days", *SOIL, *GEO]
WEATHER_LAG_DAYS = 14
WEATHER = ["tmin", "tmax", "tavg", "prec", "rad", "et0", "vpd", "cwb"]
SUMS = {
    "tavg": "temp_sum", "tavg_sq": "temperature_square_sum",
    "prec": "precipitation_mm", "rad_mj": "radiation_sum", "et0": "et0_mm",
    "vpd_kpa": "vpd_sum", "cwb": "water_balance_mm", "hot": "hot_days",
    "frost": "frost_days", "dry": "dry_days",
}
SEASON_STATS = [
    "temperature_c", "min_temperature_c", "max_temperature_c", "temperature_sd_c",
    "precipitation_mm", "precipitation_mm_day", "radiation_mj_m2_day", "et0_mm",
    "vpd_kpa", "water_balance_mm", "hot_days", "frost_days", "dry_days",
]
CLIMATE = [f"climate_{col}" for col in SEASON_STATS] + [
    "climate_precipitation_sd_mm", "climate_temperature_interannual_sd_c",
]
MID = [f"mid_{col}" for col in SEASON_STATS]
MODE_FEATURES = {"pre_season": [*STATIC, *CLIMATE], "mid_season": [*STATIC, *CLIMATE, *MID]}


def seasons(rows):
    rows = rows.copy()
    season_days = rows[["sos", "eos"]].apply(pd.to_numeric, errors="coerce")
    rows[["sos", "eos"]] = np.floor(season_days.where(season_days.ge(1) & season_days.le(366)))
    winter = rows["sos"].gt(rows["eos"])
    start_year = rows.harvest_year - winter.astype(int)
    rows["season_start"] = day_of_year(start_year, rows.sos)
    rows["season_end"] = day_of_year(rows.harvest_year, rows.eos)
    rows["season_days"] = (rows.season_end - rows.season_start).dt.days + 1
    rows = rows.loc[rows.season_days.between(2, 366)].copy()
    rows["midpoint"] = rows.season_start + pd.to_timedelta((rows.season_days - 1) // 2, unit="D")
    rows["pre_forecast_date"] = rows.season_start - pd.Timedelta(days=1)
    rows["mid_weather_cutoff"] = rows.midpoint - pd.Timedelta(days=WEATHER_LAG_DAYS)
    return rows


def day_of_year(year, day):
    start = pd.to_datetime(year.astype(str), format="%Y")
    # A fixed climate calendar can specify day 366 in a non-leap year.
    year_days = 365 + start.dt.is_leap_year.astype(int)
    return start + pd.to_timedelta(day.clip(upper=year_days) - 1, unit="D")


def weather_parts(chunks, windows):
    """Summarize bounded daily windows using chunk-combinable statistics."""
    lookup = windows[["adm_id", "harvest_year", "season_start", "season_end", "mid_weather_cutoff"]]
    parts = {"full": [], "mid": []}
    # Retain one bit per relevant region/date to detect duplicates across CSV chunks.
    regions = pd.Index(windows.adm_id.unique())
    first_date, last_date = windows.season_start.min(), windows.season_end.max()
    days = (last_date - first_date).days + 1
    bytes_per_region = (days + 7) // 8
    seen = np.zeros((len(regions), bytes_per_region), dtype=np.uint8)
    for daily in chunks:
        date = pd.to_datetime(daily.pop("date").astype(str), format="%Y%m%d", errors="coerce")
        daily = daily.assign(date=date)
        daily = daily.loc[daily.adm_id.isin(regions) & daily.date.between(first_date, last_date)].copy()
        region_index = regions.get_indexer(daily.adm_id)
        day_index = (daily.date - first_date).dt.days.to_numpy()
        offsets, bits = np.divmod(day_index, 8)
        masks = np.left_shift(np.uint8(1), bits.astype(np.uint8))
        if daily.duplicated(["adm_id", "date"]).any() or (seen[region_index, offsets] & masks).any():
            raise ValueError("Duplicate daily weather for a region/date")
        np.bitwise_or.at(seen, (region_index, offsets), masks)
        values = daily[WEATHER].replace([np.inf, -np.inf], np.nan)
        daily[WEATHER] = values
        # A regional daily record can belong to the current or next harvest year.
        current = daily.assign(harvest_year=daily.date.dt.year.astype(int))
        following = current.assign(harvest_year=current.harvest_year + 1)
        selected = pd.concat([current, following], ignore_index=True).merge(
            lookup, on=["adm_id", "harvest_year"], validate="many_to_one"
        )
        selected = selected.loc[selected.date.between(selected.season_start, selected.season_end)]
        selected = selected.dropna(subset=WEATHER)
        selected = selected.assign(
            tavg_sq=selected.tavg.pow(2), rad_mj=selected.rad / 1_000_000,
            vpd_kpa=selected.vpd / 10, hot=selected.tmax.ge(35), frost=selected.tmin.lt(0),
            dry=selected.prec.lt(1),
        )
        for stage, subset in (
            ("full", selected), ("mid", selected.loc[selected.date.le(selected.mid_weather_cutoff)])
        ):
            part = subset.groupby(["adm_id", "harvest_year"], observed=True).agg(
                days=("date", "size"), observed_max_date=("date", "max"),
                min_temperature_c=("tmin", "min"), max_temperature_c=("tmax", "max"),
                **{dest: (src, "sum") for src, dest in SUMS.items()},
            )
            parts[stage].append(part)

    out = {}
    for stage, stage_parts in parts.items():
        combined = pd.concat(stage_parts).groupby(level=[0, 1]).agg({
            "days": "sum", "observed_max_date": "max",
            "min_temperature_c": "min", "max_temperature_c": "max",
            **dict.fromkeys(SUMS.values(), "sum"),
        })
        n = combined.days
        combined["temperature_c"] = combined.temp_sum / n
        combined["temperature_sd_c"] = (
            (combined.temperature_square_sum / n - combined.temperature_c.pow(2)).clip(lower=0).pow(0.5)
        )
        combined["radiation_mj_m2_day"] = combined.radiation_sum / n
        combined["vpd_kpa"] = combined.vpd_sum / n
        combined["precipitation_mm_day"] = combined.precipitation_mm / n
        out[stage] = combined[["days", "observed_max_date", *SEASON_STATS]].reset_index()
    return out


def feature_table(windows, chunks):
    summaries = weather_parts(chunks, windows)
    index = ["adm_id", "harvest_year"]
    full = windows.merge(summaries["full"], on=index, how="left", validate="one_to_one")
    mid = windows.merge(summaries["mid"], on=index, how="left", validate="one_to_one")
    # All weather data stay on the same keyed frame through the completeness mask.
    mid_days = (mid.mid_weather_cutoff - mid.season_start).dt.days + 1
    mid_valid = mid.days.between(np.ceil(0.95 * mid_days), mid_days) & mid_days.ge(10)
    for col in SEASON_STATS:
        mid[f"mid_{col}"] = mid[col].where(mid_valid)
    mid["mid_weather_through"] = mid.observed_max_date.where(mid_valid)
    mid["mid_weather_coverage"] = (mid.days / mid_days.where(mid_days.gt(0))).fillna(0)
    windows = windows.join(mid.set_index(index)[[*MID, "mid_weather_through", "mid_weather_coverage"]], on=index)
    full = full.loc[full.days.between(np.ceil(0.95 * full.season_days), full.season_days)]

    complete_by_region = dict(tuple(full.groupby("adm_id", sort=False)))

    def climatology(name, region):
        complete = complete_by_region.get(name, full.iloc[:0]).sort_values("season_end")
        years = complete.harvest_year.to_numpy()
        ends = complete.season_end.to_numpy()
        observed_ends = complete.observed_max_date.to_numpy()
        values = complete[SEASON_STATS].to_numpy()
        rows = []
        for row in region.itertuples():
            # For a cross-year crop, a prior harvest must also end before the current planting.
            mask = (
                (years < row.harvest_year) & (years >= row.harvest_year - 7)
                & (ends <= np.datetime64(row.pre_forecast_date - pd.Timedelta(days=WEATHER_LAG_DAYS)))
            )
            pos = np.flatnonzero(mask)[-5:]
            if len(pos) < 2:
                rows.append([len(pos), pd.NaT, *([np.nan] * len(CLIMATE))])
                continue
            past = values[pos]
            spread = past[:, [SEASON_STATS.index("precipitation_mm"), 0]].std(axis=0, ddof=1)
            rows.append([len(pos), pd.Timestamp(observed_ends[pos].max()), *past.mean(axis=0), *spread])
        return pd.DataFrame(rows, index=region.index, columns=["climate_seasons", "climate_through", *CLIMATE])

    climate = pd.concat([climatology(name, region)
                         for name, region in windows.groupby("adm_id", sort=False)]).sort_index()
    return windows.join(climate)
