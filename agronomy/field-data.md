# Field data collection

The field collector accepts a WGS84 GeoJSON `Polygon`, `MultiPolygon`, or `Feature` containing one of those geometries. It returns dated weather, depth-specific soil estimates, and planting-calendar results for all ten product crop IDs. Each lookup uses a representative point inside the largest field component. The coverage of each provider determines what is available. [Data sources and settings](field_sources.json) · [Validation on real fields](field-data-validation.md)

## Run the collector

Use an isolated Python 3.11 environment so the field-data dependencies can be updated independently of the yield models. Run these commands from the repository root in PowerShell.

```powershell
py -3.11 -m venv yield_prediction/data/processed/field_context/.venv
$fieldPython = "yield_prediction/data/processed/field_context/.venv/Scripts/python.exe"
& $fieldPython -m pip install -r agronomy/requirements-field-data.txt
& $fieldPython -m agronomy.field_context agronomy/example_field.geojson --start 2024-09-01 --end 2024-09-07 --output yield_prediction/data/processed/field_context/example.json
```

On macOS or Linux, create the same environment with `python3.11 -m venv` and use its `bin/python` executable. The example boundary is illustrative. Replace it with an exported field boundary from the product. Coordinates are ordered longitude, latitude. Holes and antimeridian crossings are supported. Separate components are compared using their approximate area. The output reports the sample point used for every provider. A large or disjoint farm needs additional sampling to characterize variability across its area.

The weather period is inclusive. With no dates supplied, the collector requests 30 days ending seven days before the current UTC date to allow for availability delays. The default NASA radiation window begins in 1984. This lookup is for historical weather. The weather endpoint supplies no forward forecast. [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)

The Python entry point takes the boundary as a decoded GeoJSON object and the dates as `datetime.date` values.

```python
from datetime import date

from agronomy.field_context import collect_field_context

result = collect_field_context(boundary, date(2024, 9, 1), date(2024, 9, 7))
```

## How data are obtained

