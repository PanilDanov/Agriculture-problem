"""Read published planting windows without treating regional options as field observations."""

import gzip
import json
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from threading import Lock

import numpy as np
from netCDF4 import Dataset

from .field_providers import SourceError

NETCDF_LOCK = Lock()


def object_list(payload):
    if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
        raise ValueError("Expected a list of provider records.")
    return payload


def month_day(raw):
    if not isinstance(raw, dict):
        return None
    try:
        month = int(raw["month"])
        day = int(raw.get("day") or 0)
        date(2000, month, max(day, 1))
    except (KeyError, TypeError, ValueError):
        return None
    if day < 0:
        return None
    return {"month": month, "day": day or None}


def fao_windows(rows, source, country, zone_id):
    windows = {crop: [] for crop in source["crop_ids"]}
    lookup = {
        provider_crop: (crop, name)
        for crop, identifiers in source["crop_ids"].items()
        for provider_crop, name in identifiers.items()
    }
    for row in rows:
        crop = row.get("crop") or {}
        zone = row.get("aez") or {}
        if row.get("id_country") != country or crop.get("id") not in lookup:
            continue
        if zone_id is not None and zone.get("id") != zone_id:
            continue
        crop_id, crop_name = lookup[crop["id"]]
        for index, session in enumerate(row.get("sessions") or [], start=1):
            if not isinstance(session, dict):
                continue
            all_year = str(session.get("all_year", "")).lower() in {"true", "yes"}
            early = month_day(session.get("early_sowing"))
            late = month_day(session.get("later_sowing"))
            if not (all_year or early or late):
                continue
            windows[crop_id].append({
                "source_id": source["source_id"],
                "scope": "specified_agroecological_zone" if zone_id else "regional_candidate",
                "country_code": country,
                "crop_code": crop["id"],
                "published_crop": crop_name,
                "zone_id": zone.get("id"),
                "zone_name": zone.get("name"),
                "season_number": index,
                "date_updated_as_reported": row.get("lastUpdated"),
                "planting": {
                    "earliest": None if all_year else early,
                    "latest": None if all_year else late,
                    "all_year": all_year,
                },
                "harvest": {
                    "earliest": month_day(session.get("early_harvest")),
                    "latest": month_day(session.get("late_harvest")),
                },
            })
    return windows


def fetch_fao_calendar(client, source, country, zone_id=None):
    if not country:
        return {}, {"status": "country_unavailable"}
    endpoint = source["endpoint"].rstrip("/")
    countries = client.get(
        f"{endpoint}/countries", params={"language": "en"},
        ttl_days=source["ttl_days"], decode=lambda body: object_list(json.loads(body)),
    )
    if country not in {row.get("id") for row in countries.value}:
        return {}, {"status": "country_not_covered", "country_index_request": countries.provenance}

    params = {"language": "en"}
    if zone_id:
        params["aez"] = zone_id
    data = client.get(
        f"{endpoint}/countries/{country}/cropCalendar", params=params,
        ttl_days=source["ttl_days"], decode=lambda body: object_list(json.loads(body)),
    )
    windows = fao_windows(data.value, source, country, zone_id)
    return windows, {
        "status": "available" if any(windows.values()) else "no_window_in_response",
        "country_index_request": countries.provenance,
        "request": data.provenance,
    }


def ordinal_month_day(value):
    if np.ma.is_masked(value):
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or not 1 <= numeric <= 365:
        return None
    # The recurring source calendar uses day 1 for January 1.
    day = date(2001, 1, 1) + timedelta(days=round(numeric) - 1)
    return {"month": day.month, "day": day.day}


def unpack_netcdf(body):
    try:
        data = gzip.decompress(body)
    except (OSError, EOFError) as error:
        raise ValueError("The crop calendar archive is not valid gzip.") from error
    if data[:3] != b"CDF":
        raise ValueError("The crop calendar archive is not NetCDF.")
    return data


def netcdf4_bytes(body):
    if body[:8] != bytes.fromhex("894844460d0a1a0a"):
        raise ValueError("The modeled calendar response is not a NetCDF4 file.")
    return body


def grid_cell(dataset, longitude, latitude, longitude_key, latitude_key):
    xs, ys = dataset[longitude_key][:], dataset[latitude_key][:]
    col = int(np.abs(xs - longitude).argmin())
    row = int(np.abs(ys - latitude).argmin())
    return row, col, [float(xs[col]), float(ys[row])]


def fetch_gridded_window(client, source, season, file_stem, longitude, latitude):
    url = f"{source['endpoint'].rstrip('/')}/{file_stem}.crop.calendar.nc.gz"
    try:
        asset = client.get(url, ttl_days=source["ttl_days"], decode=unpack_netcdf)
        with NETCDF_LOCK, Dataset("sacks-calendar.nc", mode="r", memory=asset.value) as dataset:
            row, col, cell_center = grid_cell(dataset, longitude, latitude, "longitude", "latitude")
            region_level = dataset["political.level"][row, col] if "political.level" in dataset.variables else np.ma.masked
            planting = {
                "earliest": ordinal_month_day(dataset["plant.start"][row, col]),
                "latest": ordinal_month_day(dataset["plant.end"][row, col]),
                "typical": ordinal_month_day(dataset["plant"][row, col]),
            }
            harvest = {
                "earliest": ordinal_month_day(dataset["harvest.start"][row, col]),
                "latest": ordinal_month_day(dataset["harvest.end"][row, col]),
                "typical": ordinal_month_day(dataset["harvest"][row, col]),
            }
        audit = {"request": asset.provenance, "status": "available" if any(planting.values()) else "no_grid_value"}
        if not any(planting.values()):
            return None, audit
        return {
            "source_id": source["source_id"],
            "scope": "sampled_grid_cell",
            "season": season,
            "grid_center": cell_center,
            "resolution_deg": 0.5,
            "source_region_level": None if np.ma.is_masked(region_level) else int(region_level),
            "planting": planting,
            "harvest": harvest,
        }, audit
    except (RuntimeError, OSError, ValueError, KeyError, TypeError) as error:
        return None, {"status": "provider_error", "url": url, "issue": str(error)}


