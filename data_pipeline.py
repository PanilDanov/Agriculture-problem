# Install dependencies: python -m pip install "pandas>=2.2,<4" "numpy>=1.26,<3" "requests>=2.32,<3" "rasterio>=1.4,<2"

import calendar
import hashlib
import json
import math
import time
import warnings
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from rasterio.errors import RasterioIOError
from rasterio.io import MemoryFile
from rasterio.warp import transform as transform_coordinates
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Example coordinates: an agricultural area in Iowa, USA.
LATITUDE = 39.04
LONGITUDE = -93.04

END_YEAR = None                 # None -> previous calendar year
NUMBER_OF_YEARS = 10
COLD_THRESHOLD_C = 0.0
HOT_THRESHOLD_C = 35.0
SOIL_DEPTHS = ("0-5cm", "5-15cm", "15-30cm")  # Combined depth: 0-30 cm
MIN_MEAN_COVERAGE = 1.0         # May be reduced for mean values only
REQUIRE_ALL_VALUES = False     # True -> do not export a CSV with missing values

OUTPUT_DIR = Path("data")
CACHE_DIR = Path(".data_pipeline_cache")
USE_CACHE = True
CACHE_TTL_DAYS = 7              # USE_CACHE=False forces a data refresh


POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
SOIL_WCS_URL = "https://maps.isric.org/mapserv"
SOIL_NATIVE_CRS = "+proj=igh +datum=WGS84 +units=m +no_defs"
SOIL_WCS_CRS = "http://www.opengis.net/def/crs/EPSG/0/152160"
POWER_PARAMETERS = (
    "RH2M", "T2M", "T2M_MIN", "T2M_MAX", "PRECTOTCORR",
    "SFMC", "RZMC", "ALLSKY_SFC_SW_DWN",
)
OUTPUT_COLUMNS = [
    "average_air_humidity_pct", "average_air_temperature_c",
    "min_air_temperature_c", "max_air_temperature_c", "precipitation_mm", "soil_ph",
    "surface_moisture_m3_m3", "soil_type", "root_zone_humidity_m3_m3",
    "solar_radiation_mj_m2_day", "soil_organic_carbon_g_kg",
    "extreme_temperature_days",
]
DEPTH_THICKNESS_CM = {
    "0-5cm": 5, "5-15cm": 10, "15-30cm": 15,
    "30-60cm": 30, "60-100cm": 40, "100-200cm": 100,
}


def validate_settings(latitude, longitude, end_year, number_of_years,
                      cold_threshold, hot_threshold, soil_depths, min_coverage):
    for name, value, lower, upper in (
        ("latitude", latitude, -90, 90), ("longitude", longitude, -180, 180)
    ):
        if isinstance(value, bool) or not math.isfinite(float(value)):
            raise ValueError(f"{name}: a finite number is required.")
        if not lower <= float(value) <= upper:
            raise ValueError(f"{name}: the allowed range is [{lower}, {upper}].")
    if isinstance(number_of_years, bool) or not isinstance(number_of_years, int):
        raise ValueError("number_of_years must be an integer.")
    if number_of_years < 1:
        raise ValueError("number_of_years must be positive.")
    if end_year is None:
        end_year = date.today().year - 1
    if isinstance(end_year, bool) or not isinstance(end_year, int):
        raise ValueError("end_year must be an integer or None.")
    start_year = end_year - number_of_years + 1
    if start_year < 1984 or end_year >= date.today().year:
        raise ValueError("Use completed past years starting from 1984 (POWER radiation coverage).")
    if not (math.isfinite(cold_threshold) and math.isfinite(hot_threshold)
            and cold_threshold < hot_threshold):
        raise ValueError("Thresholds must be finite, with cold_threshold < hot_threshold.")
    if not soil_depths or len(set(soil_depths)) != len(soil_depths):
        raise ValueError("Choose nonrepeating SoilGrids depth intervals.")
    if any(depth not in DEPTH_THICKNESS_CM for depth in soil_depths):
        raise ValueError(f"Allowed depths: {tuple(DEPTH_THICKNESS_CM)}")
    if not 0 < min_coverage <= 1:
        raise ValueError("min_coverage must be in the range (0, 1].")
    return list(range(start_year, end_year + 1))


def make_session():
    session = requests.Session()
    retries = Retry(
        total=3, backoff_factor=1, status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}), respect_retry_after_header=True,
    )
    session.mount("https://", HTTPAdapter(max_retries=retries))
    session.headers["User-Agent"] = "Agriculture-data-pipeline/1.0"
    return session


