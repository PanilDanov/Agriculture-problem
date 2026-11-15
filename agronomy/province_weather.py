"""NASA monthly point covariates for the separately trained province models.

These observations describe the manifest's fixed representative point. They
are not crop-mask averages and must not enter the CY-Bench AgERA5 adapter.
"""

from calendar import monthrange
from datetime import date, timedelta
import json
import math
import re

ENDPOINT = "https://power.larc.nasa.gov/api/temporal/monthly/point"
DOCUMENTATION = "https://power.larc.nasa.gov/docs/services/api/temporal/monthly/"
PARAMETERS = {
    "T2M": ("temperatureMeanC", {"c", "degc", "degree_celsius"}, -90, 65),
    "PRECTOTCORR": ("precipitationMmDay", {"mm/day", "mmd-1"}, 0, 2000),
    "ALLSKY_SFC_SW_DWN": ("solarRadiationMjM2Day", {"mj/m^2/day", "mj/m2/day", "mjm-2d-1"}, 0, 70),
}


def parse_monthly(payload, longitude, latitude, start_year, end_year):
    """Validate source units and retain complete rows, excluding annual month 13."""
    try:
        header = payload["header"]
        if header["time_standard"] != "LST":
            raise ValueError("NASA monthly observations must use the LST convention")
        coordinates = payload["geometry"]["coordinates"]
        # POWER echoes point coordinates to three decimal places. Preserve the
        # exact requested/manifest point in the payload and allow only that
        # response precision when checking the echoed coordinates.
        if abs(float(coordinates[0]) - longitude) > 0.0005001 or abs(float(coordinates[1]) - latitude) > 0.0005001:
            raise ValueError("NASA monthly response belongs to a different requested point")
        version = header["api"]["version"]
        if not isinstance(version, str) or not version:
            raise ValueError("NASA monthly response has no API version")
        fill = float(header["fill_value"])
        values = payload["properties"]["parameter"]
        for parameter, (_, units, _, _) in PARAMETERS.items():
            source_unit = str(payload["parameters"][parameter]["units"]).lower().replace(" ", "")
            if source_unit not in units or not isinstance(values[parameter], dict):
                raise ValueError(f"Unexpected NASA monthly unit or values for {parameter}")
        months = sorted(set().union(*(values[key] for key in PARAMETERS)))
        observations = []
        for key in months:
            if not re.fullmatch(r"\d{6}", key):
                raise ValueError("NASA monthly response has an invalid date key")
            year, month = int(key[:4]), int(key[4:])
            if month == 13:  # NASA's separately reported annual value.
                continue
            if not 1 <= month <= 12 or not start_year <= year <= end_year:
                raise ValueError("NASA monthly response has an unexpected month or year")
            record = {"month": f"{year:04d}-{month:02d}"}
            for parameter, (field, _, low, high) in PARAMETERS.items():
                value = values[parameter].get(key)
                if value is None or value == fill:
                    break
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                    raise ValueError(f"NASA monthly {parameter} is outside its supported physical range")
                record[field] = float(value)
            else:
                observations.append(record)
        if not observations:
            raise ValueError("NASA monthly response contains no complete observed months")
        return {"version": version, "observations": observations}
    except (KeyError, TypeError, IndexError, OverflowError) as error:
        raise ValueError("NASA monthly response is incomplete or malformed") from error


def fetch_monthly_weather(client, longitude, latitude, start_year=2000, end_year=None, *, as_of=None):
    """Fetch actual covariates with cache provenance and conservative month cutoffs."""
    as_of = date.today() if as_of is None else date.fromisoformat(str(as_of))
    end_year = as_of.year if end_year is None else end_year
    if (isinstance(start_year, bool) or isinstance(end_year, bool)
            or not isinstance(start_year, int) or not isinstance(end_year, int)
            or not 1984 <= start_year <= end_year <= as_of.year):
        raise ValueError("NASA province weather requires ordered observed years from 1984")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (longitude, latitude)):
        raise ValueError("A finite representative point is required")
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise ValueError("The representative point must use WGS84 coordinates")
    params = {"parameters": ",".join(PARAMETERS), "community": "AG",
              "latitude": latitude, "longitude": longitude,
              "start": start_year, "end": end_year, "format": "JSON"}
    result = client.get(ENDPOINT, params=params, ttl_days=2,
                        decode=lambda body: parse_monthly(json.loads(body), longitude, latitude, start_year, end_year))
    retrieved_at = result.provenance["retrieved_at_utc"]
    available_on = date.fromisoformat(retrieved_at[:10])
    if available_on > as_of:
        raise ValueError("The source was retrieved after the requested input snapshot date")
    cutoff = as_of - timedelta(days=14)
    observations = [dict(row, availableOn=available_on.isoformat()) for row in result.value["observations"]
                    if date(int(row["month"][:4]), int(row["month"][5:]),
                            monthrange(int(row["month"][:4]), int(row["month"][5:]))[1]) <= cutoff]
    if not observations:
        raise ValueError("No complete NASA monthly observations precede the conservative data cutoff")
    return {"product": "NASA POWER Monthly", "version": result.value["version"],
            "support": "representative_point", "timeStandard": "LST",
            "latitude": latitude, "longitude": longitude, "observations": observations,
            "provenance": {**result.provenance, "retrievedAt": retrieved_at,
                           "documentation": DOCUMENTATION,
                           "availabilityInterpretation": "actual_retrieval_date",
                           "spatialInterpretation": "Fixed representative point; not a crop-mask or province-wide weather average."}}
