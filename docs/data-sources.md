# Data sources and reproducibility

Reviewed 15 November 2026. [Third-party notices](../THIRD_PARTY_NOTICES.md)
describe reuse conditions; [AI usage](../AI_USAGE.md) describes assistance and
generated artwork. Provider observations and official yield labels are not
AI-generated training labels.

## What uses each source

| Working component | Data actually used | Scope and reproducible record |
| --- | --- | --- |
| Field environmental collection | NASA POWER daily series, ISRIC SoilGrids, Natural Earth country lookup, FAO/Sacks/GGCMI calendar candidates | Gridded/regional context for the supplied boundary, with source status, dates, units and hashes. [Sources](../agronomy/field-data.md), [six-country collection check](../agronomy/field-data-validation.md). Missing values stay missing. |
| Ten national annual-history models | FAOSTAT QCL annual yield history through 2024 | Country level. They do not use NASA weather and are not field or in-season environmental estimates. [Source identity, citation and reproduction](../yield_prediction/docs/national_models.md). |
| Twenty Spanish provincial models | Actual MAPA 2004–2024 yield labels, MAPA 2014–2016 monthly calendars and NASA POWER monthly observations at a fixed interior point per province | Ten crops × pre-season/mid-season. Experimental province point-proxy estimates, not crop-mask or field accuracy. [Training/inference limits](../yield_prediction/docs/province_models.md), [source-cell and unit audit](../yield_prediction/docs/provincial_sources.md), [calendar variants](../yield_prediction/docs/mapa_calendars.md). |
| Eight original/candidate regional models | CY-Bench 1.10 crop statistics, crop-mask meteorology, soil and calendars for wheat/maize | Separate regional contract. The bundled ES112 pre-season 2026 replay uses real 2019–2023 climatology; it does not establish current mid-season weather coverage. [Bundled release](../yield_prediction/docs/published_regional_inputs.md), [evaluation](../yield_prediction/reports/model_evaluation.md). |
| Gridded-data preparation | Authenticated official CDS AgERA5 v2.0 download, NetCDF unit/hash verification and crop-mask aggregation | A separate reproducible regional-data path. A successful small access test does not supply every missing crop/year/region. [CDS setup, real access evidence and limitations](../agronomy/copernicus-data.md). |
| Crop-water and rotation rules | FAO-56 revision 1 (2025), crop-specific extension sources and farmer observations | Rules, historical water screens and conditional irrigation calculations are distinct from the ML yield estimators. [Reference audit](../agronomy/data-audit.md), [equations](../agronomy/scoring-and-water.md), [versioned source records](../agronomy/crop_profiles.json). |

## Frozen evidence to retain

The repository intentionally includes compact real source snapshots, all 38
estimator weights and metadata, evaluation reports, representative inference
inputs and source audits. They establish where the predictions came from and
allow checks without downloading large archives. They are not temporary files.

For the provincial release, keep `mapa_yields.json.gz`,
`mapa_excluded_rows.json.gz`, `mapa_source_audit.json`, `provinces.json`,
the source manifest, monthly weather snapshot, model metadata and
`artifacts/reference/mapa_calendars_2014_2016.json`. The extraction explicitly
preserves missing-versus-zero semantics, source-cell references, older reported
area versus modern harvested-area denominators and the open/protected tomato
distinction. See the linked source audit before interpreting the target as
farm yield.

Raw external archives, CDS credentials, provider caches, virtual environments
and generated deployment/build directories remain ignored. Source URLs,
checksums, access dates and download commands remain versioned. Never publish
`.cdsapirc`, tokens or private request headers as provenance.

The removed sprite ZIP and embedded Figma SVG are reproducible exports. Their
source sheets, prompts, manifests, extraction code and board generator remain
in `brand/sprites/crops-v1/`; regenerate an export locally when needed.

## Citations and licence records

Use [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) as the submission source
index. Keep dataset-specific citations in addition to this index:

- NASA POWER: NASA Langley Research Center, POWER project, NASA Earth Science
  Division; actual daily/monthly service version and access date from the
  response metadata. [Official referencing guidance](https://power.larc.nasa.gov/docs/referencing/).
- FAOSTAT QCL: FAO, 2025; accessed 15 November 2026; CC BY 4.0 subject to
  [database terms](https://www.fao.org/contact-us/terms/db-terms-of-use/en/).
- MAPA: statistical yearbooks 2006–2025, target harvest years 2004–2024, and
  2014–2016 sowing/harvest calendars; accessed 15 November 2026. The source
  manifest preserves each original workbook URL/hash and corrections.
- CY-Bench: Kallenberg et al., [2026 paper](https://doi.org/10.5194/essd-18-3997-2026)
  and [release 1.10](https://zenodo.org/records/17279151), EUPL-1.2 as recorded
  by the publisher, plus the original national-statistics/component citations.
- AgERA5: Copernicus Climate Change Service / ECMWF,
  [DOI 10.24381/cds.6c68c9bb](https://doi.org/10.24381/cds.6c68c9bb), v2.0,
  CC BY 4.0; retain access dates and acknowledge project transformations.
- SoilGrids: ISRIC – World Soil Information, SoilGrids 2.0, CC BY 4.0;
  [product page](https://isric.org/explore/soilgrids).
- FAO crop-water coefficients: Santos Pereira et al., 2025,
  [DOI 10.4060/cd6621en](https://doi.org/10.4060/cd6621en), CC BY 4.0.
- Sacks et al. 2010, [DOI 10.1111/j.1466-8238.2010.00551.x](https://doi.org/10.1111/j.1466-8238.2010.00551.x);
  [SAGE source documentation](https://sage.nelson.wisc.edu/data-and-models/datasets/crop-calendar-dataset/).
  An explicit standalone reuse licence was not established in the reviewed page/readme.
- GGCMI Phase 3 v1.01: [publisher record](https://zenodo.org/records/5062513),
  CC BY 4.0. CropHarvest v8 validation inputs: [publisher record](https://zenodo.org/records/5533193),
  CC BY-SA 4.0. These are distinct datasets with distinct conditions.
- Country geography: Natural Earth 5.1.2, public domain.
  Current Spanish selection geometry: official IGN WFS, CC BY 4.0,
  **Obra derivada de Unidades Administrativas (IGN), consulta 2026-11-15, CC-BY 4.0 ign.es**.
  Original GISCO/CY-Bench geography remains a historical source reference,
  without redistributing its polygons as the current selection boundaries.

## Boundary-source assessment

The current frozen 50-province lookup and Lugo/ES112 selection geometry use
Spain's official IGN WFS under CC BY 4.0, independently acquired and converted
from EPSG:4258. The [geography release and audit](../yield_prediction/docs/ign_geography.md)
record the actual 53-source-unit to 50-province code crosswalk, original GML
hash, transformations, simplification and geodesic area changes. All 50 fixed
NASA sampling points remain unchanged and lie inside both the original and
released IGN polygons. The release contains no silent geometry repairs.

**Obra derivada de Unidades Administrativas (IGN), consulta 2026-11-15,
CC-BY 4.0 ign.es.** Preserve this attribution and the declared precision policy
when using these adapted lookup boundaries. [Official IGN data policy](https://www.ign.es/web/ign/portal/politica-datos)
· [Use licence](https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf).

The former GISCO polygon coordinates were replaced, while the historical
source citations and original point-selection definition remain visible.
ES112's IGN boundary is an independent administrative selection boundary, not
a new crop-mask weather aggregation. The original CY-Bench inputs and their
provenance remain unchanged. This distinction is required to reproduce the
models and avoid claiming that their training data used a new geometry.
