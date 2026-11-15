#!/usr/bin/env python3
"""Replace selection boundaries with audited, openly licensed official IGN data.

This does not change NASA sampling coordinates, weather, labels, calendars or
historical CY-Bench aggregation geometry. See docs/ign_geography.md.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.parse
import xml.etree.ElementTree as ET

import shapely
from shapely.geometry import MultiPolygon, Point, Polygon, mapping, shape
from shapely.geometry.polygon import orient
from shapely.validation import explain_validity


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".data/license-audit/ign-au-provinces-2026-11-15.gml"
PROVINCES = ROOT / "yield_prediction/artifacts/provincial/provinces.json"
AUDIT = ROOT / "yield_prediction/artifacts/reference/ign_geometry_audit.json"
FILTER = ('<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" '
          'xmlns:au="http://inspire.ec.europa.eu/schemas/au/4.0" '
          'xmlns:xlink="http://www.w3.org/1999/xlink"><fes:PropertyIsEqualTo>'
          '<fes:ValueReference>au:nationalLevel/@xlink:href</fes:ValueReference>'
          '<fes:Literal>https://inspire.ec.europa.eu/codelist/AdministrativeHierarchyLevel/3rdOrder'
          '</fes:Literal></fes:PropertyIsEqualTo></fes:Filter>')
SOURCE_URL = "https://www.ign.es/wfs-inspire/unidades-administrativas?" + urllib.parse.urlencode({
    "service": "WFS", "version": "2.0.0", "request": "GetFeature",
    "typeNames": "au:AdministrativeUnit", "count": "53", "filter": FILTER})
EXPECTED_SEMANTIC_SHA256 = "0eb56bdbb9b1bd1b5123f3be660d1b9713a7c7dc028f4c74453b5c8ab666185c"
FROZEN_RAW_SHA256 = "76e6d1ab823f43ee216f975eaffc5007e9c68ad4c5cf4a6ce6b8f8f4c23bb42a"
FROZEN_RETRIEVED_ON = "2026-11-15"
RELEASE = "IGN AdministrativeUnit WFS 2026-11-15 / EPSG:4326 / simplified 0.0001 degree"
ATTRIBUTION = "Obra derivada de Unidades Administrativas (IGN), consulta 2026-11-15, CC-BY 4.0 ign.es"
LICENSE_URL = "https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf"
POINT_DEFINITION = ("Fixed NASA POWER sampling points from province-monthly-v1; unchanged; "
                    "verified inside official IGN province geometry; not crop-area weighted")
POINT_PROVENANCE = {
    "original_selection": "Shapely representative interior point of GISCO NUTS 2024 province geometry",
    "retained_coordinates": True,
    "current_check": "Containment in independently sourced IGN geometry; no point recomputation"}
NS = {"au": "http://inspire.ec.europa.eu/schemas/au/4.0", "gml": "http://www.opengis.net/gml/3.2",
      "gn": "http://inspire.ec.europa.eu/schemas/gn/4.0"}


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                       allow_nan=False) + "\n").encode()


def sha(body):
    return hashlib.sha256(body).hexdigest()


def write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(body)
    temporary.replace(path)


def semantic_hash(features):
    digest = hashlib.sha256()
    for feature in sorted(features, key=lambda item: item.findtext("au:nationalCode", namespaces=NS)):
        # Ignore only the WFS envelope's request timestamp. All returned feature
        # contents, including source lifecycle metadata and geometries, are bound.
        canonical = ET.canonicalize(ET.tostring(feature, encoding="unicode"),
                                    strip_text=True, rewrite_prefixes=True)
        digest.update(canonical.encode() + b"\n")
    return digest.hexdigest()


def ring(element, transformer):
    if element is None:
        raise ValueError("Missing GML exterior ring")
    positions = element.findall(".//gml:posList", NS)
    if len(positions) != 1:
        raise ValueError("Expected exactly one linear GML position list per ring")
    values = [float(item) for item in positions[0].text.split()]
    if len(values) < 8 or len(values) % 2:
        raise ValueError("Invalid two-dimensional GML ring")
    # EPSG:4258 GML declares latitude,longitude axis order. always_xy applies
    # only after that declared input order is decoded explicitly.
    coordinates = [transformer.transform(values[i + 1], values[i]) for i in range(0, len(values), 2)]
    if coordinates[0] != coordinates[-1]:
        raise ValueError("Unclosed GML ring")
    return coordinates


def geometry(feature, transformer):
    geometries = feature.findall("au:geometry/gml:MultiSurface", NS)
    if len(geometries) != 1 or geometries[0].get("srsName") != "http://www.opengis.net/def/crs/EPSG/0/4258":
        raise ValueError("Unexpected IGN geometry or CRS; review source before transforming")
    polygons = [Polygon(ring(item.find("gml:exterior", NS), transformer),
                        [ring(hole, transformer) for hole in item.findall("gml:interior", NS)])
                for item in geometries[0].findall("gml:surfaceMember/gml:Polygon", NS)]
    result = polygons[0] if len(polygons) == 1 else MultiPolygon(polygons)
    if result.is_empty or not result.is_valid:
        raise ValueError("Invalid original IGN geometry: " + explain_validity(result))
    return result


def area(geometry, geod):
    polygons = geometry.geoms if geometry.geom_type == "MultiPolygon" else [geometry]
    return sum(abs(geod.geometry_area_perimeter(orient(item, sign=1.0))[0]) for item in polygons)


def vertices(value):
    if isinstance(value, (tuple, list)) and value and isinstance(value[0], (int, float)):
        return 1
    return sum(vertices(item) for item in value)


def rounded(value):
    if isinstance(value, (tuple, list)):
        return [rounded(item) for item in value]
    return round(value, 6)


def compact(original, geod):
    result = original.simplify(0.0001, preserve_topology=True)
    raw = mapping(result)
    result = shape({"type": raw["type"], "coordinates": rounded(raw["coordinates"])})
    if result.is_empty or not result.is_valid:
        raise ValueError("Simplified geometry is invalid; no silent geometry repair is permitted")
    original_area, result_area = area(original, geod), area(result, geod)
    relative_change = abs(result_area - original_area) / original_area
    if relative_change > 0.001:
        raise ValueError("Boundary simplification changed geodesic area by more than 0.1%")
    return result, {"original_area_m2": original_area, "released_area_m2": result_area,
                    "absolute_area_change_fraction": relative_change,
                    "original_vertices": vertices(mapping(original)["coordinates"]),
                    "released_vertices": vertices(mapping(result)["coordinates"]),
                    "original_valid": True, "released_valid": True, "repairs": []}


def prepare(input_path):
    # The CLI date guard and metadata-only import do not require this optional
    # source-reproduction dependency. Initialize CRS/area tools only for work.
    import pyproj

    geod = pyproj.Geod(ellps="WGS84")
    transformer = pyproj.Transformer.from_crs("EPSG:4258", "EPSG:4326", always_xy=True)
    body = input_path.read_bytes()
    if len(body) > 80_000_000:
        raise ValueError("Unexpectedly large source response")
    if sha(body) == FROZEN_RAW_SHA256:
        retrieved_on = FROZEN_RETRIEVED_ON
    else:
        receipt = json.loads(input_path.with_suffix(input_path.suffix + ".receipt.json").read_text())
        retrieved_on = datetime.fromisoformat(receipt["retrieved_at"]).date().isoformat()
        if (receipt["source_url"] != SOURCE_URL or receipt["source_sha256"] != sha(body)
                or retrieved_on != FROZEN_RETRIEVED_ON):
            raise ValueError("Unknown retrieval provenance; a new release requires a reviewed source/date")
    xml = ET.fromstring(body)
    features = xml.findall(".//au:AdministrativeUnit", NS)
    if xml.get("numberReturned") != "53" or len(features) != 53 or semantic_hash(features) != EXPECTED_SEMANTIC_SHA256:
        raise ValueError("IGN source feature set changed; review its identity before releasing new geometry")
    old = json.loads(PROVINCES.read_text())
    reference = {row["region_id"]: row for row in old["records"]}
    if set(reference) != {f"{value:02d}" for value in range(1, 51)}:
        raise ValueError("Expected exactly the 50 reviewed MAPA province codes")
    rows, audits, excluded = [], [], []
    for feature in features:
        national = feature.findtext("au:nationalCode", namespaces=NS)
        official_name = feature.findtext(".//gn:text", namespaces=NS)
        if not re.fullmatch(r"34\d{4}00000", national or ""):
            raise ValueError("Unexpected official province nationalCode")
        code = national[4:6]
        if code not in reference:
            if code not in {"51", "52", "54"}:
                raise ValueError("Unexpected excluded IGN third-order unit")
            excluded.append({"national_code": national, "province_code": code, "name": official_name,
                             "reason": "Not one of the 50 provinces in the MAPA/NASA model scope"})
            continue
        source = reference[code]
        original = geometry(feature, transformer)
        result, audit = compact(original, geod)
        point = Point(source["longitude"], source["latitude"])
        if not original.covers(point) or not result.covers(point):
            raise ValueError("Retained NASA sampling point is outside IGN province " + code)
        point_source = {"original_geometry_version": "GISCO NUTS 2024 03M EPSG:4326",
                        "current_containment_source": RELEASE, "retained_coordinates": True}
        rows.append({**source, "geometry": mapping(result), "geometry_version": RELEASE,
                     "official_national_code": national, "official_name": official_name,
                     "point_method": POINT_DEFINITION, "point_source": point_source})
        audits.append({"province_code": code, "national_code": national, "official_name": official_name,
                       "mapa_name": source["province_name"], "point_unchanged": True,
                       "longitude": source["longitude"], "latitude": source["latitude"],
                       "point_inside_original": True, "point_inside_released": True, **audit})
    rows.sort(key=lambda row: row["region_id"])
    audits.sort(key=lambda row: row["province_code"])
    if [row["region_id"] for row in rows] != sorted(reference):
        raise ValueError("IGN province mapping is incomplete or duplicated")
    raw_source = {"source_url": SOURCE_URL, "source_sha256": sha(body), "source_bytes": len(body),
                  "source_semantic_sha256": EXPECTED_SEMANTIC_SHA256,
                  "source_wfs_timestamp": xml.get("timeStamp"), "retrieved_on": retrieved_on,
                  "attribution": ATTRIBUTION, "license": "CC-BY-4.0", "license_url": LICENSE_URL,
                  "region_namespace": "Spain INE two-digit province code"}
    policy = {"input_crs": "EPSG:4258 (GML latitude,longitude)", "output_crs": "EPSG:4326 (GeoJSON longitude,latitude)",
              "simplify_tolerance_degrees": 0.0001, "preserve_topology": True, "coordinate_decimal_places": 6,
              "max_absolute_area_change_fraction": 0.001, "area_method": "pyproj.Geod WGS84 ellipsoid; oriented polygon rings",
              "use": "Province lookup/selection, not cadastral or surveyed field boundaries", "repairs": []}
    current = {**raw_source, "province_names_source": old["province_names_source"],
               "province_names_source_url": old["province_names_source_url"],
               "province_names_source_sha256": old["province_names_source_sha256"],
               "schema_version": "1.1", "point_definition": POINT_DEFINITION,
               "point_provenance": POINT_PROVENANCE, "precision_policy": policy,
               "crosswalk_method": "Official IGN nationalCode: country 34, autonomous-community 2 digits, province INE 2 digits, municipal suffix 00000. Exact 01–50 code match to the reviewed MAPA keys; names retained independently.",
               "records": rows}
    audit = {"schema_version": "1.0", **raw_source, "precision_policy": policy,
             "source_unit_count": 53, "released_province_count": 50, "excluded_units": excluded,
             "versions": {"shapely": shapely.__version__, "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str},
             "point_provenance": POINT_PROVENANCE, "records": audits,
             "province_snapshot_sha256": sha(encode(current))}
    return current, audit


def publish(current, audit):
    # All source/geometry/point checks complete before replacing any release file.
    registry_path = ROOT / "agronomy/province_inputs/registry.json"
    registry = json.loads(registry_path.read_text())
    geography = {row["region_id"]: row for row in current["records"]}
    for row in registry["regions"]:
        replacement = geography[row["regionId"]]
        if any(row[key] != replacement[key] for key in ("latitude", "longitude")):
            raise ValueError("Publishing would change a NASA sampling point")
        row.update(geometry=replacement["geometry"], geometryVersion=RELEASE,
                   pointMethod=POINT_DEFINITION, pointSource=replacement["point_source"],
                   officialNationalCode=replacement["official_national_code"])
    registry["geometrySource"] = {key: value for key, value in current.items() if key != "records"}
    regional_path = ROOT / "agronomy/regional_inputs/registry.json"
    regional = json.loads(regional_path.read_text())
    lugo = geography["27"]
    for row in regional["regions"]:
        if row["regionId"] != "ES112" or row["name"] != "Lugo":
            raise ValueError("Unexpected legacy region; review its statistical-unit crosswalk")
        row.update(boundary=lugo["geometry"], boundaryVersion=RELEASE, boundaryAttribution=ATTRIBUTION,
                   boundarySource={key: current[key] for key in ("source_url", "source_sha256", "license", "license_url")},
                   boundaryRole="Independent IGN province 27 selection boundary for the unchanged CY-Bench ES112 dataset; not its historical crop-mask aggregation geometry")
    provenance_path = ROOT / "agronomy/regional_inputs/source_provenance.json"
    provenance = json.loads(provenance_path.read_text())
    if "historicalCybenchBoundary" not in provenance:
        provenance["historicalCybenchBoundary"] = {"boundarySource": provenance.pop("boundarySource"),
            "boundaryReference": provenance.pop("boundaryReference"), "boundaryAttribution": provenance.pop("boundaryAttribution"),
            "geometryAudit": provenance.pop("geometryAudit"),
            "role": "Historical source verification only. Original polygons are not redistributed as selection geometry. Weather/crop-mask/calendar inputs and original model training provenance are unchanged."}
    provenance["selectionBoundary"] = {**{key: value for key, value in current.items() if key != "records"},
        "province_code": "27", "official_national_code": lugo["official_national_code"], "statistical_region_id": "ES112",
        "crosswalk_basis": "CY-Bench ES112 is Lugo (NUTS 2016), matched to official IGN province 27 Lugo by reviewed identity; not a new weather aggregation",
        "geometry_sha256": sha(encode(lugo["geometry"])), "precision_audit": next(row for row in audit["records"] if row["province_code"] == "27")}
    for path, value in [(PROVINCES, current), (AUDIT, audit), (registry_path, registry),
                        (regional_path, regional), (provenance_path, provenance)]:
        write(path, encode(value))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=CACHE)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--publish", action="store_true", help="Publish only after validating all 50 source geometries and fixed points")
    args = parser.parse_args()
    if args.download:
        retrieved_at = datetime.now(timezone.utc).isoformat()
        if retrieved_at[:10] != FROZEN_RETRIEVED_ON:
            raise ValueError("This is the audited 2026-11-15 release. A later retrieval requires a newly reviewed release, not a backdated timestamp.")
        # System curl uses the platform's verified certificate store, including
        # managed trust anchors absent from some macOS Python installations.
        # Certificate verification is never disabled.
        completed = subprocess.run(["curl", "--fail", "--location", "--max-time", "60",
            "--max-filesize", "80000000", "--silent", "--show-error", SOURCE_URL],
            capture_output=True, check=True, timeout=65)
        body = completed.stdout
        if len(body) > 80_000_000:
            raise ValueError("IGN response is too large")
        write(args.input, body)
        write(args.input.with_suffix(args.input.suffix + ".receipt.json"), encode({
            "source_url": SOURCE_URL, "source_sha256": sha(body), "retrieved_at": retrieved_at}))
    current, audit = prepare(args.input)
    if args.publish:
        publish(current, audit)
    print(json.dumps({"status": "published" if args.publish else "verified", "provinces": len(current["records"]),
                      "source_sha256": current["source_sha256"], "province_snapshot_sha256": audit["province_snapshot_sha256"],
                      "max_area_change_fraction": max(row["absolute_area_change_fraction"] for row in audit["records"]),
                      "released_vertices": sum(row["released_vertices"] for row in audit["records"])}, indent=2))


if __name__ == "__main__":
    main()
