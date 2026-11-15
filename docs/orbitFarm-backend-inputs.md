# orbitFarm: Frontend-to-Backend Inputs

This is the core farmer-input agreement for `POST /v1/analysis`.

The frontend sends the field boundary and information supplied by the farmer. The backend selects the planning horizon and recommended planting dates, retrieves environmental data, and calculates recommendations. The form does not ask for planting date or season end.

## Farmer inputs

| Input | API field | Example | Required? | Purpose |
| --- | --- | --- | --- | --- |
| Field boundary | `boundary` | A GeoJSON Polygon drawn on the map | Yes | Locate the field, calculate its area, and select environmental data. Coordinates use `[longitude, latitude]`. |
| Irrigation access | `localInputs.irrigation.availability` | `available`, `none`, or `unknown` | Yes; Unknown is allowed | Distinguish irrigation access from rain-fed farming and missing information. |
| Available irrigation water | `localInputs.irrigation.waterBudget` | `10000` m3 for the entire field | If known | Compare the allocation with irrigation requirements for the backend-selected horizon; disclose the assumed period. |
| Irrigation method | `localInputs.irrigation.method` | `drip`, `sprinkler`, or `surface` | If known | Help account for application losses. Use `null` if unknown. |
| Soil pH | `localInputs.soil.ph` | `7.5` | If known | Check the crop's pH requirements. Use `null` if unknown. |
| Soil texture | `localInputs.soil.texture` | `sandy_loam` | If known | Check soil compatibility and drainage characteristics. Use `null` if unknown. |
| Farmer priority | `priorities` | `["save_water"]` | Yes; default is `["balanced"]` | Guide rotation selection or documented tie-breaking. The other option is `["improve_soil"]`. Send exactly one value. |
| Previous crop | `localInputs.previousCropId` | `wheat` | If known | Support crop-rotation reasoning. Use a crop ID from the shared catalog. |
| Existing two-season plan | `localInputs.currentPlan` | Wheat in season 1, chickpea in season 2 | If known | Compare alternatives with the farmer's actual plan. If absent, the backend labels its baseline `Example current plan`. |

## Water budget: what exactly to send

`waterBudget` is either `null` or an object containing both fields below.

| Field | Example | Meaning |
| --- | --- | --- |
| `volumeM3` | `10000` | Total allocation for the whole field, not per hectare. |
| `basis` | `field_inlet` | Gross water delivered to the field before application losses. |

The frontend sends no allocation period dates; the server owns the planning horizon and explains how it applies the supplied volume. `volumeM3: 0` means a known zero allocation. `waterBudget: null` means the allocation is unknown. Do not send a monthly amount as a total allocation.

## Added automatically by the frontend

These values do not require farmer input.

| Field | Purpose |
| --- | --- |
| `schemaVersion` | Identify the payload format; current value: `1.0`. |
| `requestId` | Match each result to its analysis request. |
| `farmId` | Identify the saved farm. |
| `boundaryVersion` | Prevent a result for an older boundary from replacing the latest analysis. |
| `localInputs.soil.source` | Record whether soil values are farmer-reported, from a soil test, synthetic, or unknown. |
| `localInputs.soil.sampledOn` | Preserve a soil sampling date if provided; otherwise `null`. |

## Retrieved or calculated by the backend

| Data | Backend responsibility |
| --- | --- |
| Field area | Calculate from the geographic boundary and return `areaHa`. |
| Planting dates and planning horizon | Select recommended planting dates for each crop and the planning period on the server. Return optional `cropOptions[].recommendedPlantingDate` as `YYYY-MM-DD`, or `null`/omit when unavailable; the request supplies no season or timezone. |
| Temperature | Retrieve and process environmental data for the location and relevant period. |
| Rainfall | Retrieve and process rainfall data. Keep historical scenarios separate from forecasts. |
| Soil moisture | Retrieve an available observation and expose its date, source, and spatial resolution. |
| Crop requirements | Load the shared crop catalog and documented agronomic rules. |
| Irrigation requirements | Calculate a comparable water requirement and disclose efficiency assumptions. |
| Suitability score | Apply the versioned model: temperature 35%, soil pH 25%, water 30%, soil texture 10%. |
| Recommendations | Return crop options, rotation plans, reasons, missing information, and evidence. |

## Essential rules

- Business dates use `YYYY-MM-DD` only, with no time or timezone conversion. Technical analysis/source metadata may retain ISO timestamps.
- Do not invent values for unknown inputs. Use `null` where specified.
- A score of `82/100` is a suitability index, not an 82% probability of a successful harvest.
- If one of the four scoring components is unavailable, return a null complete score and explain what is missing. Provisional candidates may still be shown.
- Temperature, rainfall, satellite measurements, and scoring weights are not authoritative frontend inputs.
- The planting schematic is separate from the geographic field boundary.

For the complete payload, see the [JSON request example](../contracts/orbitFarm-analysis-request.example.json). Detailed validation and scoring decisions are in the [current analysis contract](orbitFarm-analysis-contract.md).
