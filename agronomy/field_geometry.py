"""Choose a representative point from a WGS84 field geometry."""

import math

from shapely.geometry import Point, Polygon, shape
from shapely.strtree import STRtree


def longitude_on_grid(longitude):
    return (longitude + 180) % 360 - 180


def unwrap_ring(ring, anchor=None):
    if not isinstance(ring, (list, tuple)) or len(ring) < 4 or ring[0] != ring[-1]:
        raise ValueError("Each polygon ring must contain at least four positions and be closed.")
    positions = []
    for position in ring:
        if not isinstance(position, (list, tuple)) or len(position) < 2:
            raise ValueError("Use [longitude, latitude] positions in WGS84.")
        longitude, latitude = position[:2]
        if (
            type(longitude) not in (int, float) or type(latitude) not in (int, float)
            or not math.isfinite(longitude) or not math.isfinite(latitude)
            or not -180 <= longitude <= 180 or not -90 <= latitude <= 90
        ):
            raise ValueError("Invalid WGS84 longitude or latitude.")
        if anchor is not None:
            longitude = anchor + longitude_on_grid(longitude - anchor)
        positions.append((longitude, latitude))
        anchor = longitude
    if abs(positions[-1][0] - positions[0][0]) > 1e-8:
        raise ValueError("The ring must enclose a local area without winding around the globe.")
    positions[-1] = positions[0]
    return positions


def field_point(boundary):
    if isinstance(boundary, dict) and boundary.get("type") == "Feature":
        boundary = boundary.get("geometry")
    if not isinstance(boundary, dict):
        raise ValueError("Provide a GeoJSON Polygon, MultiPolygon, or Feature.")
    geometry_type = boundary.get("type")
    rings_by_polygon = boundary.get("coordinates")
    if not isinstance(rings_by_polygon, (list, tuple)) or not rings_by_polygon:
        raise ValueError("The field geometry requires coordinates.")
    if geometry_type == "Polygon":
        rings_by_polygon = [rings_by_polygon]
    elif geometry_type != "MultiPolygon":
        raise ValueError("Provide a GeoJSON Polygon or MultiPolygon.")

    polygons = []
    for rings in rings_by_polygon:
        if not isinstance(rings, (list, tuple)) or not rings:
            raise ValueError("Each polygon requires an exterior ring.")
        exterior = unwrap_ring(rings[0])
        holes = [unwrap_ring(ring, exterior[0][0]) for ring in rings[1:]]
        polygon = Polygon(exterior, holes)
        if not polygon.is_valid or polygon.is_empty or polygon.area <= 0:
            raise ValueError("Each field polygon must be valid and have positive area.")
        polygons.append(polygon)

    polygon = max(polygons, key=lambda p: p.area * math.cos(math.radians(p.centroid.y)))
    point = polygon.representative_point()
    return longitude_on_grid(point.x), point.y


class CountryLookup:
    def __init__(self, collection):
        if not isinstance(collection, dict) or collection.get("type") != "FeatureCollection":
            raise ValueError("The country map must be a GeoJSON FeatureCollection.")
        self.units = []
        geometries = []
        for row in collection.get("features", []):
            if not row.get("geometry"):
                continue
            properties = row["properties"]
            code = properties.get("ISO_A2_EH") or properties.get("ISO_A2")
            code = code if isinstance(code, str) and code.isascii() and len(code) == 2 and code.isalpha() else None
            self.units.append((code, properties.get("NAME_EN") or properties.get("GEOUNIT")))
            geometries.append(shape(row["geometry"]))
        if not geometries:
            raise ValueError("The country map contains no geometries.")
        self.index = STRtree(geometries)

    def locate(self, longitude, latitude):
        matches = {
            self.units[idx]
            for idx in self.index.query(Point(longitude, latitude), predicate="covered_by")
        }
        codes = {code for code, _ in matches if code}
        if len(codes) > 1:
            return {"status": "ambiguous", "country_codes": sorted(codes)}
        if len(codes) == 1:
            code = codes.pop()
            names = sorted(name for candidate, name in matches if candidate == code and name)
            return {"status": "available", "country_code": code, "country_name": names[0] if names else None}
        return {"status": "unavailable", "reason": "No coded map unit covers the sample point."}