| Source | Request and normalization | Use and interpretation |
| --- | --- | --- |
| NASA POWER | GET the `AG` daily point API with `latitude`, `longitude`, `start`, `end`, `time-standard=LST` and the parameter codes in the settings file. Parse the JSON `properties.parameter` series and check the units in `parameters`. The shared parser expands the requested date range and converts the header fill value and invalid measurements to JSON null. | Daily minimum, mean and maximum temperature, corrected precipitation, relative humidity, solar radiation, 2 m wind, surface pressure, and dew point. Optional `SFMC` and `RZMC` are gridded moisture output. They have their own coverage counts. LST is the provider's solar day convention. Weather, radiation, and moisture may have different published grid resolutions and availability. [Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) · [Meteorological sources](https://power.larc.nasa.gov/docs/methodology/data/sources_meteorology/) · [Radiation sources](https://power.larc.nasa.gov/docs/methodology/data/sources_fluxes/) |
| ISRIC SoilGrids 2.0 | Transform the point from WGS84 to the service's Interrupted Goode Homolosine CRS. Request about a 1 km square from each relevant WCS coverage and sample the containing pixel in the returned GeoTIFF. The requested coverage IDs follow `property_depth_mean`. Sample the six standard depth intervals down to 200 cm for water retention. Use the 0–5 cm layer for pH, organic carbon, sand, silt, and clay. | The nominal 250 m predictions are static and may contain no-data pixels. The retention rasters at 10, 33, and 1,500 kPa use a divisor of 1,000 for m³/m³. Soil pH and mass fractions use the conversions recorded in settings. Texture is derived from the topsoil sand, silt, and clay. The JSON flags inconsistent ordering of the three retention predictions. Field capacity and current root-zone moisture still require local interpretation or measurement. [ISRIC units and depths](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_01.html) · [WCS layer example](https://maps.isric.org/generated/soilgrids/wv0033.html) |
| Natural Earth 5.1.2 | Download the pinned 1:10m Admin 0 map unit GeoJSON. Use a point-in-polygon predicate and resolve the two-letter map unit code. | This lookup supplies a country key for FAO. Uncoded and ambiguous locations have explicit statuses. Geographic boundaries use the Natural Earth map interpretation and scale. [Dataset](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-details/) · [Pinned file](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_map_units.geojson) |
| FAO Crop Calendar | GET `/api/v1/countries?language=en`, then `/api/v1/countries/{country}/cropCalendar?language=en` when the country is listed. Match exact crop identifiers from the settings file. Keep distinct seasons, the original agroecological zone ID, published dates, and update date. A known zone can be supplied with `--fao-zone`. | FAO provides published options for covered countries and crops. The API supplies agroecological zone names and descriptive records. Without a known zone, the results are regional candidates for the resolved country. Calendar crop codes distinguish species and some variants. Confirm the production system for generic tomato entries. [FAO crop calendar](https://cropcalendar.apps.fao.org/?language=en&pagename=%2Fwelcome.do) · [Swagger schema](https://api-cropcalendar.apps.fao.org/swagger.json) |
| Sacks et al. 2010 | Download the unfilled 0.5° NetCDF files for wheat, barley, maize, sorghum, sunflower, and potato. Sample the corresponding published grid cell, read the planting and harvest fields, and convert day of year to recurring month/day. | Published regional observations were assigned to grid cells. The calendar retains observed coverage and leaves grid gaps visible. Wheat and barley seasons and first/second maize or sorghum seasons remain separate. [Files and documentation](https://sage.nelson.wisc.edu/data-and-models/datasets/crop-calendar-dataset/netcdf-0-5-degree/) · [Published method](https://doi.org/10.1111/j.1466-8238.2010.00551.x) |
| GGCMI Phase 3 v1.01 | For the same six crops, sample the matching 0.5° land cell as a fallback when the other providers return no planting window for that crop and location. Read the separate rainfed and irrigated NetCDF4 files. Preserve the upstream data source code, typical planting day, and typical maturity day. | These long-term modeling inputs blend multiple sources, with gap filling and extrapolation into some noncultivated cells. Their dates are labeled modeled candidates. They indicate a typical modeled start, without a sowing-window range. Crop maturity is kept in its own field. [Files, methods and licence](https://zenodo.org/records/5062513) |

The FAO crosswalk recognizes wheat, barley, maize, sorghum, chickpea, lentil, faba bean, sunflower, potato, and open-field tomato. Chickpea, lentil, faba bean, and tomato currently use FAO coverage. The published grouped pulses in the Sacks dataset and separate broad crop groups in GGCMI have no species-level crosswalk. A missing species or site remains visible in the result.

## Read coverage and provenance

- `weather.records` gives a row for every requested day. `valid_days_by_field` counts observations. The overall weather status describes the required weather columns. The two modeled moisture columns are optional and can be null independently.
- `soil.layers` contains scaled values by depth. `soil.requests` records individual coverages, their request and missing-data reasons. Use the sample depth and local conditions when mapping retention values to a field-capacity proxy.
- `planting_calendars.crops` always contains the ten crop IDs. `available` means a sampled Sacks cell or a published FAO window for a caller-specified zone. `regional_candidates` means published FAO options for the country. `modeled_candidates` means GGCMI field-grid estimates. `unavailable` preserves missing coverage. Provider errors and attempted files are listed alongside those results. Dates are recurring month/day values, so a December–January window retains its original order. The `day` field is null when FAO supplies only a month.
- Each cached GET response is saved untouched in `yield_prediction/data/processed/field_context/cache/`. The reported request URL, retrieval time, response SHA-256, cache filename, and retrieval status locate the original file. NASA files are JSON, SoilGrids returns GeoTIFFs, and gridded calendars use NetCDF or gzipped NetCDF. Use `--offline` to replay an existing cache or `--refresh` to request fresh values. If a refresh fails and a prior validated response is available, its retrieval status is `stale_cache`.

## Work with an incomplete calendar

For each crop with an unavailable automated calendar, `missing_reason` points to the next action.

| Reason | Action |
| --- | --- |
| `no_source_coverage` | Keep the crop available for review and leave its planting date open until a suitable calendar is available. |
| `lookup_incomplete` | Retry the affected source when available. The source records show request failures, unavailable cached responses, or a stale fallback. |
| `country_unresolved` | Verify the resolved location to determine the applicable regional calendar. |

The analysis backend owns the two-season planning horizon and the choice of any recommended planting date. When a crop date is unsupported, the response can omit `recommendedPlantingDate` or return null. Weather and soil results are available independently. Rotation screening uses the proposed season and available field history. A season-long irrigation estimate also needs local phase dates, reference ET₀ and a root-zone water balance. [Two-season field analysis API](analysis-api.md)

## Change a source

Edit [field_sources.json](field_sources.json) or supply another copy using `--sources`. URLs, crop code mappings, parameter names, soil scale factors, depth selections, and cache lifetimes are configured there. Keep the provider's documented field names and units when changing a compatible endpoint. The weather and soil adapters are in [field_providers.py](field_providers.py) and the crop-calendar adapters are in [field_calendars.py](field_calendars.py). Replace the relevant adapter when the replacement uses a different file format or API schema. The public entry point and normalized field output can stay the same. Remove the optional `modeled_calendar` section to use published sources only.

The field output supplies inputs for the irrigation and rotation assessment. Field irrigation still needs a crop variant, local crop stage, reference ET₀, and field moisture where a refill estimate is requested. A farm's water allocation and actual crop history come from grower or farm records. [Irrigation and rotation request format](README.md)