def fetch_bytes(session, url, params, cache_dir, use_cache=True, ttl_days=7):
    prepared_url = requests.Request("GET", url, params=params).prepare().url
    key = hashlib.sha256(prepared_url.encode("utf-8")).hexdigest()
    cache_file = Path(cache_dir) / f"{key}.bin"
    fresh = (cache_file.exists()
             and time.time() - cache_file.stat().st_mtime < ttl_days * 86400)
    if use_cache and fresh:
        return cache_file.read_bytes()
    try:
        response = session.get(url, params=params, timeout=(15, 90))
        response.raise_for_status()
    except requests.RequestException as exc:
        detail = exc.response.text[:500] if exc.response is not None else str(exc)
        raise RuntimeError(f"Request failed for {url}: {detail}") from exc
    content = response.content
    # Do not cache WCS XML errors, even when the server returns HTTP 200.
    if url == SOIL_WCS_URL and content[:4] not in (b"II*\x00", b"MM\x00*"):
        raise RuntimeError(f"SoilGrids WCS did not return a GeoTIFF: {response.text[:500]}")
    if url == POWER_URL:
        try:
            payload = response.json()
            if not isinstance(payload.get("properties", {}).get("parameter"), dict):
                raise ValueError(str(payload.get("messages", payload))[:500])
        except (ValueError, AttributeError) as exc:
            raise RuntimeError(f"Invalid NASA POWER response: {exc}") from exc
    if use_cache:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_bytes(content)
    return content


def normalize_unit(unit):
    return str(unit).lower().replace(" ", "").replace("³", "3").replace("²", "2")


def parse_power_daily(payload, start_date, end_date, requested_parameters=POWER_PARAMETERS):
    try:
        parameters = payload["properties"]["parameter"]
        parameter_metadata = payload["parameters"]
    except (KeyError, TypeError) as exc:
        raise ValueError("The POWER response is missing parameter data or metadata.") from exc
    missing = set(requested_parameters) - set(parameters)
    if missing:
        raise ValueError(f"POWER did not return the following parameters: {sorted(missing)}")
    expected_units = {
        "RH2M": {"%"}, "T2M": {"c", "°c"},
        "T2M_MIN": {"c", "°c"}, "T2M_MAX": {"c", "°c"},
        "PRECTOTCORR": {"mm/day"},
        "SFMC": {"m3m-3", "m3/m3", "m^3/m^3"},
        "RZMC": {"m3m-3", "m3/m3", "m^3/m^3"},
        "ALLSKY_SFC_SW_DWN": {"mj/m^2/day", "mj/m2/day"},
        "WS2M": {"m/s"},
        "PS": {"kpa"},
        "T2MDEW": {"c", "°c"},
    }
    for parameter in requested_parameters:
        unit = parameter_metadata.get(parameter, {}).get("units")
        if normalize_unit(unit) not in expected_units[parameter]:
            raise ValueError(f"Unexpected units for {parameter}: {unit!r}.")
    frame = pd.DataFrame({p: parameters[p] for p in requested_parameters})
    frame.index = pd.to_datetime(frame.index, format="%Y%m%d", errors="raise")
    if frame.index.has_duplicates:
        raise ValueError("POWER returned duplicate dates.")
    frame = frame.apply(pd.to_numeric, errors="coerce")
    fill_value = payload.get("header", {}).get("fill_value", -999)
    frame = frame.replace([fill_value, -999, np.inf, -np.inf], np.nan)
    calendar_index = pd.date_range(start_date, end_date, name="date")
    frame = frame.reindex(calendar_index)
    limits = {
        "RH2M": (0, 100), "SFMC": (0, 1), "RZMC": (0, 1),
        "PRECTOTCORR": (0, np.inf), "ALLSKY_SFC_SW_DWN": (0, np.inf),
        "WS2M": (0, np.inf), "PS": (0, np.inf),
    }
    for parameter, (lower, upper) in limits.items():
        if parameter not in frame:
            continue
        invalid = frame[parameter].notna() & ~frame[parameter].between(lower, upper)
        if invalid.any():
            warnings.warn(f"{start_date}: {parameter}, out-of-range values on {int(invalid.sum())} days.")
            frame.loc[invalid, parameter] = np.nan
    if {"T2M_MIN", "T2M_MAX"} <= set(frame.columns):
        invalid = frame["T2M_MIN"] > frame["T2M_MAX"]
        if invalid.any():
            warnings.warn(f"{start_date}: Tmin > Tmax; excluded {int(invalid.sum())} days.")
            frame.loc[invalid, ["T2M_MIN", "T2M_MAX"]] = np.nan
    return frame


