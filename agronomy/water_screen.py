"""Calculate a historical water-demand screen from NASA POWER daily weather."""

import math
from datetime import date, timedelta
from statistics import median

DAY = timedelta(days=1)
MINIMUM_HISTORICAL_SEASONS = 3
WEATHER_COLUMNS = (
    "temperature_min_c",
    "temperature_max_c",
    "dew_point_c",
    "solar_radiation_mj_m2_day",
    "wind_speed_2m_m_s",
    "surface_pressure_kpa",
)


def vapor_pressure(temperature):
    return 0.6108 * math.exp(17.27 * temperature / (temperature + 237.3))


def reference_eto(record, day, latitude_deg, elevation_m):
    """Daily grass reference ET in mm using FAO-56 Penman–Monteith."""
    values = tuple(record.get(column) for column in WEATHER_COLUMNS)
    if any(value is None or not math.isfinite(value) for value in values):
        return None
    t_min, t_max, dew_point, solar, wind, pressure = values
    if min(t_min, t_max, dew_point) <= -100 or t_min > t_max or min(solar, wind) < 0 or pressure <= 0:
        return None

    latitude = math.radians(latitude_deg)
    angle = 2 * math.pi * day.timetuple().tm_yday / 365
    distance = 1 + 0.033 * math.cos(angle)
    declination = 0.409 * math.sin(angle - 1.39)
    sunset = math.acos(max(-1, min(1, -math.tan(latitude) * math.tan(declination))))
    extraterrestrial = 1440 / math.pi * 0.0820 * distance * (
        sunset * math.sin(latitude) * math.sin(declination)
        + math.cos(latitude) * math.cos(declination) * math.sin(sunset)
    )
    clear_sky = (0.75 + 2e-5 * elevation_m) * extraterrestrial
    if clear_sky <= 0:
        return None

    t_mean = (t_min + t_max) / 2
    saturation = (vapor_pressure(t_min) + vapor_pressure(t_max)) / 2
    actual = min(saturation, vapor_pressure(dew_point))
    slope = 4098 * vapor_pressure(t_mean) / (t_mean + 237.3) ** 2
    psychrometric = 0.000665 * pressure
    sky_ratio = min(1.0, max(0.3, solar / clear_sky))
    longwave = 4.903e-9 * ((t_min + 273.16) ** 4 + (t_max + 273.16) ** 4) / 2 * (
        0.34 - 0.14 * math.sqrt(actual)
    ) * (1.35 * sky_ratio - 0.35)
    net_radiation = 0.77 * solar - longwave
    return max(
        0.0,
        (0.408 * slope * net_radiation
         + psychrometric * 900 / (t_mean + 273) * wind * (saturation - actual))
        / (slope + psychrometric * (1 + 0.34 * wind)),
    )


def historical_weather(weather, latitude):
    """Index days with enough inputs for the climate comparison."""
    geometry = weather.get("source_geometry") or {}
    coordinates = geometry.get("coordinates") or []
    elevation = coordinates[2] if len(coordinates) >= 3 else None
    if elevation is None or not math.isfinite(elevation):
        return {}
    daily = {}
    for record in weather.get("records", []):
        day = date.fromisoformat(record["date"])
        rain = record.get("precipitation_mm")
        if rain is None or not math.isfinite(rain) or rain < 0:
            continue
        eto = reference_eto(record, day, latitude, elevation)
        if eto is not None:
            daily[day] = (eto, rain)
    return daily


def season_water_screen(daily, planting, harvest, peak_kc):
    """Replay a recurring planting-to-harvest interval in observed years."""
    gaps = []
    for year in sorted({day.year for day in daily}):
        try:
            start = planting.replace(year=year)
            end = harvest.replace(year=year + harvest.year - planting.year)
        except ValueError:
            continue
        days = (end - start).days + 1
        records = [daily.get(start + offset * DAY) for offset in range(days)]
        if any(record is None for record in records):
            continue
        gaps.append(sum(max(peak_kc * eto - rain, 0.0) for eto, rain in records))
    if len(gaps) < MINIMUM_HISTORICAL_SEASONS:
        return None
    return {
        "depth_mm": median(gaps),
        "complete_seasons": len(gaps),
    }
