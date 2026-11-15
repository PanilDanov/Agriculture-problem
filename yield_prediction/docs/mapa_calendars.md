# MAPA monthly calendar reference

The portable snapshot `artifacts/reference/mapa_calendars_2014_2016.json` contains
the ten project crops for each of Spain's 50 INE provinces, plus a separate Spain
total. It comes from MAPA's official [2014–2016 calendar publication](https://www.mapa.gob.es/es/estadistica/temas/estadisticas-agrarias/agricultura/calendarios-siembras-recoleccion/).
Each of the five source workbooks has a download URL and SHA-256. Original crop
variant names, worksheet names, cell ranges, published totals and monthly values
remain in every record. No private cache is needed to consume the snapshot.

The source gives monthly sowing shares by area and harvest shares by production.
For a broad target, the extractor combines varieties using their corresponding
published area or production totals. It retains the source's rounding. An empty
month in an otherwise populated distribution contributes zero to that profile;
an empty or zero-total profile cannot establish a crop calendar. Unavailable
province–crop combinations remain explicit. Spain totals never stand in for a
missing province record.

Wheat combines hard and soft wheat; barley combines the two published ear types;
maize combines hybrid and other grain maize; potato combines four harvest-season
categories. Tomato combines three fresh-harvest periods and processing tomato.
The tomato calendar does not distinguish protected from open-field production.
Every tomato record therefore carries a mixed-production warning.

This is a 2014–2016 statistical reference. Workbook properties are dated 2019;
the original public release day was not verified and `published_on` remains null.
The current website's Last-Modified header does not establish a newer statistical
vintage. Applying this fixed reference to earlier model training years is a
retrospective assumption, not evidence of an operational forecast issued then.

The snapshot publishes no measured day of sowing or harvest. Its separately
labelled `modal-month-scenario-v1` convention selects the modal sowing month and
modal harvest month, with the first calendar month winning a tie. A model may
use the first sowing-month day and the last harvest-month day, placing sowing in
the previous year when its month exceeds the harvest month. These dates describe
a representative province scenario. Marginal distributions do not establish
matching crop cohorts, actual field dates, or crop masks.

Re-extract downloaded workbooks with:

```sh
python yield_prediction/extract_mapa_calendars.py \
  --input .data/regional-expansion/calendars \
  --province-names .data/regional-expansion/province_ine_names.json
```

The province-name crosswalk comes from MAPA's provincial statistics codes. Exact
calendar aliases are explicit in the extractor; unrelated autonomous-community
totals are excluded. The audit tests run against the portable snapshot, including
known Lugo sorghum source cells and a zero-area case.