def parse_power_year(payload, year):
    return parse_power_daily(payload, date(year, 1, 1), date(year, 12, 31))


def fetch_power_daily(session, latitude, longitude, years, cache_dir,
                      use_cache=True, ttl_days=7):
    frames, provenance = [], []
    for year in years:
        print(f"NASA POWER: {year}")
        params = {
            "parameters": ",".join(POWER_PARAMETERS), "community": "AG",
            "latitude": latitude, "longitude": longitude,
            "start": f"{year}0101", "end": f"{year}1231", "format": "JSON",
            "time-standard": "LST",
        }
        payload = json.loads(fetch_bytes(
            session, POWER_URL, params, cache_dir, use_cache, ttl_days,
        ))
        frames.append(parse_power_year(payload, year))
        provenance.append({
            "year": year, "header": payload.get("header"),
            "parameters": payload.get("parameters"),
            "geometry": payload.get("geometry"), "messages": payload.get("messages"),
        })
    daily = pd.concat(frames).sort_index()
    if daily[list(("RH2M", "T2M", "T2M_MIN", "T2M_MAX", "PRECTOTCORR"))].isna().all().all():
        raise ValueError("No weather data are available for this location. Check the coordinates and land coverage.")
    return daily, provenance


def usda_texture(sand, silt, clay):
    fractions = np.array([sand, silt, clay], dtype=float)
    if not np.isfinite(fractions).all() or (fractions < 0).any() or fractions.sum() <= 0:
        raise ValueError("Invalid sand, silt, or clay fractions.")
    sand, silt, clay = fractions / fractions.sum() * 100
    if silt + 1.5 * clay < 15:
        return "sand"
    elif silt + 2 * clay < 30:
        return "loamy sand"
    elif ((7 <= clay < 20 and sand > 52 and silt + 2 * clay >= 30)
            or (clay < 7 and silt < 50 and silt + 2 * clay >= 30)):
        return "sandy loam"
    elif 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52:
        return "loam"
    elif (50 <= silt < 80 and clay < 12) or (silt >= 50 and 12 <= clay < 27):
        return "silt loam"
    elif silt >= 80 and clay < 12:
        return "silt"
    elif 20 <= clay < 35 and silt < 28 and sand > 45:
        return "sandy clay loam"
    elif 27 <= clay < 40 and 20 < sand <= 45:
        return "clay loam"
    elif 27 <= clay < 40 and sand <= 20:
        return "silty clay loam"
    elif clay >= 35 and sand > 45:
        return "sandy clay"
    elif clay >= 40 and silt >= 40:
        return "silty clay"
    elif clay >= 40 and sand <= 45 and silt < 40:
        return "clay"
    raise ValueError(f"Unable to determine the USDA texture class: {sand=}, {silt=}, {clay=}.")


def fetch_soil_pixel(session, property_name, depth, x, y, cache_dir,
                     use_cache=True, ttl_days=7):
    params = [
        ("map", f"/map/{property_name}.map"), ("SERVICE", "WCS"),
        ("VERSION", "2.0.1"), ("REQUEST", "GetCoverage"),
        ("COVERAGEID", f"{property_name}_{depth}_mean"), ("FORMAT", "image/tiff"),
        ("SUBSET", f"X({x - 500:.6f},{x + 500:.6f})"),
        ("SUBSET", f"Y({y - 500:.6f},{y + 500:.6f})"),
        ("SUBSETTINGCRS", SOIL_WCS_CRS), ("OUTPUTCRS", SOIL_WCS_CRS),
    ]
    content = fetch_bytes(session, SOIL_WCS_URL, params, cache_dir, use_cache, ttl_days)
    return sample_soil_pixel(content, property_name, depth, x, y)


def sample_soil_pixel(content, property_name, depth, x, y):
    try:
        with MemoryFile(content) as memory_file:
            with memory_file.open() as raster:
                if raster.crs is None:
                    raise ValueError("WCS returned a raster without a coordinate reference system.")
                # Transform the point into the CRS of the returned GeoTIFF.
                sample_x, sample_y = transform_coordinates(
                    SOIL_NATIVE_CRS, raster.crs, [x], [y],
                )
                row, col = raster.index(sample_x[0], sample_y[0])
                if not (0 <= row < raster.height and 0 <= col < raster.width):
                    raise ValueError("The point is outside the returned SoilGrids subset.")
                value = raster.read(1, masked=True)[row, col]
                if np.ma.is_masked(value) or not np.isfinite(value) or value < 0:
                    raise ValueError(f"No SoilGrids {property_name} ({depth}) data are available at this point.")
                return float(value)
    except RasterioIOError as exc:
        raise RuntimeError(f"Unable to read the SoilGrids {property_name} GeoTIFF.") from exc


