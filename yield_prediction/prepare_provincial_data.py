#!/usr/bin/env python3
"""Audit and extract official MAPA provincial crop labels (no model fitting).

Raw yearbooks are cached outside Git. Downloads use the system TLS trust store;
the source URLs are discovered from MAPA's yearbook navigation, not assumed from
table numbers (those and the chapter numbers change over time).
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from datetime import date
from html import unescape
import hashlib
import gzip
import io
import json
import math
from pathlib import Path
import re
import subprocess
import unicodedata
from urllib.parse import quote, urljoin
import xml.etree.ElementTree as ET
import zipfile


REPO = Path(__file__).resolve().parents[1]
CACHE = REPO / ".data/regional-expansion/yearbooks"
BASE = "https://www.mapa.gob.es/es/estadistica/temas/publicaciones/anuario-de-estadistica/"
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ARTIFACTS = REPO / "yield_prediction/artifacts/provincial"
CROP_PATTERNS = {"wheat": r"\btrigo\b", "barley": r"\bcebada\b", "maize": r"\bmaiz\b",
                 "sorghum": r"\bsorgo\b", "chickpea": r"\bgarbanzos\b", "lentil": r"\blentejas\b",
                 "faba-bean": r"\bhabas secas\b", "sunflower": r"\bgirasol\b",
                 "potato": r"\bpatata\b", "tomato": r"\btomate\b"}


def normalized(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore")
                  .decode().lower()).strip()


def province_aliases():
    source = json.loads((ARTIFACTS / "provinces.json").read_text())
    key = lambda value: re.sub("[^a-z0-9]", "", normalized(value))
    aliases = {key(row["province_name"]): row["province_code"] for row in source["records"]}
    historical = {"01": ["Alava", "Álava/Araba"], "07": ["Baleares", "Balears, Illes", "I. Balears", "Illes Balears"],
                  "15": ["Coruña, A", "La Coruña", "Coruña"], "17": ["Gerona"],
                  "20": ["Guipúzcoa"], "25": ["Lérida"], "26": ["Rioja, La"],
                  "28": ["Madrid, Comunidad de", "Comunidad de Madrid", "C. de Madrid"],
                  "30": ["Murcia, Región de", "Región de Murcia", "R. de Murcia"],
                  "31": ["Navarra, Comunidad Foral de", "Comunidad Foral de Navarra", "C. F. de Navarra"],
                  "32": ["Orense"], "33": ["Asturias, Principado de", "Principado de Asturias", "P. de Asturias"],
                  "35": ["Palmas, Las"], "38": ["S. C. Tenerife", "S.C. de Tenerife", "Sta. Cruz de Tenerife"],
                  "48": ["Vizcaya"]}
    for code, names in historical.items():
        for name in names:
            aliases[key(name)] = code
    for row in source["records"]:
        for part in ["Alicante/Alacant", "Castellón/Castelló", "Valencia/València"]:
            if part.split("/")[0] == row["province_name"]:
                aliases[key(part)] = row["province_code"]
    return aliases


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def column_name(index):
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def extract_sheet(source, sheet, rows, aliases):
    title = " ".join(str(value) for row in rows[:5] for value in row.values())
    norm = normalized(title)
    if ("analisis provincial" not in norm or not ("rendimiento y produccion" in norm or "provincial detallado" in norm)
            or "forrajer" in norm or "segun" in norm or "sarraceno" in norm or "maiz dulce" in norm):
        return [], None
    crops = [crop for crop, pattern in CROP_PATTERNS.items() if re.search(pattern, norm)]
    if len(crops) != 1:
        return [], None
    crop = crops[0]
    subtype_words = {"wheat": ("duro", "blando", "invierno", "primavera", "tranquillon"),
                     "barley": ("carreras", "invierno", "primavera"),
                     "maize": ("hibrido", "otro maiz"), "faba-bean": ("consumo animal", "consumo humano"),
                     "potato": ("extratemprana", "temprana", "tardia", "media estacion"),
                     "tomato": ("recoleccion", "consumo en fresco", "tomate de industria", "tomate industria")}
    if any(word in norm for word in subtype_words.get(crop, ())):
        return [], None
    years = re.findall(r"\b(?:19|20)\d{2}\b", norm)
    if len(set(years)) != 1:
        return [], {"source_id": source["source_id"], "sheet": sheet, "reason": "Ambiguous harvest year", "title": title}
    year = int(years[0])
    correction = None
    if source["yearbook"] == 2023 and sheet == "7.2.5.2" and crop == "chickpea" and year == 2021:
        # The XLSX title retains 2021, but MAPA's own PDF, table 7.2.5.2 on
        # printed pages 284–285, labels the matching province rows as 2022.
        year = 2022
        correction = {"field": "harvest_year", "original": 2021, "corrected": 2022,
                      "basis": "Official companion PDF table 7.2.5.2, printed pages 284–285; province area/production rows agree",
                      "source_url": "https://www.mapa.gob.es/estadistica/pags/anuario/2023/FORMATO%20PDF/AE23-C07/CAP%C3%8DTULO%207.pdf"}
        country = next(row for row in rows if normalized(row.get(1, "")) == "espana")
        if (number(country.get(4)), number(country.get(7))) != (36076.0, 31403.0):
            raise ValueError("Reviewed 2023 chickpea year correction no longer matches source totals")
    if source["yearbook"] == 2024 and sheet == "7.2.5.1" and crop == "chickpea" and year == 2024:
        country = next(row for row in rows if normalized(row.get(1, "")) == "espana")
        if (number(country.get(10)), number(country.get(14))) != (63268.0, 49722.0):
            raise ValueError("Reviewed 2024 chickpea year correction no longer matches source totals")
        year = 2023
        correction = {"field": "harvest_year", "original": 2024, "corrected": 2023,
                      "basis": "The same official workbook's historical series 7.2.5.2 B18=2023, C18=63.268 thousand ha, E18=49.722 thousand t exactly matches this province table's national J87=63268 ha and N87=49722 t. The 2025 historical series independently repeats those 2023 totals.",
                      "source_url": source["url"], "reference_sheet": "7.2.5.2", "reference_cells": ["B18", "C18", "E18"],
                      "reference_area_ha": 63268, "reference_production_t": 49722}
    headers = rows[2:14]
    # Role labels sit above their data columns; long title cells are excluded.
    labels = [(column, normalized(value)) for row in headers for column, value in row.items()
              if isinstance(value, str) and len(value) < 80]
    yield_columns = [c for c, label in labels if label.startswith("rendimiento")]
    if not yield_columns:
        return [], {"source_id": source["source_id"], "sheet": sheet, "reason": "No verified yield header"}
    yield_start = min(yield_columns)
    harvested_starts = [c for c, label in labels if label.startswith("superficie cosechada")]
    area_start = max(harvested_starts) if harvested_starts else min(
        (c for c, label in labels if label.startswith("superficie")), default=1)
    total_columns = sorted({c for c, label in labels if label == "total" and area_start <= c < yield_start})
    if not total_columns:
        return [], {"source_id": source["source_id"], "sheet": sheet, "reason": "No verified total area column"}
    area_col = total_columns[-1] if harvested_starts else total_columns[0]
    harvested_production = [c for c, label in labels if label.startswith("produccion cosechada")]
    production_columns = harvested_production or [c for c, label in labels if label.startswith("produccion")]
    prod_col = min(production_columns) if production_columns else None
    explicit_units = any("hectarea" in label or label == "ha" for _, label in labels) and any(
            "tonelada" in label or label == "t" for _, label in labels)
    modern_tomato_template = crop == "tomato" and source["yearbook"] in (2024, 2025) and bool(harvested_starts)
    if prod_col is None or not (explicit_units or modern_tomato_template):
        return [], {"source_id": source["source_id"], "sheet": sheet, "reason": "Area/production units not verified"}
    tomato_open_area = max((c for c, label in labels if "aire libre" in label and area_start <= c < yield_start), default=None)
    tomato_open_yield = min((c for c, label in labels if "aire libre" in label and c >= yield_start), default=None)
    if crop == "tomato" and (tomato_open_area is None or tomato_open_yield is None):
        return [], {"source_id": source["source_id"], "sheet": sheet, "reason": "No source-qualified open-field area/yield split"}
    found, excluded = [], []
    for row_index, row in enumerate(rows, 1):
        name = str(row.get(1, row.get(2, "")))
        code = aliases.get(re.sub("[^a-z0-9]", "", normalized(name)))
        if code is None:
            continue
        def reject(reason):
            excluded.append({"crop": crop, "region_id": code, "harvest_year": year,
                             "source_id": source["source_id"], "source_sheet": sheet, "source_row": row_index,
                             "province_name": name.strip(), "rejection_reason": reason,
                             "area_cell": f"{column_name(area_col)}{row_index}", "area_source_value": row.get(area_col),
                             "production_cell": f"{column_name(prod_col)}{row_index}", "production_source_value": row.get(prod_col)})
        area, production = number(row.get(area_col)), number(row.get(prod_col))
        if area is None:
            reject("missing_reported_area")
            continue
        if area <= 0:
            reject("nonpositive_reported_area")
            continue
        if production is None:
            reject("missing_reported_production")
            continue
        if production < 0:
            reject("negative_reported_production")
            continue
        original_area, original_production = area, production
        tomato_components = None
        if crop == "tomato":
            rain_area, open_area, protected_area = (number(row.get(c)) for c in (
                area_start, tomato_open_area, tomato_open_area + 1))
            parts = [rain_area, open_area, protected_area]
            if any(v is None for v in parts):
                # A dash is not assumed to be zero unless the explicit total
                # already reconciles exactly with every reported component.
                if abs(sum(v for v in parts if v is not None) - area) > 1e-6:
                    reject("missing_tomato_area_components")
                    continue
                rain_area, open_area, protected_area = [0.0 if v is None else v for v in parts]
            if abs(rain_area + open_area + protected_area - area) > 1.01:
                reject("inconsistent_tomato_area_components")
                continue
            rain_yield, open_yield = (number(row.get(c)) for c in (yield_start, tomato_open_yield))
            if (rain_area > 0 and rain_yield is None) or (open_area > 0 and open_yield is None):
                reject("missing_tomato_open_yield")
                continue
            area = rain_area + open_area
            if area <= 0:
                reject("no_reported_tomato_open_field_area")
                continue
            value = (rain_area * (rain_yield or 0) + open_area * (open_yield or 0)) / area / 1000
            production = None
            tomato_components = {"rainfed_area_ha": rain_area, "irrigated_open_area_ha": open_area,
                                 "excluded_protected_area_ha": protected_area,
                                 "rainfed_yield_kg_ha": rain_yield, "irrigated_open_yield_kg_ha": open_yield,
                                 "rainfed_area_cell": f"{column_name(area_start)}{row_index}",
                                 "open_area_cell": f"{column_name(tomato_open_area)}{row_index}",
                                 "rainfed_yield_cell": f"{column_name(yield_start)}{row_index}",
                                 "open_yield_cell": f"{column_name(tomato_open_yield)}{row_index}"}
        else:
            value = production / area
        if not 0 <= value <= (400 if crop == "tomato" else 150 if crop == "potato" else 30):
            raise ValueError(f"Implausible source yield at {source['source_id']} {sheet} row {row_index}: {value}")
        found.append({"crop": crop, "region_id": code, "province_code": code, "province_name": name.strip(),
                      "country_code": "ES", "harvest_year": year, "yield_t_ha": value,
                      "area_ha": area, "area_basis": "harvested" if harvested_starts else "reported_total_area",
                      "production_t": production,
                      "production_scope": "open_field_rainfed_and_irrigated" if crop == "tomato" else "all_reported_systems",
                      "yield_derivation": "area_weighted_reported_open_field_yield" if crop == "tomato" else "reported_production_per_reported_total_area",
                      "source_id": source["source_id"], "source_sheet": sheet, "source_row": row_index,
                      "area_cell": f"{column_name(area_col)}{row_index}",
                      "production_cell": f"{column_name(prod_col)}{row_index}",
                      "published_on": None, "verified_available_on": source["retrieved_on"]})
        if value == 0:
            found[-1]["zero_yield_source_audit"] = {
                "reported_yield_kg_ha_cells": {f"{column_name(c)}{row_index}": row.get(c)
                                               for c in range(yield_start, prod_col)},
                "interpretation": "The reported production/area ratio is zero; integer production rounding can also produce zero and is not proof of total crop failure."}
        if tomato_components:
            found[-1].update(tomato_components=tomato_components, reported_total_area_ha=original_area,
                             reported_total_production_t=original_production)
        if correction:
            found[-1]["source_correction"] = correction
    audit = {"source_id": source["source_id"], "sheet": sheet, "crop": crop, "harvest_year": year,
             "rows": len(found), "area_column": column_name(area_col), "production_column": column_name(prod_col),
             "area_basis": "harvested" if harvested_starts else "reported_total_area", "title": title,
             "excluded_rows": excluded, "exclusion_counts": dict(Counter(r["rejection_reason"] for r in excluded))}
    if correction:
        audit["source_correction"] = correction
    if modern_tomato_template:
        audit["unit_reference"] = {"source_url": "https://www.mapa.gob.es/dam/mapa/contenido/estadisticas/temas/estadisticas-agrarias/2.agricultura/3.-superficies-y-producciones-anuales/reglamento-n--543-2009/re1_hortalizas_formato_tabla_global_25.xlsx",
                                   "source_sha256": "a3b4918412eb52f4912c01a7eea7f01f59631938ec0102401ad5539dadcf28ec",
                                   "sheet": "TABLA PROVINCIAL CULTIVOS", "cells": "K11:N11 = ha; O11:Q11 = kg/ha; R11:U11 = t",
                                   "reason": "Annual modern tomato yearbook omits the printed unit row; the official same-format MAPA horticulture source supplies the measurement units"}
    return found, audit


def extract_sources(sources, output=None):
    aliases, records, audits = province_aliases(), [], []
    frozen_sources = ARTIFACTS / "mapa_sources.json"
    if output and Path(output).resolve() == (ARTIFACTS / "mapa_yields.json.gz").resolve() and frozen_sources.exists():
        expected_ids = {s["source_id"] for s in json.loads(frozen_sources.read_text())["sources"]}
        actual_ids = {s["source_id"] for s in sources if s["status"] == "downloaded"}
        if actual_ids != expected_ids:
            raise ValueError("Refusing to replace the frozen provincial release with an incomplete or unreviewed source set")
    for source in sources:
        if source["status"] != "downloaded":
            continue
        path = REPO / source["path"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]:
            raise ValueError(f"Raw source SHA-256 mismatch: {source['source_id']}")
        for sheet, rows in workbook_sheets(path):
            found, audit = extract_sheet(source, sheet, rows, aliases)
            records.extend(found)
            if audit:
                audits.append(audit)
    unique = {}
    for record in records:
        key = record["crop"], record["region_id"], record["harvest_year"]
        if key in unique:
            raise ValueError(f"Duplicate provincial yield label {key}")
        unique[key] = record
    records.sort(key=lambda row: (row["crop"], row["region_id"], row["harvest_year"]))
    result = {"schema_version": "1.0", "retrieved_on": max(source["retrieved_on"] for source in sources if source["status"] == "downloaded"), "country_code": "ES",
              "target_definition": "For nine crops, official annual production in tonnes divided by the source's reported total crop area in hectares. For tomato, the area-weighted official kg/ha yields of rainfed and irrigated open-field cultivation, divided by 1000; protected cultivation is excluded. Newer tables explicitly identify harvested area; older tables do not identify its basis.",
              "production_scope": "Nine crops combine reported production systems; tomato uses rainfed and irrigated open-field yields and excludes protected cultivation. Calendars remain historical monthly distributions that may combine production systems.",
              "target_unit": "t/ha",
              "publication_note": "Original historical publication dates are unknown. verified_available_on is actual retrieval, not a reconstructed historical vintage.",
              "sources": sources, "sheets": audits, "rows": records}
    if output:
        excluded = [row for audit in audits for row in audit.get("excluded_rows", [])]
        result["sheets"] = [{key: value for key, value in audit.items()
                             if key not in {"excluded_rows", "exclusion_counts"}} for audit in audits]
        raw = (json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode()
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        Path(output).write_bytes(gzip.compress(raw, mtime=0))
        exclusions = gzip.compress(json.dumps({"schema_version": "1.0", "rows": excluded}, ensure_ascii=False,
                                               separators=(",", ":"), allow_nan=False).encode(), mtime=0)
        Path(output).with_name("mapa_excluded_rows.json.gz").write_bytes(exclusions)
        zero_rows = [row for row in records if row["yield_t_ha"] == 0]
        source_zero_excluded = [row for row in excluded if (number(row["area_source_value"]) or 0) > 0
                                and number(row["production_source_value"]) == 0]
        crop_statistics = {}
        for crop in CROP_PATTERNS:
            selected = [row for row in records if row["crop"] == crop]
            ordered = sorted(selected, key=lambda row: row["yield_t_ha"])
            crop_statistics[crop] = {"rows": len(selected), "years": sorted({r["harvest_year"] for r in selected}),
                                     "provinces": len({r["region_id"] for r in selected}),
                                     "area_basis_counts": dict(Counter(r["area_basis"] for r in selected)),
                                     "lowest_three": ordered[:3], "highest_three": ordered[-3:]}
        summary = {"schema_version": "1.0", "label_snapshot_sha256": hashlib.sha256(Path(output).read_bytes()).hexdigest(),
                   "numeric_zero_yield_rows": zero_rows, "excluded_positive_area_numeric_zero_production_rows": source_zero_excluded,
                   "zero_policy": "Numeric zero is retained as a nonnegative reported yield; a dash/blank is missing and never converted to zero. No actual target table has positive area with numeric zero production in this frozen release.",
                   "excluded_row_counts": dict(Counter(row["rejection_reason"] for row in excluded)),
                   "excluded_rows_file": "mapa_excluded_rows.json.gz", "excluded_rows_sha256": hashlib.sha256(exclusions).hexdigest(),
                   "crop_statistics": crop_statistics,
                   "high_value_review": "The published grain sorghum series contains 18–20 t/ha values, including 2 ha in Huelva 2009. Faba bean contains 7 t/ha on 2 ha in Soria 2022. These source values were not clipped; small reported areas and historical reporting differences warrant experimental use."}
        Path(output).with_name("mapa_source_audit.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
        Path(output).with_name("mapa_sources.json").write_text(json.dumps({"schema_version": "1.0", "sources": sources}, ensure_ascii=False, indent=2) + "\n")
    return result


def fetch(url, path, *, limit=16_000_000):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        temporary = path.with_suffix(path.suffix + ".partial")
        result = subprocess.run(["curl", "--fail", "--silent", "--show-error", "--location",
                                 "--max-time", "180", "--max-filesize", str(limit), "--output",
                                 str(temporary), quote(url, safe=":/?=&%")],
                                capture_output=True, text=True)
        if result.returncode:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(result.stderr.strip())
        temporary.replace(path)
    return path.read_bytes()


def discover_yearbook(year):
    try:
        root_url = BASE + str(year)
        html = fetch(root_url, CACHE / f"{year}-index.html").decode()
        table = html.split("<table class='data-table", 1)[-1].split("</table>", 1)[0]
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S)
        chapter = next(row for row in rows if "SUPERFICIES Y PRODUCCIONES DE CULTIVOS" in row)
        chapter_links = re.findall(r"href=['\"]([^'\"]+)['\"]", chapter)
        query = unescape(next((link for link in chapter_links if "capitulo=" in link), chapter_links[0]))
        chapter_url = root_url + query if query.startswith("?") else urljoin(root_url, query)
        html = fetch(chapter_url, CACHE / f"{year}-chapter.html").decode()
        if "capitulo=" not in chapter_url:
            pieces = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)
            targets = [piece for piece in pieces if any(crop in piece for crop in (
                "CEREALES GRANO", "LEGUMINOSAS GRANO", "TUBERCULOS PARA CONSUMO HUMANO",
                "CULTIVOS INDUSTRIALES", "HORTALIZAS")) and "capitulo=" in piece]
            output = []
            for piece in targets:
                link = unescape(next(link for link in re.findall(r"href=['\"]([^'\"]+)['\"]", piece)
                                     if "capitulo=" in link))
                child_url = root_url + link if link.startswith("?") else urljoin(root_url, link)
                chapter_id = re.search(r"capitulo=(\d+)", child_url).group(1)
                content = fetch(child_url, CACHE / f"{year}-chapter-{chapter_id}.html").decode()
                output.append(download_chapter(year, root_url, child_url, content, suffix=f"-c{chapter_id}"))
            if not output:
                raise ValueError("No official crop-group workbooks were found")
            return output
        return [download_chapter(year, root_url, chapter_url, html)]
    except Exception as error:
        return [{"yearbook": year, "status": "unavailable", "reason": str(error)}]


def download_chapter(year, root_url, chapter_url, html, suffix=""):
        links = re.findall(r"<a\b([^>]+)>", html, re.I)
        source_url = next(unescape(re.search(r"href=['\"]([^'\"]+)['\"]", link).group(1))
                          for link in links if re.search(r"cap[ií]tulo completo en Excel", link, re.I))
        source_url = urljoin(root_url, source_url)
        extension = Path(source_url).suffix.lower()
        if extension not in {".xls", ".xlsx", ".zip"}:
            raise ValueError(f"Unsupported official workbook extension {extension}")
        path = CACHE / f"mapa-{year}{suffix}{extension}"
        raw = fetch(source_url, path)
        retrieved = date.today().isoformat()
        pinned_path = ARTIFACTS / "mapa_sources.json"
        if pinned_path.exists():
            pinned = json.loads(pinned_path.read_text())
            expected = next((record for record in pinned["sources"] if record["source_id"] == f"mapa-yearbook-{year}{suffix}"), None)
            if expected:
                if expected["sha256"] != hashlib.sha256(raw).hexdigest():
                    raise ValueError("Official source content differs from the reviewed frozen source; review a new version explicitly")
                retrieved = expected["retrieved_on"]
        return {"source_id": f"mapa-yearbook-{year}{suffix}", "yearbook": year, "index_url": root_url,
                "chapter_url": chapter_url, "url": source_url, "path": str(path.relative_to(REPO)),
                "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                "published_on": None, "retrieved_on": retrieved, "status": "downloaded"}


def workbook_sheets(path):
    """Yield sheets as (name, sparse cell rows); retain original row/cell IDs."""
    path = Path(path)
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as archive:
            for member in archive.namelist():
                if Path(member).suffix.lower() not in {".xls", ".xlsx"}:
                    continue
                extracted = CACHE / "extracted" / path.stem / Path(member).name
                extracted.parent.mkdir(parents=True, exist_ok=True)
                # Re-read the audited archive so a stale extracted cache cannot
                # bypass ZIP CRC verification or replace the pinned source.
                extracted.write_bytes(archive.read(member))
                for name, rows in workbook_sheets(extracted):
                    yield member + "::" + name, rows
        return
    if path.suffix == ".xls":
        try:
            import xlrd
        except ImportError as error:
            raise RuntimeError("Reading historical .xls needs xlrd==2.0.2") from error
        book = xlrd.open_workbook(path, logfile=io.StringIO())
        for sheet in book.sheets():
            yield sheet.name, [{i + 1: value for i, value in enumerate(sheet.row_values(row))
                                if value != ""} for row in range(sheet.nrows)]
        return
    with zipfile.ZipFile(path) as archive:
        strings = (["".join(si.itertext()) for si in ET.fromstring(archive.read("xl/sharedStrings.xml"))
                    .findall(NS + "si")] if "xl/sharedStrings.xml" in archive.namelist() else [])
        relations = {item.attrib["Id"]: item.attrib["Target"]
                     for item in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        for item in ET.fromstring(archive.read("xl/workbook.xml")).findall(NS + "sheets/" + NS + "sheet"):
            relation = item.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            target = relations[relation]
            member = target.lstrip("/") if target.startswith("/") else "xl/" + target
            rows = []
            for row in ET.fromstring(archive.read(member)).findall(NS + "sheetData/" + NS + "row"):
                while len(rows) < int(row.attrib["r"]):
                    rows.append({})
                fields = rows[int(row.attrib["r"]) - 1]
                for cell in row.findall(NS + "c"):
                    letters = re.match("[A-Z]+", cell.attrib["r"]).group()
                    index = 0
                    for char in letters:
                        index = index * 26 + ord(char) - 64
                    value = cell.findtext(NS + "v")
                    if cell.attrib.get("t") == "s" and value is not None:
                        value = strings[int(value)]
                    elif cell.attrib.get("t") == "inlineStr":
                        value = "".join(cell.find(NS + "is").itertext())
                    if value is not None:
                        fields[index] = value
            yield item.attrib["name"], rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-yearbook", type=int, default=2006)
    parser.add_argument("--end-yearbook", type=int, default=2025)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--extract-only", action="store_true")
    args = parser.parse_args()
    if args.extract_only:
        records = json.loads((CACHE / "sources.json").read_text())
    else:
        with ThreadPoolExecutor(max_workers=min(4, args.workers)) as pool:
            records = [record for batch in pool.map(discover_yearbook, range(args.start_yearbook, args.end_yearbook + 1))
                       for record in batch]
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / "sources.json").write_text(json.dumps(records, ensure_ascii=False, indent=2))
    print(json.dumps([{k: r[k] for k in ("yearbook", "status", "bytes", "reason") if k in r}
                      for r in records], indent=2))
    if args.extract or args.extract_only:
        data = extract_sources(records, ARTIFACTS / "mapa_yields.json.gz")
        print(json.dumps({"label_rows": len(data["rows"]), "crops": sorted({row["crop"] for row in data["rows"]}),
                          "rejected_sheets": [row for row in data["sheets"] if "reason" in row]}, indent=2))


if __name__ == "__main__":
    main()
