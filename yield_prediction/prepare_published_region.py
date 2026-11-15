"""Reproduce an audited ES112 regional input release from official CY-Bench 1.10.

Uses the original 2025 release, not the later GitHub sample publication. Its
matching boundary is checked against official GISCO NUTS 2016 at 1e-6 degrees.
"""

import argparse
from datetime import date, datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile
from urllib.request import urlopen
from zipfile import ZipFile

import pandas as pd

from download_data import GROUPS, central_directory, fetch_group, tls_context
from yield_prediction import build_model_features
from yield_prediction.features import WEATHER, seasons
from yield_prediction.service import predict_request

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
RECORD = "https://zenodo.org/records/17279151"
POLYGONS_URL = RECORD + "/files/polygons.zip?download=1"
POLYGONS_MD5 = "815d0e94f6746f15febb99b627142a04"
GISCO_URL = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_03M_2016_4326.geojson"
GISCO_SHA256 = "06d15d7f1e933029d5e87f4a83b5d2d1eec4f9497bb50484ca1e8b54bb304f8a"
AVAILABLE_ON = "2025-12-19"
ATTRIBUTION = "© EuroGeographics for the administrative boundaries"
TABLE_HASHES = {
    "maize": {
        "meteo": "3c28b6b2e33c79c813cbe73023f50cb250b5f0be55c25c4c682e1e0bf417662a",
        "crop_calendar": "670c7f0ca01cd30a2ae93d6e352d11c81b6fbaa367498873e8e86400906623f5",
        "soil": "76d9fc2b30944ccdd4406be8de112c4029fe761fb7efa1dd5b8c2503536c6c3c",
        "location": "846443830cfa3bd856fd6355be8bd1a05513011dfc16411de2eb0dabc0d51f0c",
    },
    "wheat": {
        "meteo": "a365b1f9ce9d1281f42b37c7bc7847347add31178d7735a88645424cfbf4ac55",
        "crop_calendar": "e4b4b9932dc315923b7c670baaad0f8e21ad374a06ccfb848c7497cdfedb2d6b",
        "soil": "c3771b7a134d67a063e292a713f70ddc28cec712c75eba70509fe0e308055cf0",
        "location": "bf4c80bcd534cd403dec904c00cd091fbc0f0ef65246d3dbc9b3d739622c8326",
    },
}


def digest(body, algorithm="sha256"):
    return hashlib.new(algorithm, body).hexdigest()


def fetch_checked(url, target, expected, algorithm="sha256"):
    if target.is_file() and digest(target.read_bytes(), algorithm) == expected:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    try:
        with urlopen(url, timeout=90, context=tls_context()) as response, temporary.open("wb") as out:
            shutil.copyfileobj(response, out)
        if digest(temporary.read_bytes(), algorithm) != expected:
            raise ValueError("Source checksum changed; review the publication/version before updating the release")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def download_sources(directory, polygon_path, gisco_path):
    fetch_checked(POLYGONS_URL, polygon_path, POLYGONS_MD5, "md5")
    fetch_checked(GISCO_URL, gisco_path, GISCO_SHA256)
    directory.mkdir(parents=True, exist_ok=True)
    members = central_directory()
    for crop in ("maize", "wheat"):
        target = directory / f"{crop}_ES.zip"
        if target.exists():
            continue
        selected = [member for member in members if member.filename.startswith(f"cybench-data/{crop}/ES/")
                    and any(member.filename.endswith(f"/{kind}_{crop}_ES.csv")
                            for kind in (*TABLE_HASHES[crop], "yield"))]
        if len(selected) != 5:
            raise ValueError("The pinned CY-Bench archive lacks the five required ES source tables")
        fetch_group(selected, target)