def fetch_soil(session, latitude, longitude, soil_depths, cache_dir,
               use_cache=True, ttl_days=7):
    x_values, y_values = transform_coordinates(
        "EPSG:4326", SOIL_NATIVE_CRS, [longitude], [latitude],
    )
    x, y = x_values[0], y_values[0]
    if not (math.isfinite(x) and math.isfinite(y)):
        raise ValueError("The coordinates cannot be transformed into the SoilGrids projection.")
    weighted, raw = {}, {}
    weights = [DEPTH_THICKNESS_CM[depth] for depth in soil_depths]
    for property_name in ("phh2o", "soc", "sand", "silt", "clay"):
        values = []
        raw[property_name] = {}
        for depth in soil_depths:
            print(f"SoilGrids: {property_name}, {depth}")
            value = fetch_soil_pixel(
                session, property_name, depth, x, y, cache_dir, use_cache, ttl_days,
            )
            raw[property_name][depth] = value
            values.append(value / 10.0)  # pH, SOC in g/kg, or fractions in percent
        weighted[property_name] = float(np.average(values, weights=weights))
    if not 0 <= weighted["phh2o"] <= 14 or weighted["soc"] > 1000:
        raise ValueError("SoilGrids pH/SOC values are outside the expected range.")
    if any(weighted[p] > 100 for p in ("sand", "silt", "clay")):
        raise ValueError("A SoilGrids particle-size fraction exceeds 100%.")
    soil = {
        "soil_ph": weighted["phh2o"],
        "soil_type": usda_texture(weighted["sand"], weighted["silt"], weighted["clay"]),
        "soil_organic_carbon_g_kg": weighted["soc"],
    }
    provenance = {
        "source": "ISRIC SoilGrids 2.0, WCS, mean predictions",
        "static_for_all_years": True, "depths": list(soil_depths),
        "depth_weights_cm": weights, "raw_values": raw,
        "conversion_divisors": {p: 10 for p in raw},
        "weighted_values": weighted,
        "soil_type_method": "USDA texture class from normalized sand/silt/clay fractions",
    }
    return soil, provenance


def aggregate_annual(daily, years, soil, cold_threshold=0.0, hot_threshold=35.0,
                     min_mean_coverage=1.0):
    rows, coverage_rows = [], []
    means = {
        "average_air_humidity_pct": "RH2M",
        "average_air_temperature_c": "T2M",
        "surface_moisture_m3_m3": "SFMC",
        "root_zone_humidity_m3_m3": "RZMC",
        "solar_radiation_mj_m2_day": "ALLSKY_SFC_SW_DWN",
    }
    for year in years:
        expected = 366 if calendar.isleap(year) else 365
        calendar_index = pd.date_range(f"{year}-01-01", f"{year}-12-31")
        group = daily.reindex(calendar_index)
        counts = group[list(POWER_PARAMETERS)].count()
        for parameter in POWER_PARAMETERS:
            coverage_rows.append({
                "year": year, "parameter": parameter,
                "valid_days": int(counts[parameter]), "expected_days": expected,
                "coverage_fraction": float(counts[parameter] / expected),
            })
        row = {"year": year, **soil}
        for output, parameter in means.items():
            enough = counts[parameter] > 0 and counts[parameter] / expected >= min_mean_coverage
            row[output] = float(group[parameter].mean()) if enough else np.nan
        for output, parameter, operation in (
            ("min_air_temperature_c", "T2M_MIN", "min"),
            ("max_air_temperature_c", "T2M_MAX", "max"),
            ("precipitation_mm", "PRECTOTCORR", "sum"),
        ):
            row[output] = (float(getattr(group[parameter], operation)())
                           if counts[parameter] == expected else np.nan)
        valid_extrema = group[["T2M_MIN", "T2M_MAX"]].notna().all(axis=1)
        extreme = ((group["T2M_MIN"] < cold_threshold)
                   | (group["T2M_MAX"] > hot_threshold))
        row["extreme_temperature_days"] = (
            int(extreme.sum()) if valid_extrema.all() else pd.NA
        )
        coverage_rows.append({
            "year": year, "parameter": "extreme_temperature_days",
            "valid_days": int(valid_extrema.sum()), "expected_days": expected,
            "coverage_fraction": float(valid_extrema.sum() / expected),
        })
        rows.append(row)
    annual = pd.DataFrame(rows).set_index("year")[OUTPUT_COLUMNS]
    coverage = pd.DataFrame(coverage_rows)
    return annual, coverage


