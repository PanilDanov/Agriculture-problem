# Licensing and third-party notices

Copyright 2026 orbitFarm contributors. The project's original source code,
tests, scripts and documentation are licensed under the [Apache License 2.0](LICENSE).
This grant covers only rights held by the contributors. It does not relicense
external datasets, downloaded libraries, fonts, map tiles, source publications,
or their retained material in derived files. Original artwork and the role of
AI are documented in [AI usage](AI_USAGE.md) and [asset provenance](docs/asset-provenance.md).
No NASA name, insignia or endorsement rights are granted.

## Data and model exceptions

The checked-in data snapshots and model weights retain their source provenance
and applicable source conditions. Apache-2.0 on the surrounding implementation
does not establish that every model or dataset is unrestricted. Keep the source
manifests, metadata, citations and limitations when redistributing these files.

| Source / material | Use in orbitFarm | Source conditions and attribution |
| --- | --- | --- |
| NASA Langley POWER | Daily environmental context and frozen monthly point-proxy weather used by the Spanish provincial models | Public NASA data service. Credit NASA Langley Research Center's POWER project, funded through NASA's Earth Science Division; retain the actual service version and access date in each response/snapshot. See the [POWER referencing guide](https://power.larc.nasa.gov/docs/referencing/). No NASA endorsement is implied. |
| FAO FAOSTAT QCL | Ten national annual-history training snapshots and models | FAO. 2025. FAOSTAT: Crops and livestock products (QCL), accessed 15 November 2026. CC BY 4.0, subject to the [FAO Statistical Database Terms of Use](https://www.fao.org/contact-us/terms/db-terms-of-use/en/). Project filtering/training are adaptations; FAO does not endorse the predictions. [National provenance](yield_prediction/docs/national_models.md). |
| Ministerio de Agricultura, Pesca y Alimentación (MAPA), Spain | Provincial 2004–2024 yield labels, 2014–2016 calendars and their derived provincial models | Cite MAPA, the yearbook/calendar edition and original URL. [MAPA legal notice](https://www.mapa.gob.es/es/atencion-al-ciudadano/aviso-legal) permits reuse with source acknowledgement, subject to third-party rights and preservation of relevant metadata. We do not assign an invented CC licence to the workbooks. Extraction corrections, area-basis changes and source cells remain in the frozen audit. [Label provenance](yield_prediction/docs/provincial_sources.md), [calendar provenance](yield_prediction/docs/mapa_calendars.md). |
| CY-Bench 1.10, Kallenberg et al. | Eight wheat/maize estimator artifacts, examples and the ES112 frozen regional input release | The [publisher's record](https://zenodo.org/records/17279151) identifies EUPL-1.2. Cite Kallenberg et al., *CY-Bench: a comprehensive benchmark dataset for sub-national crop yield forecasting*, [DOI 10.5194/essd-18-3997-2026](https://doi.org/10.5194/essd-18-3997-2026), and the corresponding national-statistics sources identified by the release. Component data retain their own conditions, including the GISCO boundary conditions below. This is not a blanket Apache relicensing of the dataset or its derivatives. |
| Eurostat / GISCO NUTS 2016 and 2024, EuroGeographics | ES112 boundary verification; Spanish province polygons assembled from NUTS3 and copied into runtime registries/model provenance | **Noncommercial use only under the specific GISCO statistical-unit conditions. © EuroGeographics for the administrative boundaries.** Preserve this notice in electronic/printed publications and map legends using these data. Commercial reuse requires a separate agreement. [Exact official terms](https://ec.europa.eu/eurostat/en/web/gisco/geodata/statistical-units). See the affected files and submission qualification below. |
| Natural Earth 5.1.2 | Country lookup and FAO M49/ISO2 crosswalk | [Public domain](https://www.naturalearthdata.com/about/terms-of-use/). Made with Natural Earth. Preserve the pinned-file URL/hash for scientific reproducibility. |
| ISRIC SoilGrids 2.0 | Static soil-property predictions and water-retention inputs | [CC BY 4.0](https://isric.org/explore/soilgrids). Credit ISRIC – World Soil Information and SoilGrids 2.0; retain depth, unit conversions and product metadata. These are modelled soil properties, not a field soil test. |
| Copernicus Climate Change Service / ECMWF AgERA5 v2.0 | Gridded daily-data download/aggregation pipeline, actual access proof and CY-Bench meteorological inputs | [Official catalogue](https://cds.climate.copernicus.eu/api/catalogue/v1/collections/sis-agrometeorological-indicators) specifies CC BY 4.0. Cite *Agrometeorological indicators from 1979 to present derived from reanalysis*, [DOI 10.24381/cds.6c68c9bb](https://doi.org/10.24381/cds.6c68c9bb), version and retrieval date. Project transformations are not an official Copernicus product. [Access and reproduction](agronomy/copernicus-data.md). |
| FAO Irrigation and Drainage Paper 56, revision 1 (2025) | Crop coefficients, effective-root-depth ranges and depletion fractions in `agronomy/crop_profiles.json` | Santos Pereira, L. et al. (2025), *Crop evapotranspiration. Guidelines for computing crop water requirements*, [DOI 10.4060/cd6621en](https://doi.org/10.4060/cd6621en), CC BY 4.0. Adapted into structured crop variants; table/page/hash references are retained in [the audit](agronomy/data-audit.md). |
| FAO Crop Calendar | Country/agroecological-zone calendar candidates fetched at runtime | Credit FAO Crop Calendar and preserve each original record, source URL, zone and update date. [Service](https://cropcalendar.apps.fao.org/?language=en&pagename=%2Fwelcome.do), [FAO terms](https://www.fao.org/contact-us/terms/en/). No separate dataset-specific CC licence is asserted here. |
| Sacks, Deryng, Foley and Ramankutty (2010), SAGE | Optional unfilled 0.5° crop-calendar lookups | Cite *Crop planting dates: an analysis of global patterns*, [DOI 10.1111/j.1466-8238.2010.00551.x](https://doi.org/10.1111/j.1466-8238.2010.00551.x), and the [dataset/documentation](https://sage.nelson.wisc.edu/data-and-models/datasets/crop-calendar-dataset/). No explicit standalone reuse licence was found on the reviewed landing page/readme; public availability is not represented as an Apache/CC grant. Source NetCDF downloads remain outside Git. |
| GGCMI Phase 3 crop calendar v1.01 | Modelled calendar fallback for six supported crops | [CC BY 4.0 publisher record](https://zenodo.org/records/5062513). Preserve that record's citation, version and upstream source codes. Modelled/gap-filled dates remain identified as such. |
| NASA Harvest CropHarvest v8 | Independent source-collection validation boundaries | [CC BY-SA 4.0 publisher record](https://zenodo.org/records/5533193). Credit the CropHarvest authors; derived boundary redistributions remain subject to share-alike. Raw boundary download/cache is not bundled as Apache code. [Validation record](agronomy/field-data-validation.md). |
| Eurostat APRO_CPSHR statistical samples | Small source-feasibility samples, not training labels | Cite Eurostat, dataset APRO_CPSHR and retrieval date. [General reuse policy](https://ec.europa.eu/eurostat/web/main/help/copyright-notice) is separate from, and does not override, GISCO's geographic-data conditions. Original request URLs and hashes remain in `yield_prediction/artifacts/reference/`. Project interpretations are its authors' responsibility, not Eurostat's. |

## GISCO scope and competition qualification

The project is a noncommercial demonstration. Its GISCO-derived material is
excluded from the Apache-2.0 grant. The affected material includes
`yield_prediction/artifacts/provincial/provinces.json`,
`agronomy/province_inputs/registry.json`, the regional ES112 registry/input
provenance, and retained geometry/source metadata in provincial model bundles.
Unions, coordinate conversion, point derivation or inclusion in a JSON file do
not remove the original boundary conditions. The frozen geometry and weather
points have not been silently replaced.

GISCO's permission supports noncommercial use with the required attribution;
this is not a claim of unrestricted redistribution. The [2026 Space Apps
participant terms](https://www.spaceappschallenge.org/legal/) also place
conditions on third-party Solution Materials. Listing a source here does not
certify competition acceptance of a restrictive licence. The specific GISCO
condition must remain visible in submission references; an unrestricted
geography replacement requires a reviewed release, as described in
[the boundary-source assessment](docs/data-sources.md#boundary-source-assessment).

## Software, fonts and literature

Installed npm/Python packages and downloaded native runtimes keep their own
licences. The dependency lockfiles and pinned requirements identify their
versions; retain installed package licence files when distributing a runtime.
In particular, the locally bundled **Inter** and **Chakra Petch** fonts use the
SIL Open Font License 1.1 (including their copyright/reserved-name notices).
The exact installed font notices accompany the built site under
[`public/licenses/inter-OFL.txt`](public/licenses/inter-OFL.txt) and
[`public/licenses/chakra-petch-OFL.txt`](public/licenses/chakra-petch-OFL.txt).
OpenMP/Expat binary distributions retain the licences supplied with those
distributions. A project-level Apache licence does not replace these notices.

The field map uses OpenStreetMap tiles/data, independently of GISCO model
geography: **© OpenStreetMap contributors**, [ODbL and attribution](https://www.openstreetmap.org/copyright).
Keep the visible map attribution and comply with the tile provider's usage
policy. No map imagery is claimed as original orbitFarm artwork.

Agronomy rules paraphrase the crop-specific publications listed under
`sources` in `agronomy/crop_profiles.json`, including Agriculture Victoria,
University of Minnesota Extension, Kansas State University, Saskatchewan,
North Dakota State University, and University of California IPM. Their source
documents remain externally published works; links and short factual rules do
not relicense those documents. Original team compatibility filenames are
preserved in [the data audit](agronomy/data-audit.md), although the public
project name is orbitFarm.

Reviewed 15 November 2026. Dataset-specific metadata and original licence
notices take precedence over a summary in this file.
