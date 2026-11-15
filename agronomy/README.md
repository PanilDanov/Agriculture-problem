# Irrigation and crop rotation

The [crop catalog](crop_profiles.json) provides FAO irrigation references and source-linked rotation checks for wheat, barley, maize, sorghum, chickpea, lentil, faba bean, sunflower, potato, and open-field tomato. Use the [data audit](data-audit.md) to reproduce the source review and collect local inputs. Grain yield forecasts are provided by the [wheat and maize yield module](../yield_prediction/README.md).

Use the [field data collector](field-data.md) to load NASA weather, soil estimates, and published planting calendars from a GeoJSON boundary.

## Run the field assessment

From the repository root, with Python 3.11 or later, run the synthetic example. The script uses the standard library and reads the adjacent catalog.

```sh
python agronomy/assessment.py agronomy/example_request.json
python -m unittest discover -s agronomy/tests -v
```

The fictional example represents processing tomato mid-season in January with a prior potato crop. It returns 5.5 mm/day standard ETc, 87 mm total available water, 33.06 mm readily available water, and a 54 mm soil-water deficit to field capacity. The estimated depletion has reached RAW. The rotation screen points to the potato–tomato Verticillium evidence and the date of the previous potato harvest. [Example request](example_request.json)

### Irrigation request

Supply a `crop_id` and an `irrigation` object. Use `local_date` in YYYY-MM-DD format and `et0_mm_day` as local daily FAO grass reference ET. Select a `variant` from the crop profile for crops with multiple options. For a crop with exactly one option the CLI selects it. Set `stage` to `initial`, `development`, `mid_season`, or `late`. During development and late stages, `stage_progress` is a fraction between 0 and 1 using the local start and end of that stage.

The default result is standard ETc under the FAO table conditions. Use `local_kc` with numeric `initial`, `mid_season`, and `end` and a `source` string when locally calibrated coefficients or FAO adjustments are available. You can also pass `local_depletion` with `p_at_etc_5_mm_day` and a `source` to use a locally supported depletion fraction for the irrigation regime.

For a soil assessment, pass `root_zone_layers` ordered from shallow to deep, covering the active roots only. Each layer has a `thickness_m` and two volumetric fractions `theta_fc` and `theta_wp` in m³/m³. Include measured `theta_now` in every layer to calculate current depletion. Add `application_efficiency` as a fraction in (0, 1] to calculate the gross depth corresponding to a full refill. The CLI shows missing layer data as `needs_root_zone_layers` and missing current readings as `needs_root_zone_moisture`. A storage deficit to field capacity is a snapshot. Actual irrigation delivery requires the rainfall forecast, soil and irrigation system constraints, and water allocation.

### Rotation request

Supply a `rotation` object with candidate `planting_date` in YYYY-MM-DD format. Pass `history` as a list of previous crops and local `harvest_date` values. The `history_complete_since` date records the earliest date from which coverage is known. Dated records from before that point may still document an earlier host. Use `faba-bean` as the canonical ID. The legacy input `faba_bean` resolves to that ID.

The result reports the latest matching host for each documented check, source links, and elapsed days. Uncatalogued history crops are listed for local review. The code checks the catalog matches even if coverage is unknown. A no-match result with stated history coverage means that none of the submitted records matched the catalog. It leaves local diagnostics, uncatalogued hosts, neighboring residue, and applicable plant-back intervals for review.

For a combined response, supply both `irrigation` and `rotation`. Match the product crop IDs to `crop_profiles.json` when integrating. The catalog is independent of field longitude, hemisphere, and growing-season month. The service that prepares requests needs to collect and preserve local sources and calendar information. [Local acquisition instructions](data-audit.md#collect-local-inputs-for-any-field)
