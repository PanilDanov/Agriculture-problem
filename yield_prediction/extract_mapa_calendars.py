"""Audit MAPA's published 2014–2016 monthly calendars; no field dates inferred.

Reads original XLSX XML with the standard library. Downloads are public MAPA
workbooks; preserve them separately and pass their containing directory. Example:
python extract_mapa_calendars.py --input .data/regional-expansion/calendars \
  --province-names .data/regional-expansion/province_ine_names.json
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import posixpath
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

BASE_URL = "https://www.mapa.gob.es/dam/mapa/contenido/estadisticas/temas/estadisticas-agrarias/2.agricultura/8.-calendarios_siembras-recoleccion/calendario-2014-2016/cultivos/"
INDEX_URL = "https://www.mapa.gob.es/es/estadistica/temas/estadisticas-agrarias/agricultura/calendarios-siembras-recoleccion/"
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
GROUPS = {
    "cerealesgrano.xlsx": {
        "wheat": ["Trigo duro", "Trigo semiduro y blando"],
        "barley": ["Cebada caballar (seis carreras)", "Cebada cervecera (dos carreras)"],
        "maize": ["Maíz híbrido", "Otro maíz"], "sorghum": ["Sorgo"],
    },
    "leguminosasgrano.xlsx": {"chickpea": ["Garbanzos"], "lentil": ["Lentejas"], "faba-bean": ["Habas secas"]},
    "cultivosindustriales.xlsx": {"sunflower": ["Girasol"]},
    "tuberculosparaconsumohumano.xlsx": {"potato": ["Patata extratemprana", "Patata temprana", "Patata media estación", "Patata tardía"]},
    "hortalizas.xlsx": {"tomato": ["Tomate rec 1-I al 31-V", "Tomate rec 1-VI al 30-IX", "Tomate rec 1-X al 31-XII", "Tomate para conserva"]},
}


def normalized(value: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().upper())


def workbook(path: Path):
    archive = zipfile.ZipFile(path)
    shared = ["".join(node.itertext()) for node in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)]
    relations = {node.attrib["Id"]: posixpath.normpath("xl/" + node.attrib["Target"]) for node in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
    sheets = {}
    for node in ET.fromstring(archive.read("xl/workbook.xml")).findall("s:sheets/s:sheet", NS):
        rid = node.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
        rows = []
        for row in ET.fromstring(archive.read(relations[rid])).findall("s:sheetData/s:row", NS):
            cells = {}
            for cell in row.findall("s:c", NS):
                value = cell.find("s:v", NS)
                if value is not None:
                    cells[re.sub(r"\d", "", cell.attrib["r"])] = shared[int(value.text)] if cell.attrib.get("t") == "s" else float(value.text)
            if cells:
                rows.append((int(row.attrib["r"]), cells))
        sheets[node.attrib["name"]] = rows
    core = ET.fromstring(archive.read("docProps/core.xml"))
    props = {name: core.findtext("{http://purl.org/dc/terms/}" + name) for name in ("created", "modified")}
    archive.close()
    return sheets, props


def extract(input_dir: Path, province_names: dict[str, str]) -> dict:
    province_map = {normalized(name): code for code, name in province_names.items()}
    # Verbatim calendar headings -> current INE names from the official MAPA DB.
    aliases = {"ÁLAVA": "01", "GUIPÚZCOA": "20", "VIZCAYA": "48", "PRINCIPADO DE ASTURIAS": "33", "COMUNIDAD FORAL DE NAVARRA": "31", "ILLES BALEARES": "07", "COMUNIDAD DE MADRID": "28", "REGIÓN DE MURCIA": "30", "TOTAL NACIONAL": "ES"}
    province_map.update({normalized(name): code for name, code in aliases.items()})
    sources, variants = [], []
    for filename, crops in GROUPS.items():
        path = input_dir / filename
        sheets, props = workbook(path)
        sources.append({"id": filename, "url": BASE_URL + filename, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "reference_period": "2014–2016", "published_on": None,
                        "workbook_created_at": props["created"], "workbook_modified_at": props["modified"],
                        "note": "Workbook properties are file metadata, not a verified publication date. Web Last-Modified is not a new statistical vintage."})
        for crop_id, sheet_names in crops.items():
            for sheet_name in sheet_names:
                rows = sheets[sheet_name]
                assert "2014-2016" in rows[0][1]["A"], (filename, sheet_name, "wrong vintage")
                header = dict(rows)[5]
                assert [header.get(chr(ord("C") + i)) for i in range(12)] == ["Ene.", "Feb.", "Mar.", "Abr.", "May", "Jun.", "Jul.", "Ago.", "Sep.", "Oct.", "Nov", "Dic."]
                region = None
                for row_number, row in rows:
                    label = row.get("A")
                    if not isinstance(label, str) or row_number < 6:
                        continue
                    if not label.startswith(("A-Siembra", "B-Recolección", "C-Comercialización")):
                        region = {"code": province_map.get(normalized(label)), "calendar_name": label.strip()}
                        continue
                    if not region or not region["code"] or label.startswith("C-Comercialización"):
                        continue
                    operation = "sowing" if label.startswith("A-Siembra") else "harvest"
                    values = [row.get(chr(ord("C") + i)) for i in range(12)]
                    assert all(value is None or isinstance(value, (int, float)) and 0 <= value <= 100 for value in values)
                    variants.append({"crop_id": crop_id, "province_code": region["code"], "calendar_region_name": region["calendar_name"],
                        "source_id": filename, "sheet": sheet_name, "operation": operation,
                        "total": row.get("B"), "total_unit": "ha" if operation == "sowing" else "t",
                        "monthly_pct": values, "published_pct_sum": sum(value for value in values if value is not None),
                        "source_cells": f"A{row_number}:N{row_number}"})
    records = []
    for crop_id in sorted({v["crop_id"] for v in variants}):
        for code in [*sorted(province_names), "ES"]:
            rows = [v for v in variants if v["crop_id"] == crop_id and v["province_code"] == code]
            assert len(rows) == 2 * sum(len(crops.get(crop_id, [])) for crops in GROUPS.values()), (crop_id, code, "missing source rows")
            record = {"crop_id": crop_id, "province_code": code, "province_name": province_names.get(code, "España"),
                "source_ids": sorted({v["source_id"] for v in rows}), "variant_records": rows,
                "production_scope": "mixed_open_field_and_protected_unsplit" if crop_id == "tomato" else "all_published_variants_unsplit_management",
                "warnings": ["A 2014–2016 statistical monthly distribution is a province-level historical reference, not observed field phenology.",
                    "An empty month in an otherwise populated source distribution contributes zero to the published monthly profile; a wholly empty or zero-total profile cannot establish a calendar.",
                    "Sowing shares are weighted by area and harvest shares by production. They are separate marginal distributions, not matched sowing/harvest cohorts."]}
            if crop_id == "tomato":
                record["warnings"].append("The calendar combines harvest-season and processing categories without an open-field/protected-production split; do not describe this target as specific to open-field tomato.")
            for operation in ("sowing", "harvest"):
                selected = [v for v in rows if v["operation"] == operation and v["total"] is not None and v["total"] > 0]
                total = sum(v["total"] for v in selected)
                complete = bool(selected) and all(94 <= v["published_pct_sum"] <= 106 for v in selected)
                record[f"{operation}_total_{'ha' if operation == 'sowing' else 't'}"] = total
                record[f"{operation}_monthly_pct"] = [sum(v["total"] * (v["monthly_pct"][month] or 0) for v in selected) / total for month in range(12)] if complete else None
            record["calendar_status"] = "available" if all(record[f"{operation}_monthly_pct"] is not None for operation in ("sowing", "harvest")) else "no_nonzero_complete_calendar"
            records.append(record)
    return {"schema_version": "mapa-monthly-calendars-v1", "dataset": "MAPA Calendario de Siembra, Recolección y Comercialización 2014–2016",
        "source_index": INDEX_URL, "reference_period": "2014–2016", "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "source_months": list(range(1, 13)), "province_codes": province_names, "sources": sources,
        "aggregation_method": "For each published crop variant: retain the original B total and C:N monthly percentages with exact worksheet/cell references. Aggregate variants by their published sowing-area or harvested-production totals; preserve rounding and do not rescale percentages. Keep missing/zero-total calendars unavailable.",
        "date_precision": "month; no observed sowing or harvest day is published",
        "representative_date_policy": {"name": "modal-month-scenario-v1", "status": "model_convention_not_a_source_measurement",
            "rule": "Select the month with the largest aggregate sowing share and the month with the largest aggregate harvest share (first calendar month wins a tie). A scenario may use the first sowing-month day and last harvest-month day; if sowing month exceeds harvest month, sowing belongs to the previous year. These are broad representative province scenarios, not observed crop dates."},
        "temporal_limitations": ["The source describes 2014–2016, with workbook properties dated 2019. A verified original release day was not established.",
            "Using this fixed calendar for earlier training years is a retrospective calendar assumption, not evidence of an operational forecast issued in those years.",
            "Crop-specific masks, field-level sowing dates and changing annual phenology are not supplied by these tables."],
        "records": records}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--province-names", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("yield_prediction/artifacts/reference/mapa_calendars_2014_2016.json"))
    args = parser.parse_args()
    result = extract(args.input, json.loads(args.province_names.read_text()))
    assert len(result["records"]) == 510
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "records": len(result["records"]),
        "available_by_crop": dict(Counter(row["crop_id"] for row in result["records"] if row["calendar_status"] == "available")),
        "sources": len(result["sources"])}, indent=2))