def selected_geometry(polygon_path, gisco_path, region_id):
    import shapefile
    from shapely.geometry import shape

    polygon_body = polygon_path.read_bytes()
    if digest(polygon_body, "md5") != POLYGONS_MD5:
        raise ValueError("Original CY-Bench polygon archive checksum mismatch")
    gisco_body = gisco_path.read_bytes()
    if digest(gisco_body) != GISCO_SHA256:
        raise ValueError("GISCO NUTS 2016 reference checksum mismatch")
    with ZipFile(polygon_path) as archive:
        prj = archive.read("polygons/ES/ES.prj").decode("ascii")
        if "GCS_WGS_1984" not in prj:
            raise ValueError("The released ES polygon does not declare WGS84")
        reader = shapefile.Reader(**{suffix: io.BytesIO(archive.read(f"polygons/ES/ES.{suffix}"))
                                     for suffix in ("shp", "shx", "dbf")}, encoding="utf-8")
        records = [record for record in reader.iterShapeRecords() if record.record.as_dict()["adm_id"] == region_id]
        if len(records) != 1:
            raise ValueError("Exactly one original CY-Bench polygon must match the region ID")
        geometry = records[0].shape.__geo_interface__
    matches = [feature for feature in json.loads(gisco_body)["features"]
               if feature["properties"]["NUTS_ID"] == region_id]
    if len(matches) != 1 or matches[0]["properties"]["LEVL_CODE"] != 3:
        raise ValueError("Exactly one GISCO NUTS3 reference must match the region")
    actual, reference = shape(geometry), shape(matches[0]["geometry"])
    def single(value):
        return value.geoms[0] if value.geom_type == "MultiPolygon" and len(value.geoms) == 1 else value
    if not actual.is_valid or not single(actual).normalize().equals_exact(single(reference).normalize(), 1e-6):
        raise ValueError("CY-Bench geometry does not match the official GISCO 2016 region")
    return geometry, matches[0]["properties"]["NUTS_NAME"], {
        "polygonArchiveSha256": digest(polygon_body), "polygonArchiveMd5": POLYGONS_MD5,
        "giscoSha256": GISCO_SHA256, "geometryToleranceDegrees": 1e-6,
        "measuredHausdorffDegrees": actual.hausdorff_distance(reference),
        "regionId": region_id, "countryCode": "ES", "nutsLevel": 3,
        "nutsVersion": "2016", "resolution": "03M", "crs": "EPSG:4326",
    }


