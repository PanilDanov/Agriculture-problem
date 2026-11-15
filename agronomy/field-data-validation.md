# Field data validation

Live source retrieval was tested on November 15, 2026. The six field geometries came from `labels.geojson` in NASA Harvest's CropHarvest v8 release. For each selected country, the script picked a random `Polygon` or `MultiPolygon` marked `is_crop=1`, using seed `20261115`. It checked that the representative point resolved to the expected country in the pinned Natural Earth map. This is a stratified check of the collection pipeline. Local observations would be needed to measure field-level weather, soil, or planting-date accuracy. [CropHarvest v8 and CC BY-SA 4.0 licence](https://zenodo.org/records/5533193) · [Sampling and validation script](check_field_context.py)

## Live results

The weather request used September 1–7, 2024 inclusive in NASA POWER local solar time. All six fields returned all seven days for the nine required weather variables from POWER Daily API v2.10.3. The optional modeled surface and root-zone moisture variables returned zero valid values in this sample. The sampler retained those missing values. Each field returned all 23 requested SoilGrids values, covering three retention pressures at six depths and five topsoil properties. [NASA POWER](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) · [SoilGrids definitions](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_01.html)

Each row covers the ten product crops. The Sacks column counts published gridded calendar records at the sampled cell. The FAO column counts crops with country-level lists of regional candidates because no specific agroecological zone was supplied. The GGCMI column counts model-based candidates used when the other sources returned no dates.

| Country | CropHarvest dataset and row ID | Longitude, latitude | Weather days | Soil values | Sacks cell | FAO regional | GGCMI modeled | Unavailable |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| France | `ile-de-france` 3104 | 3.1853255, 48.4905062 | 7/7 | 23/23 | 4 | 0 | 2 | 4 |
| Brazil | `lem-brazil` 463 | −45.5943453, −11.8187752 | 7/7 | 23/23 | 2 | 0 | 4 | 4 |
| Kenya | `kenya` 262 | 34.3079155, 0.6249936 | 7/7 | 23/23 | 1 | 6 | 1 | 2 |
| Ethiopia | `ethiopia` 43 | 37.0354326, 10.4380719 | 7/7 | 23/23 | 6 | 4 | 0 | 0 |
| Uzbekistan | `central-asia` 1301 | 65.3063964, 39.0486211 | 7/7 | 23/23 | 1 | 8 | 0 | 1 |
| Togo | `togo` 596 | 0.0015804, 10.8975592 | 7/7 | 23/23 | 2 | 1 | 4 | 3 |
| **Total** | **Six fields** | | **42/42** | **138/138** | **16** | **19** | **11** | **14** |

All ten product crops returned calendar data at least once. Overall, 35 of the 60 field–crop combinations returned published gridded or regional calendar data, 11 returned a modeled candidate, and 14 remained unavailable. The combined sources returned some calendar data for all ten crops at the sampled Ethiopian field. The four regional candidates there were chickpea, lentil, faba bean, and tomato. France and Brazil were absent from the FAO Crop Calendar country response used in this run. [FAO API](https://api-cropcalendar.apps.fao.org/) · [Sacks archive](https://sage.nelson.wisc.edu/data-and-models/datasets/crop-calendar-dataset/netcdf-0-5-degree/)

The Brazilian maize row illustrates the fallback. The Sacks cell had no maize value. GGCMI returned day 151 for typical planting and day 283 for typical maturity in both the rainfed and irrigated files, using upstream data source code 8, which the files identify as Brazil CONAB. The normalizer reports May 31 and October 10 and marks them as modeled candidates. Actual planting plans need local confirmation, including which maize season the farmer intends to grow. [GGCMI source files and methodology](https://zenodo.org/records/5062513)

## Reproduce the check

Use the separate environment in [the collector setup](field-data.md#run-the-collector). Run from the repository root in PowerShell.

```powershell
$fieldPython = "yield_prediction/data/processed/field_context/.venv/Scripts/python.exe"
$checkDir = "yield_prediction/data/processed/field_context"
New-Item -ItemType Directory -Force $checkDir | Out-Null
Invoke-WebRequest -Uri "https://zenodo.org/api/records/5533193/files/labels.geojson/content" -OutFile "$checkDir/labels.geojson"
& $fieldPython -m agronomy.check_field_context "$checkDir/labels.geojson" --output-dir "$checkDir/validation"
& $fieldPython -m unittest discover -s agronomy/tests -v
```

The input GeoJSON has SHA-256 `8a8a0e32953dd519ae44779a893b600a07a82bc2ff1f10ddb7b75e699ca34cbf`. The script checks the digest, prints a structured summary, and writes one complete result per country plus `summary.json`. Pass `--offline` after a successful run to replay the raw provider responses, or select other CropHarvest countries or random draws with `--countries` and `--seed`. The data providers may revise their live responses. [Pinned source records and download settings](field_sources.json)

An offline replay reproduced the summaries for all six live field checks. The documented command also ran successfully on the example boundary in Iowa. The agronomy suite passed 16 tests and the yield suite passed nine.

## Incomplete-calendar follow-up

After adding the missing-reason field, replaying the same six cached requests classified all 14 unavailable field–crop combinations as `no_source_coverage`. Automated tests also verify that a source failure and an unresolved country have distinct reasons. [Handling coverage gaps](field-data.md#work-with-an-incomplete-calendar)
