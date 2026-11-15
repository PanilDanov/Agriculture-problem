"""Checks of the audited calendar snapshot without network or private caches."""
import json
from pathlib import Path


PATH = Path(__file__).resolve().parents[1] / "artifacts/reference/mapa_calendars_2014_2016.json"


def snapshot():
    return json.loads(PATH.read_text())


def record(crop, province):
    return next(row for row in snapshot()["records"] if row["crop_id"] == crop and row["province_code"] == province)


def test_all_ten_crops_have_fifty_provinces_and_a_separate_country_total():
    data = snapshot()
    keys = {(row["crop_id"], row["province_code"]) for row in data["records"]}
    assert len(keys) == len(data["records"]) == 510
    assert len(data["province_codes"]) == 50
    assert all((crop, code) in keys for crop in {crop for crop, _ in keys} for code in [*data["province_codes"], "ES"])
    assert len(data["sources"]) == 5
    assert all(len(source["sha256"]) == 64 and source["url"].startswith("https://www.mapa.gob.es/") for source in data["sources"])


def test_published_sorghum_cells_keep_months_percentages_and_units():
    # Source: cerealesgrano.xlsx / Sorgo / A11:N12, checked in original XML.
    lugo = record("sorghum", "27")
    assert lugo["sowing_total_ha"] == 152
    assert lugo["harvest_total_t"] == 912
    assert lugo["sowing_monthly_pct"] == [0, 0, 0, 0, 50, 50, 0, 0, 0, 0, 0, 0]
    assert lugo["harvest_monthly_pct"] == [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 0, 0]
    assert {row["source_cells"] for row in lugo["variant_records"]} == {"A11:N11", "A12:N12"}
    assert record("sorghum", "ES")["sowing_total_ha"] == 8185


def test_zero_surface_does_not_become_a_guessed_calendar():
    row = record("barley", "33")
    assert row["calendar_status"] == "no_nonzero_complete_calendar"
    assert row["sowing_monthly_pct"] is None
    assert row["harvest_monthly_pct"] is None
    for row in snapshot()["records"]:
        if row["calendar_status"] == "available":
            for operation in ("sowing", "harvest"):
                profile = row[f"{operation}_monthly_pct"]
                assert len(profile) == 12
                assert all(0 <= value <= 100 for value in profile)
                assert 94 <= sum(profile) <= 106


def test_broad_targets_keep_variants_and_unknown_publication_dates_explicit():
    data = snapshot()
    assert len(record("barley", "ES")["variant_records"]) == 4
    assert len(record("potato", "ES")["variant_records"]) == 8
    tomatoes = [row for row in data["records"] if row["crop_id"] == "tomato"]
    assert all(row["production_scope"] == "mixed_open_field_and_protected_unsplit" for row in tomatoes)
    assert all(any("do not describe this target as specific to open-field tomato" in warning for warning in row["warnings"]) for row in tomatoes)
    assert all(source["published_on"] is None for source in data["sources"])
    assert data["date_precision"].startswith("month;")
    assert data["representative_date_policy"]["status"] == "model_convention_not_a_source_measurement"