def raw_input(source_path, crop, region_id, harvest_year, as_of):
    with ZipFile(source_path) as archive:
        tables = {}
        for kind, expected in TABLE_HASHES[crop].items():
            name = next(name for name in archive.namelist() if name.endswith(f"/{kind}_{crop}_ES.csv"))
            tables[kind] = archive.read(name)
            if digest(tables[kind]) != expected:
                raise ValueError(f"Original CY-Bench {crop}/{kind} table checksum mismatch")
    selected = {}
    for kind in ("crop_calendar", "soil", "location"):
        frame = pd.read_csv(io.BytesIO(tables[kind]))
        rows = frame.loc[frame.adm_id.eq(region_id)]
        if len(rows) != 1:
            raise ValueError(f"Expected one {crop}/{kind} record for {region_id}")
        selected[kind] = rows.iloc[0]
    calendar, soil, location = (selected[key] for key in ("crop_calendar", "soil", "location"))
    windows = seasons(pd.DataFrame({"adm_id": region_id, "harvest_year": range(harvest_year - 7, harvest_year + 1),
                                   "sos": calendar.sos, "eos": calendar.eos}))
    chunks = []
    for frame in pd.read_csv(io.BytesIO(tables["meteo"]), chunksize=100_000):
        chosen = frame.loc[frame.adm_id.eq(region_id) & frame.date.ge((harvest_year - 7) * 10000 + 101)]
        if len(chosen):
            chunks.append(chosen)
    if not chunks:
        raise ValueError("No historical daily weather is available for this regional horizon")
    daily = pd.concat(chunks).sort_values("date")
    observations = [{"date": pd.to_datetime(str(row["date"]), format="%Y%m%d").date().isoformat(),
                     "available_on": AVAILABLE_ON,
                     **{key: float(row[key]) if pd.notna(row[key]) else None for key in WEATHER}}
                    for row in daily.to_dict("records")]
    return {
        "schema_version": "1.0", "as_of": as_of, "harvest_year": harvest_year,
        "region": {"country_code": "ES", "adm_id": region_id,
                   "boundary_source": "CY-Bench 1.10 polygons.zip; GISCO NUTS 2016; " + ATTRIBUTION,
                   "boundary_version": "NUTS 2016 / CY-Bench 1.10", "match": "cybench_verified",
                   "latitude": float(location.latitude), "longitude": float(location.longitude),
                   "aggregation": "administrative_crop_mask", "source_reference": RECORD},
        "calendar": {"source": "CY-Bench 1.10 recurring static regional crop calendar, not observed target-year sowing",
                     "source_reference": RECORD, "artifact_sha256": TABLE_HASHES[crop]["crop_calendar"],
                     "seasons": [{"harvest_year": int(row.harvest_year),
                                  "start": row.season_start.date().isoformat(), "end": row.season_end.date().isoformat(),
                                  "available_on": AVAILABLE_ON} for row in windows.itertuples()]},
        "weather": {"product": "CY-Bench AgERA5", "version": "1.10", "time_standard": "LST",
                    "source_reference": RECORD, "artifact_sha256": TABLE_HASHES[crop]["meteo"],
                    "units": dict(zip(WEATHER, ["C", "C", "C", "mm/day", "J/m2/day", "mm/day", "hPa", "mm/day"])),
                    "observations": observations},
        "soil": {"product": "CY-Bench WISE", "version": "1.10", "available_on": AVAILABLE_ON,
                 "awc": float(soil.awc), "awc_unit": "CY-Bench WISE",
                 "bulk_density": float(soil.bulk_density), "bulk_density_unit": "kg/dm3",
                 "source_reference": RECORD, "artifact_sha256": TABLE_HASHES[crop]["soil"]},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--source-dir", type=Path, default=ROOT / "data/raw/zenodo")
    parser.add_argument("--polygons", type=Path, default=PROJECT / ".runtime/regional-source/polygons.zip")
    parser.add_argument("--gisco", type=Path, default=PROJECT / ".runtime/regional-source/nuts-2016.geojson")
    parser.add_argument("--output", type=Path, default=PROJECT / "agronomy/regional_inputs")
    parser.add_argument("--region", choices=("ES112",), default="ES112")
    parser.add_argument("--harvest-year", type=int, choices=(2026,), default=2026)
    parser.add_argument("--as-of", default=date.today().isoformat())
    args = parser.parse_args()
    if date.fromisoformat(args.as_of) > date.today():
        raise ValueError("The regional input issue cutoff cannot be in the future")
    if args.download:
        download_sources(args.source_dir, args.polygons, args.gisco)
    geometry, name, geometry_audit = selected_geometry(args.polygons, args.gisco, args.region)
    args.output.mkdir(parents=True, exist_ok=True)
    records, checks = [], []
    for crop in ("maize", "wheat"):
        raw = raw_input(args.source_dir / f"{crop}_ES.zip", crop, args.region, args.harvest_year, args.as_of)
        prepared = build_model_features(raw, crop, "pre_season")
        if prepared["status"] != "ready":
            raise ValueError(json.dumps(prepared, allow_nan=False))
        actual = predict_request({"crop": crop, "mode": "pre_season", "environmentalInput": raw})
        filename = f"{args.region}_{crop}_{args.harvest_year}_pre_season.json"
        body = (json.dumps(raw, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
        (args.output / filename).write_bytes(body)
        records.append({"cropId": crop, "harvestYear": args.harvest_year, "mode": "pre_season",
                        "path": filename, "sha256": digest(body), "dataThrough": actual["diagnostics"]["dataThrough"]})
        checks.append({"cropId": crop, "forecastDate": actual["diagnostics"]["forecastDate"],
                       "climateThrough": actual["diagnostics"]["dataThrough"], "coverage": prepared["coverage"],
                       "isReplay": actual["forecast"]["is_replay"],
                       "calculatedAt": actual["forecast"]["calculated_at"],
                       "temporalStatus": actual["forecast"]["temporal_status"],
                       "modelVersion": actual["forecast"]["model_version"],
                       "referencePredictionTHa": actual["forecast"]["predicted_yield_t_ha"]})
    registry = {"schemaVersion": "1.0", "regions": [{"regionId": args.region, "countryCode": "ES", "name": name,
                "boundary": geometry, "boundaryVersion": "GISCO NUTS 2016 / CY-Bench 1.10",
                "boundaryAttribution": ATTRIBUTION, "datasets": records}]}
    (args.output / "registry.json").write_text(json.dumps(registry, indent=2) + "\n")
    provenance = {"source": RECORD, "datasetVersion": "1.10", "publishedOn": "2025-10-06",
                  "recordLastUpdated": "2025-12-19T07:37:29.996537+00:00", "conservativeAvailableOn": AVAILABLE_ON,
                  "availabilityBasis": "Latest recorded revision of the original published Zenodo 1.10 archive; not observation date or sample GitHub commit.",
                  "samplePublicationNotUsed": "GitHub sample commit b55e691 is 2026-04-16, after these pre-season issue dates.",
                  "sourceArchiveExpectedMd5": "8ec510982f396469eca25a4f0fa8632e", "sourceArchiveBytes": 6228749411,
                  "downloadMethod": "Only original ES table byte ranges; each member CRC verified. Full 6.2GB archive not downloaded.",
                  "originalCsvSha256": TABLE_HASHES, "geometryAudit": geometry_audit,
                  "boundarySource": POLYGONS_URL, "boundaryReference": GISCO_URL, "boundaryAttribution": ATTRIBUTION,
                  "calendarAssumption": "Published static crop-area-weighted day-of-year calendar recurs in target year; not a measured planting date.",
                  "weatherLimit": "Observed daily data through 2023. Pre-season climatology uses five eligible 2019-2023 seasons; there is no 2026 mid-season weather.",
                  "temporalInterpretation": "Retrospective estimates computed during release preparation, not evidence of forecasts actually issued on the nominal January/April dates.",
                  "preparedAsOf": args.as_of, "verification": checks}
    (args.output / "source_provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps({"status": "ready", "region": args.region, "datasets": records, "verification": checks}, indent=2))


if __name__ == "__main__":
    main()