def fetch_modeled_window(client, source, season, code, regime, longitude, latitude):
    filename = f"{code}_{regime}_ggcmi_crop_calendar_phase3_v1.01.nc4"
    url = f"{source['endpoint'].rstrip('/')}/{filename}"
    try:
        asset = client.get(
            url, params={"download": "1"}, ttl_days=source["ttl_days"], decode=netcdf4_bytes,
        )
        with NETCDF_LOCK, Dataset("ggcmi-calendar.nc4", mode="r", memory=asset.value) as dataset:
            row, col, cell_center = grid_cell(dataset, longitude, latitude, "lon", "lat")
            planting = ordinal_month_day(dataset["planting_day"][row, col])
            maturity = ordinal_month_day(dataset["maturity_day"][row, col])
            provider_code = dataset["data_source_used"][row, col]
        audit = {"request": asset.provenance, "status": "available" if planting else "no_grid_value"}
        if planting is None:
            return None, audit
        return {
            "source_id": source["source_id"],
            "scope": "modeled_grid_candidate",
            "season": season,
            "water_regime": source["water_regimes"][regime],
            "grid_center": cell_center,
            "resolution_deg": 0.5,
            "planting": {"typical": planting},
            "maturity": {"typical": maturity},
            "upstream_source_code": None if np.ma.is_masked(provider_code) else int(provider_code),
        }, audit
    except (RuntimeError, OSError, ValueError, KeyError, TypeError) as error:
        return None, {"status": "provider_error", "url": url, "issue": str(error)}


def add_modeled_fallbacks(client, source, results, longitude, latitude):
    jobs = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for crop, entry in results.items():
            if entry["windows"]:
                continue
            for season, code in source["crops"].get(crop, {}).items():
                for regime in source["water_regimes"]:
                    jobs[crop, season, regime] = pool.submit(
                        fetch_modeled_window, client, source, season, code, regime, longitude, latitude,
                    )
    for (crop, season, regime), job in jobs.items():
        window, audit = job.result()
        entry = results[crop]
        entry.setdefault("model_attempts", {})[f"{season}.{regime}"] = audit
        if window:
            entry["windows"].append(window)
            entry["status"] = "modeled_candidates"


def missing_calendar_reason(entry, fao_audit, country_status):
    attempts = [
        fao_audit, *entry.get("grid_attempts", {}).values(), *entry.get("model_attempts", {}).values(),
    ]
    if country_status == "provider_error" or any(
        attempt["status"] == "provider_error"
        or attempt.get("request", {}).get("retrieval") == "stale_cache"
        or attempt.get("country_index_request", {}).get("retrieval") == "stale_cache"
        for attempt in attempts
    ):
        return "lookup_incomplete"
    if fao_audit["status"] == "country_unavailable":
        return "country_unresolved"
    return "no_source_coverage"


def fetch_calendars(
    client, config, crop_ids, longitude, latitude, country, zone_id=None, *, country_status=None,
):
    fao, gridded = config["fao_calendar"], config["gridded_calendar"]
    try:
        regional, fao_audit = fetch_fao_calendar(client, fao, country, zone_id)
    except (SourceError, ValueError, KeyError, TypeError) as error:
        regional, fao_audit = {}, {"status": "provider_error", "issue": str(error)}

    jobs = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for crop in crop_ids:
            if zone_id and regional.get(crop):
                continue
            for season, file_stem in gridded["crops"].get(crop, {}).items():
                jobs[crop, season] = pool.submit(
                    fetch_gridded_window, client, gridded, season, file_stem, longitude, latitude,
                )

    result = {}
    for crop in crop_ids:
        windows = []
        audit = {}
        for season in gridded["crops"].get(crop, {}):
            job = jobs.get((crop, season))
            if job is None:
                continue
            window, record = job.result()
            audit[season] = record
            if window:
                windows.append(window)
        windows.extend(regional.get(crop, []))
        selected = any(window["scope"] != "regional_candidate" for window in windows)
        result[crop] = {
            "status": "available" if selected else "regional_candidates" if windows else "unavailable",
            "windows": windows,
        }
        if audit:
            result[crop]["grid_attempts"] = audit
    sources = {
        fao["source_id"]: {"documentation": fao["documentation"], **fao_audit},
        gridded["source_id"]: {"documentation": gridded["documentation"], "version": gridded["version"]},
    }
    modeled = config.get("modeled_calendar")
    if modeled:
        add_modeled_fallbacks(client, modeled, result, longitude, latitude)
        sources[modeled["source_id"]] = {
            "documentation": modeled["documentation"], "version": modeled["version"],
        }
    for entry in result.values():
        if entry["status"] == "unavailable":
            entry["missing_reason"] = missing_calendar_reason(entry, fao_audit, country_status)
    return {"sources": sources, "crops": result}
