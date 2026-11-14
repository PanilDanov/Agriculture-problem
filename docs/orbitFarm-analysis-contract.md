# orbitFarm · Analysis request proposal v1

Status: proposed frontend/backend agreement, based on the team's input table and ranking flow. No API or scoring engine is implemented by this document. The endpoint is `POST /v1/analysis`. All names, payloads, errors, and interface copy use English.

## Responsibility boundary

The frontend sends the geographic field boundary and facts or preferences supplied by the farmer. The backend selects the planning horizon and recommended crop planting dates, retrieves environmental data, derives area, checks crop requirements, applies the versioned scoring policy, and returns reasons and evidence. Planting date and season end are not analysis inputs.

Temperature, rainfall, satellite soil moisture, suitability scores, and scoring weights are not authoritative frontend inputs. NASA POWER provides historical-to-near-real-time daily meteorological series; future growing-season conditions require an explicitly labeled climatological scenario or a separate forecast source. Never query future dates and present historical observations as a forecast. [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/).

## Farmer form

| Input | Required to start? | Payload / behavior |
| --- | --- | --- |
| Field boundary | Yes | `boundary`: a closed GeoJSON Polygon in WGS84, with `[longitude, latitude]` positions. A region label is optional display text. |
| Irrigation access | Yes, with an Unknown option | `localInputs.irrigation.availability`: `available`, `none`, or `unknown`. Access and allocated volume are different facts. |
| Irrigation allocation | Optional | A non-null `waterBudget` contains numeric `volumeM3`: total water available for this whole field, not per hectare. The backend associates the allocation with its planning horizon and discloses that assumption. `0` is a known zero allocation; use `waterBudget: null` when the allocation is unknown. |
| Soil pH | Optional | `localInputs.soil.ph`: a number from 0 to 14 or `null`. Do not substitute a neutral pH for an unknown value. |
| Soil texture | Optional | `localInputs.soil.texture`: a stable enum such as `sandy_loam`, or `null`. |
| Irrigation method | Optional | `drip`, `sprinkler`, `surface`, or `null`. It helps interpret application losses. |
| Priority | Yes, with a visible default | `priorities`: an array containing exactly one of `balanced`, `save_water`, or `improve_soil` in v1. It guides rotation selection or documented tie-breaking, not client-supplied scoring weights. |
| Previous crop | Optional | `localInputs.previousCropId`: a backend catalog ID or `null`. Needed for rotation reasoning. |
| Existing future plan | Optional | `localInputs.currentPlan`: two season entries, or `null`. An absent plan produces an explicitly labeled `Example current plan`, never an invented personal baseline. |

The form does not ask the farmer to enter temperature or expected rainfall. Soil information is optional for starting analysis, but missing information can prevent a complete four-factor score.

The frontend adds `schemaVersion`, a new `requestId`, stable `farmId`, and integer `boundaryVersion`. These are not extra farmer questions. The backend echoes request/farm/boundary identifiers so older results cannot replace a newer analysis.

The request has no `season`, `farmTimeZone`, or water-budget period dates. The server owns planting recommendations and the planning horizon. All business dates use valid calendar strings in `YYYY-MM-DD`, without a time, UTC offset, or timezone conversion. A recorded actual planting date belongs to the local planting journal and is separate from a recommended planting date.

## Concrete request

See [orbitFarm-analysis-request.example.json](../contracts/orbitFarm-analysis-request.example.json) for a complete valid JSON example. Its location, soil inputs, crops, and water allocation are illustrative; they do not represent measured conditions at an actual farm.

The polygon is authoritative for area. The frontend may display a calculated preview, but does not submit a competing `fieldSizeHa` value in v1. The backend computes and returns `areaHa`; a schematic game layout is not geographic input.

`localInputs.soil.source` is `farmer_reported`, `soil_test`, `synthetic`, or `unknown`. `sampledOn` is a calendar date in `YYYY-MM-DD` or `null`. A reported number is not automatically a laboratory measurement. Keep origin metadata when mixing synthetic and authentic inputs.

Texture values are `sand`, `loamy_sand`, `sandy_loam`, `loam`, `silt_loam`, `silt`, `sandy_clay_loam`, `clay_loam`, `silty_clay_loam`, `sandy_clay`, `silty_clay`, or `clay`; missing texture is `null`.

If provided, `currentPlan` contains exactly two entries shaped as `{ "seasonIndex": 1, "cropId": "wheat" }`, with season indices 1 and 2. IDs must exist in the backend crop catalog. This provides comparison context; the first season's water allocation must not be reused silently for season 2.

## Water budget: server-owned horizon and explicit basis

In v1, a non-null `waterBudget` requires only `volumeM3` and `basis`. The frontend does not supply allocation period dates. The backend determines the planning horizon and states how it applies the supplied whole-field volume to that horizon. Monthly allocations, flows such as m3/hour, and per-hectare quantities cannot be treated as this total without an explicit conversion; do not silently prorate them. If no total allocation is known, send `waterBudget: null`.

