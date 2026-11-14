# orbitFarm: Frontend-to-Backend Inputs

This is the proposed input agreement for `POST /v1/analysis`.

The frontend sends the field boundary, the planning period, and information supplied by the farmer. The backend retrieves environmental data and calculates recommendations.

## Farmer inputs

| Input | API field | Example | Required? | Purpose |
| --- | --- | --- | --- | --- |
| Field boundary | `boundary` | A GeoJSON Polygon drawn on the map | Yes | Locate the field, calculate its area, and select environmental data. Coordinates use `[longitude, latitude]`. |
| Planting date | `season.plantingDate` | `2026-11-20` | Yes | Check planting windows and crop growing conditions. Always include the year. |
| Season end / latest harvest date | `season.endDate` | `2027-04-30` | Yes for the MVP | Define the planning period and check whether a crop can complete its growing cycle in time. |
| Irrigation access | `localInputs.irrigation.availability` | `available`, `none`, or `unknown` | Yes; Unknown is allowed | Distinguish irrigation access from rain-fed farming and missing information. |
| Available irrigation water | `localInputs.irrigation.waterBudget` | `10000` m3 for the entire field from `2026-11-20` to `2027-04-30` | If known | Compare the available allocation with estimated irrigation requirements for the same period. |
| Irrigation method | `localInputs.irrigation.method` | `drip`, `sprinkler`, or `surface` | If known | Help account for application losses. Use `null` if unknown. |
| Soil pH | `localInputs.soil.ph` | `7.5` | If known | Check the crop's pH requirements. Use `null` if unknown. |
| Soil texture | `localInputs.soil.texture` | `sandy_loam` | If known | Check soil compatibility and drainage characteristics. Use `null` if unknown. |
| Farmer priority | `priorities` | `["save_water"]` | Yes; default is `["balanced"]` | Guide rotation selection or documented tie-breaking. The other option is `["improve_soil"]`. Send exactly one value. |
| Previous crop | `localInputs.previousCropId` | `wheat` | If known | Support crop-rotation reasoning. Use a crop ID from the shared catalog. |
| Existing two-season plan | `localInputs.currentPlan` | Wheat in season 1, chickpea in season 2 | If known | Compare alternatives with the farmer's actual plan. If absent, the backend labels its baseline `Example current plan`. |

## Water budget: what exactly to send

`waterBudget` is either `null` or an object containing all four fields below.

| Field | Example | Meaning |
| --- | --- | --- |
| `volumeM3` | `10000` | Total allocation for the whole field, not per hectare. |
| `periodStartDate` | `2026-11-20` | First day covered by the allocation. Must match the planting date in v1. |
| `periodEndDate` | `2027-04-30` | Last day covered by the allocation. Must match the season end in v1. |
| `basis` | `field_inlet` | Gross water delivered to the field before application losses. |

Dates are inclusive local calendar dates in the farm's timezone. `volumeM3: 0` means a known zero allocation. `waterBudget: null` means the allocation is unknown. Do not send a monthly amount as a whole-season budget.

## Added automatically by the frontend

These values do not require farmer input.

| Field | Purpose |
| --- | --- |
| `schemaVersion` | Identify the payload format; proposed value: `1.0`. |
| `requestId` | Match each result to its analysis request. |
| `farmId` | Identify the saved farm. |
| `boundaryVersion` | Prevent a result for an older boundary from replacing the latest analysis. |
| `farmTimeZone` | Interpret local dates correctly; for example, `Asia/Jerusalem`. |
| `localInputs.soil.source` | Record whether soil values are farmer-reported, from a soil test, synthetic, or unknown. |
| `localInputs.soil.sampledOn` | Preserve a soil sampling date if provided; otherwise `null`. |

## Retrieved or calculated by the backend

| Data | Backend responsibility |
| --- | --- |
| Field area | Calculate from the geographic boundary and return `areaHa`. |
| Temperature | Retrieve and process environmental data for the location and relevant period. |
| Rainfall | Retrieve and process rainfall data. Keep historical scenarios separate from forecasts. |
| Soil moisture | Retrieve an available observation and expose its date, source, and spatial resolution. |
| Crop requirements | Load the shared crop catalog and documented agronomic rules. |
| Irrigation requirements | Calculate a comparable water requirement and disclose efficiency assumptions. |
| Suitability score | Apply the versioned model: temperature 35%, soil pH 25%, water 30%, soil texture 10%. |
| Recommendations | Return crop options, rotation plans, reasons, missing information, and evidence. |

## Essential rules

- Do not invent values for unknown inputs. Use `null` where specified.
- A score of `82/100` is a suitability index, not an 82% probability of a successful harvest.
- If one of the four scoring components is unavailable, return a null complete score and explain what is missing. Provisional candidates may still be shown.
- Temperature, rainfall, satellite measurements, and scoring weights are not authoritative frontend inputs.
- The planting schematic is separate from the geographic field boundary.

For the complete payload, see the [JSON request example](../contracts/orbitFarm-analysis-request.example.json). Detailed validation and scoring decisions are in the [analysis contract proposal](orbitFarm-analysis-contract.md).
