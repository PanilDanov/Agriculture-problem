# Official provincial yield sources

The frozen MAPA release contains **8,885 observed province/crop/year labels**, all ten project crops and every harvest year from **2004 through 2024**. It is a Spanish provincial statistical dataset. It does not establish yield accuracy for an individual farm or coverage outside Spain.

The portable snapshot is `artifacts/provincial/mapa_yields.json.gz` (241,777 bytes), SHA-256 `e13a6868e273badcc68b8182fb09ac8bf8786092c8670d6821adeb05d2e105aa`. `mapa_sample.json` provides 20 readable examples with their exact source sheets and cells. `mapa_sources.json` pins the URLs, sizes and SHA-256 hashes of 28 original MAPA workbooks/ZIP archives (65,540,959 bytes total). The source workbooks are ignored under `.data/regional-expansion/yearbooks/`.

Sources were discovered from the [MAPA statistical yearbook](https://www.mapa.gob.es/es/estadistica/temas/publicaciones/anuario-de-estadistica) navigation. The 2006 yearbook includes provincial tables for 2004 and 2005; subsequent releases supply the remaining years through 2024. Chapter numbers, workbook formats and table order change between editions. Extraction uses the actual crop, province, year and measurement headers. It does not assume that the same filename identifies the same table in every yearbook. The separate provisional 2025 workbooks are **not** training labels in this snapshot.

| Crop | Exact MAPA broad crop identity | Positive labels | Provinces with at least 10 consecutive years |
|---|---|---:|---:|
| Wheat | Trigo: common/soft and durum; CE1100 in the current crop coding | 1,008 | 48 |
| Barley | Cebada, all grain types; CE1300 | 979 | 46 |
| Maize | Maíz grano, including hybrid and other grain maize; CE1500 | 1,037 | 49 |
| Sorghum | Sorgo grano; CE1700 | 592 | 24 |
| Chickpea | Garbanzos, dry grain; LG1400 | 892 | 41 |
| Lentil | Lentejas, dry grain; LG1500 | 723 | 30 |
| Faba bean | Habas secas, human and animal uses; LG1200 | 775 | 31 |
| Sunflower | Girasol seed; IN1200 | 829 | 38 |
| Potato | Patata, combined harvest windows; TH1100 | 1,048 | 50 |
| Tomato | Tomate, rainfed and irrigated open cultivation; broad source HO2500 with protected cultivation excluded below | 1,002 | 49 |

Sweet maize, forage maize/sorghum, buckwheat, green faba beans, and overlapping crop subtypes are excluded. Crop codes above document exact identities in MAPA's current source system; historical tables are identified by their own names and headers.

## Units and target definitions

For nine crops, the target is source production in **tonnes divided by the source total crop area in hectares**. Older tables only label the denominator `Superficie`; these rows retain `area_basis=reported_total_area`. The 2023–2024 tables explicitly provide harvested area, retained as `area_basis=harvested`. This reporting change is preserved and must appear in model limitations. Earlier denominators are not relabelled as harvested area.

Tomato has a more specific target. Every selected format separates rainfed, irrigated open-field and protected areas, and their reported yields in kg/ha. The open-field target is:

`yield_t_ha = (rainfed_area_ha × rainfed_yield_kg_ha + irrigated_open_area_ha × irrigated_open_yield_kg_ha) / (rainfed_area_ha + irrigated_open_area_ha) / 1000`

Protected cultivation is excluded. Open-field harvested production is not separately observed, so `production_t` is null; the original combined production remains `reported_total_production_t`. Each component retains source-cell references. Older tomato area bases remain qualified as above. The modern tomato yearbook omits its printed unit row; the audited official companion horticulture workbook supplies the identical format's ha/kg-ha/tonne units. Its URL, SHA-256 and unit cells are recorded in the table audit. FAOSTAT's separate national tomato model still has a mixed-system target.

`mapa_source_audit.json` records all crop minima/maxima and the three largest/smallest values with their source cells. Published grain sorghum values of 18–20 t/ha and a 7 t/ha faba-bean value on 2 ha were retained and flagged for caution. They were not clipped or replaced. They reinforce the experimental status of the provincial models.

## Missing values, zeros and source corrections

Numeric zero and a source dash/blank have different meanings. The extractor retains genuine numeric zero targets. In this frozen release, a full audit of all 210 selected tables found **zero** cases of positive reported area with numeric zero production, including excluded rows, and zero open-tomato target zeros. Thus the published positive-target snapshot loses no observed zero labels. Integer production rounding would not by itself establish complete crop failure.

`mapa_excluded_rows.json.gz` preserves 997 excluded source rows with crop, province, year, source cells, raw values and rejection reason: 782 missing-area rows, 157 nonpositive-area rows, 26 missing-production rows, 15 missing-open-tomato-yield rows, 16 rows with no reported open-tomato area, and one inconsistent tomato area split. Missing production is never filled with zero. The audit binds this file and the label snapshot by SHA-256.

Two chickpea year headers required explicit reviewed corrections:

* Yearbook 2023, XLSX table `7.2.5.2`, prints 2021. The [official companion PDF](https://www.mapa.gob.es/estadistica/pags/anuario/2023/FORMATO%20PDF/AE23-C07/CAP%C3%8DTULO%207.pdf), printed pages 284–285, identifies the matching province records as 2022. The national source totals are 36,076 ha and 31,403 t. The downloaded PDF SHA-256 is `cdb616acb2e6759244fcad738aa522a4dd46fda7d95e8b6df37bd9dea75ea148`.
* Yearbook 2024, table `7.2.5.1`, prints 2024 in both XLSX and PDF. Its national harvested totals `J87=63268 ha`, `N87=49722 t` exactly match the same workbook's explicitly dated 2023 historical-series cells `B18`, `C18=63.268 thousand ha`, `E18=49.722 thousand t`. The 2025 historical series independently repeats those 2023 totals. The table is assigned harvest year 2023, with the original header and the reconciliation recorded as `source_correction`.

The extractor checks the reviewed national totals before applying either correction. It fails on duplicate province/crop/year labels. Historical publication dates are unknown and remain null. `verified_available_on=2026-11-15` records actual retrieval. Temporal holdout is retrospective by harvest year and is not a reconstructed operational publication-vintage backtest.

## Geography, calendars and crop masks

`provinces.json` contains all 50 Spanish INE province codes (`01`–`50`) and the independently acquired official IGN administrative polygons under CC BY 4.0. The actual 53-unit source response maps directly through official `nationalCode`; Ceuta, Melilla and nonassigned territories are explicitly excluded from this model's scope. [Source, crosswalk, CRS, simplification and per-province area audit](ign_geography.md). Attribution: **Obra derivada de Unidades Administrativas (IGN), consulta 2026-11-15, CC-BY 4.0 ign.es.**

The fixed NASA weather points retain their original coordinates and historical selection definition. All 50 are verified inside both original and released IGN geometry; none was recomputed or relabelled as an IGN centroid. They are **not crop-area-weighted centroids or field measurements**. The original source identity, coordinate conversions, declared angular precision and resulting area changes remain in the versioned audit. The current registry no longer distributes the earlier GISCO province polygons; its historical role remains documented rather than reassigned to IGN.

The [official MAPA calendar](https://www.mapa.gob.es/es/estadistica/temas/estadisticas-agrarias/agricultura/calendarios-siembras-recoleccion/) covers 159 crop categories with monthly provincial distributions averaged over 2014–2016. The separate `artifacts/reference/mapa_calendars_2014_2016.json` preserves source variants and monthly percentages. It is a historical statistical calendar, not the observed sowing date of a target field. Tomato calendar variants are not separated by open/protected cultivation; that calendar limitation remains even though the yield target excludes protected cultivation.

The source audit also checked generic public masks. SAGE supplies a generic pulses calendar rather than distinct chickpea/lentil/faba calendars and has no tomato calendar. EUCROPMAP groups dry pulses and other cereals rather than identifying all ten crops separately. Newer ITACyL maps distinguish chickpea/lentil in Castilla y León, but they do not supply consistent exact masks for all ten crops across Spain and all source years. No generic pulse/cropland mask is presented as an exact crop mask. The new province-point NASA contract is distinct from the existing crop-mask regional AgERA5 contract.

## Eurostat comparison and reproduction

The anonymous [Eurostat APRO_CPSHR endpoint](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/apro_cpshr?lang=EN&geo=ES61&time=2023) was checked directly. Verified regional crop codes are barley `C1300`, sorghum `C1700`, faba bean `P1200`, potato `R1000`, sunflower `I1120`. Chickpea and lentil are pooled into `P9000` with other pulses; tomato has no separate category in this regional table. Direct regional yield is absent for the ES61 sample, although source area and production are available. The two small unmodified JSON samples and their hash/URL manifest are in `artifacts/reference/eurostat_*.json`. These mixed-category samples are not training labels.

To reproduce the frozen MAPA extraction from the original sources:

```sh
.venv-api/bin/python -m pip install -r yield_prediction/requirements-source-data.txt
.venv-api/bin/python yield_prediction/prepare_provincial_data.py --extract
```

For already downloaded source files, use `--extract-only`. The parser uses standard-library XML/ZIP handling for XLSX and pinned `xlrd==2.0.2` for legacy XLS; Excel formulas are not executed. The reviewed source manifest prevents a changed upstream file or an incomplete source set from silently replacing the frozen release. Downloaded files and extracted labels are checked against source hashes, and ZIP CRCs are validated during reading. Source-format regression tests use real old and modern table excerpts, including the tomato split and zero-vs-missing handling.

Data attribution: Ministerio de Agricultura, Pesca y Alimentación (MAPA), statistical yearbooks 2006–2025, accessed 15 November 2026. Preserve the linked source metadata and original reporting limitations when reusing the labels.