def run_pipeline(latitude, longitude, *, end_year=None, number_of_years=10,
                 cold_threshold=0.0, hot_threshold=35.0,
                 soil_depths=("0-5cm", "5-15cm", "15-30cm"),
                 min_mean_coverage=1.0, require_all_values=False,
                 output_dir=Path("data"), cache_dir=Path(".data_pipeline_cache"),
                 use_cache=True, cache_ttl_days=7):
    years = validate_settings(
        latitude, longitude, end_year, number_of_years, cold_threshold,
        hot_threshold, soil_depths, min_mean_coverage,
    )
    latitude, longitude = float(latitude), float(longitude)
    with make_session() as session:
        daily, power_metadata = fetch_power_daily(
            session, latitude, longitude, years, cache_dir, use_cache, cache_ttl_days,
        )
        soil, soil_metadata = fetch_soil(
            session, latitude, longitude, soil_depths, cache_dir, use_cache, cache_ttl_days,
        )
    annual, coverage = aggregate_annual(
        daily, years, soil, cold_threshold, hot_threshold, min_mean_coverage,
    )
    missing = {column: int(count) for column, count in annual.isna().sum().items() if count}
    if missing:
        message = f"Insufficient source data; missing values by column: {missing}."
        if require_all_values:
            raise ValueError(message + " The CSV was not saved because REQUIRE_ALL_VALUES=True.")
        warnings.warn(message + " Missing values will be written as NA; see coverage.csv.")
    metadata = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "latitude": latitude, "longitude": longitude, "years": years,
        "cold_threshold_c": cold_threshold, "hot_threshold_c": hot_threshold,
        "extreme_day_rule": "T2M_MIN < cold_threshold_c OR T2M_MAX > hot_threshold_c",
        "min_mean_coverage": min_mean_coverage,
        "missing_values": missing, "csv_missing_marker": "NA",
        "power_endpoint": POWER_URL, "power_community": "AG", "time_standard": "LST",
        "power": power_metadata, "soil_wcs_endpoint": SOIL_WCS_URL, "soil": soil_metadata,
        "cache_enabled": use_cache, "cache_ttl_days": cache_ttl_days,
        "columns": OUTPUT_COLUMNS,
    }
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    # Use the full float representation to distinguish nearby coordinates in filenames.
    stem = f"farm_data_lat{latitude}_lon{longitude}_{years[0]}_{years[-1]}"
    csv_path = output_dir / f"{stem}.csv"
    coverage_path = output_dir / f"{stem}.coverage.csv"
    metadata_path = output_dir / f"{stem}.metadata.json"
    annual.to_csv(csv_path, index=True, index_label="year", encoding="utf-8-sig",
                  na_rep="NA", float_format="%.6f")
    coverage.to_csv(coverage_path, index=False, encoding="utf-8-sig", float_format="%.6f")
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done: {len(annual)} years, {len(annual.columns)} metrics + year.")
    print(f"CSV: {csv_path.resolve()}")
    print(f"Coverage: {coverage_path.resolve()}")
    print(f"Metadata: {metadata_path.resolve()}")
    return annual, coverage, csv_path


def main():
    annual_data, data_coverage, csv_path = run_pipeline(
        LATITUDE, LONGITUDE,
        end_year=END_YEAR, number_of_years=NUMBER_OF_YEARS,
        cold_threshold=COLD_THRESHOLD_C, hot_threshold=HOT_THRESHOLD_C,
        soil_depths=SOIL_DEPTHS, min_mean_coverage=MIN_MEAN_COVERAGE,
        require_all_values=REQUIRE_ALL_VALUES,
        output_dir=OUTPUT_DIR, cache_dir=CACHE_DIR,
        use_cache=USE_CACHE, cache_ttl_days=CACHE_TTL_DAYS,
    )
    print(annual_data.to_string())
    incomplete = data_coverage.loc[data_coverage["coverage_fraction"] < 1]
    if not incomplete.empty:
        print("Parameters with incomplete coverage:")
        print(incomplete.to_string(index=False))


if __name__ == "__main__":
    main()