The v1 basis is `field_inlet`: the gross volume delivered at the field inlet, before field application losses. Do not compare it directly with a net root-zone crop requirement. `applicationEfficiency` is an optional measured/reported fraction greater than 0 and no greater than 1; unknown is `null`. Any backend efficiency assumption must be named, versioned, and returned in `assumptions`; otherwise the corresponding water score remains unknown. [FAO: net and gross irrigation and field application efficiency](https://www.fao.org/4/T7202E/t7202e06.htm).

Rainfall contributes only through the amount effectively available to the crop. A seasonal rainfall total cannot simply be added to the gross irrigation allocation. The analytics team owns the effective-rainfall and crop-water model. [FAO: irrigation water needs](https://www.fao.org/4/s2022e/s2022e08.htm).

`availability: none` allows a null budget or a zero budget; it rejects a positive allocation and non-null irrigation method/efficiency. `availability: unknown` requires a null budget/method/efficiency. `availability: available` may still have an unknown or zero allocation. The UI can therefore distinguish access to irrigation from available water.

## Scoring agreement

The supplied weights define a proposed server-side policy, `crop-suitability-v1`:

`score = 0.35 * temperature + 0.25 * soilPh + 0.30 * water + 0.10 * soilTexture`

Each component has its own documented 0–100 scoring rule. A score of `82/100` is a ranking index, not an 82% probability of a successful harvest. Weights alone do not define the agronomic rules. Store the policy and its version on the backend; do not accept arbitrary component weights from the browser.

The 35/25/30/10 weights remain fixed for this v1 proposal. `priorities` guides rotation selection or an explicitly documented tie-break; it does not silently change the crop score. A later priority-specific weight policy requires its own model version and documentation.

Only apply a documented hard exclusion when its supporting facts are known. Missing information does not mean that a crop is unsuitable. Exclude a known incompatible crop before ranking; a strong average must not hide a hard constraint.

For the simplest v1, return `score: null` and `scoreStatus: insufficient_data` if any of the four required components is unavailable. Still return provisional candidates, known component results, reasons, `missingFields`, and `knownWeight` from 0 to 1. Do not rank incomplete candidates as complete results or silently renormalize their weights. A partial-score policy would need a separate explicit agreement.

The initial weighted score ranks individual crop candidates. Rotation comparisons additionally need crop-history and sequence rules; the single-crop score alone does not establish a suitable rotation.

## Minimum backend response

Keep the existing response envelope: `schemaVersion`, `analysisId`, `requestId`, `farmId`, `boundaryVersion`, `generatedAt`, `dataMode`, `signals`, `cropOptions`, `rotationPlans`, and `limitations`. Include computed `areaHa` and `assumptions`. Each crop option may include `recommendedPlantingDate`: a valid `YYYY-MM-DD` calendar date chosen by the backend, or `null` when no recommendation is available. Omission remains accepted for existing response compatibility. The broader backend proposal also calls for `modelVersion` and `missingFields`.

Each crop option includes its catalog ID, English name, evaluation status (`evaluated`, `excluded`, or `insufficient_data`), nullable `score`, nullable `scoreStatus` (`complete` or `insufficient_data`; null for an excluded candidate), nullable component scores, `knownWeight`, and English reasons referencing evidence. Excluded candidates remain separate from the ranked list.

Environmental signals retain per-signal origin, units, source/dataset version, observation/retrieval dates, spatial resolution, and quality from the delivery plan. Historical/climatological scenarios and forecasts must remain distinguishable. Technical `generatedAt`, `observedAt`, and `fetchedAt` metadata retain ISO 8601 timestamps. Planting recommendations, recorded planting dates, care due dates, reminder dates, and journal dates use `YYYY-MM-DD`; they are never shifted according to a browser or farm timezone.

## Acceptance cases for implementation

- A crossed or zero-area geographic polygon is rejected; reversed coordinate order is caught where ranges or coverage make it detectable.
- The request omits planting date, season end, and timezone; supplying the removed fields is rejected by strict validation.
- An impossible calendar date or a missing year in a supported date field is rejected.
- Unknown soil pH/texture remains null; a zero water budget remains zero.
- A non-null budget requires a numeric whole-field volume and `field_inlet` basis; client allocation-period fields are rejected. The server owns period selection.
- Irrigation availability and quantity contradictions produce field-specific validation errors.
- Unknown texture/catalog IDs and unsupported contract versions produce validation errors.
- No weather observations or scoring weights supplied by the browser override server-owned evidence or policy.
- Missing components produce an incomplete result, not a fabricated complete score.
- Responses echo identifiers; superseded requests or boundary versions do not replace the current result.

These are contract acceptance requirements. The current frontend request builder and validator implement the input shape; the agronomic model and broader response proposal remain backend work. This proposal extends the [delivery plan](orbitFarm-delivery-plan.md) and must be agreed with the analytics team before treating it as a locked API.
