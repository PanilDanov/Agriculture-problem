# orbitFarm backend request guide

This is the developer reference for the JSON currently sent by the orbitFarm frontend to the analysis backend. It lists every request field, accepted value, and validation rule, and distinguishes values supported by the validator from values the current interface actually sends.

Core request guide, reviewed November 15, 2026. The [current analysis contract](orbitFarm-analysis-contract.md) links the implemented schemas and optional ML/irrigation input contracts. This guide describes the core farmer payload; the Python and frontend schemas are authoritative for optional evidence fields.

## HTTP request

```http
POST /v1/analysis
Content-Type: application/json
Accept: application/json
```

- A request is sent when field analysis starts in API mode. Demo mode generates its result locally and sends no analysis request.
- The service URL comes from saved provider settings or `VITE_API_BASE_URL`; the fallback is `http://localhost:8000`.
- If the service URL ends in `/v1/analysis`, it is used directly. If it ends in `/v1`, the frontend appends `/analysis`. Otherwise, it appends `/v1/analysis`. A trailing slash is removed first.
- The URL must use HTTP or HTTPS and have no embedded username/password, query string, or fragment.
- The request body is JSON, with no file uploads. The frontend sets no `Authorization` header or custom `credentials` option.
- The default request timeout is 45 seconds. Starting a new analysis cancels the previous in-flight request.

## Reading the field tables

Every property listed below is required in the JSON object that contains it. A nullable property must be present with JSON `null` when unknown; omitting it is invalid. When `waterBudget` or `currentPlan` is `null`, their child fields do not exist.

Objects use strict validation: extra fields are rejected, including inside nested objects. Enum values are case-sensitive strings. Numbers must be finite JSON numbers, without unit suffixes. An empty form option such as `Unknown` becomes `null`, not `"unknown"`, except for enum fields that explicitly allow `"unknown"`.

## Top-level fields

| Field | JSON type and accepted values | Current frontend behavior |
| --- | --- | --- |
| `schemaVersion` | String; exactly `"1.0"`. | Always `"1.0"`. |
| `requestId` | String; valid UUID. | A new `crypto.randomUUID()` for every analysis attempt. |
| `farmId` | Nonempty string. A UUID is not required by the validator. | New farms receive a UUID; demo scenarios use `"farm-demo-01"`. The ID is retained while editing that farm. |
| `boundaryVersion` | Integer, at least `1`. | Starts at `1`; increases when the boundary is updated or the field setup form is saved while editing. Do not assume it counts only actual geometry changes. |
| `boundary` | GeoJSON Polygon object; see geometry rules below. | The geographic field boundary confirmed by the farmer. |
| `regionLabel` | String, including an empty string at validator level. | Always `"Selected field"`. This is display text. |
| `localInputs` | Object with `soil`, `irrigation`, `previousCropId`, and `currentPlan`. | See the sections below. |
| `priorities` | Array containing exactly one string: `"balanced"`, `"save_water"`, or `"improve_soil"`. | The selected main priority, wrapped in a one-element array. |

Priority meanings:

| Value | Meaning |
| --- | --- |
| `balanced` | Balanced planning preference. |
| `save_water` | Prefer saving irrigation water. |
| `improve_soil` | Prefer improving soil through rotation. |

These are preferences. The frontend does not send custom scoring weights.

## Geographic boundary

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [34.79, 30.85],
      [34.79235, 30.85],
      [34.79235, 30.852],
      [34.79, 30.852],
      [34.79, 30.85]
    ]
  ]
}
```

- `type` must be exactly `"Polygon"`. `Feature`, `FeatureCollection`, and `MultiPolygon` are not accepted as the `boundary` value.
- Coordinates use WGS84 longitude and latitude in degrees: **`[longitude, latitude]`**, with exactly two numbers per position.
- Longitude must be between `-180` and `180`; latitude between `-90` and `90`.
- `coordinates` contains exactly one ring. Holes are not supported.
- The ring must contain at least four positions, including the closing position, with at least three distinct corners. The first and last positions must be identical.
- Consecutive duplicate positions, self-intersections, and an edge whose longitude changes by more than 180 degrees are rejected.
- The frontend requires a computed area of at least `0.000001` hectares. It sends no separate area value; the backend should calculate area from the polygon.

## Server-selected planting dates

The request contains no `season`, planting date, season end, or `farmTimeZone`. The backend determines the planning horizon and recommended crop planting dates. These removed properties are rejected by strict request validation.

Business dates, including recommended planting dates and `soil.sampledOn`, are valid calendar strings in `YYYY-MM-DD`, including the year. They have no time, UTC offset, or timezone conversion. Actual planting dates recorded in the farm interface are separate local records and are not analysis-request parameters. Technical response/source metadata (`generatedAt`, `observedAt`, `fetchedAt`) retain ISO 8601 timestamps.

## Soil inputs

All paths in this section start with `localInputs.soil`.

| Field | Accepted values | Current frontend behavior |
| --- | --- | --- |
| `ph` | Number from `0` to `14`, inclusive, or `null`. | Farmer input; blank becomes `null`. |
| `texture` | One of the texture strings below, or `null`. | Farmer selection; Unknown becomes `null`. |
| `source` | `"farmer_reported"`, `"soil_test"`, `"synthetic"`, or `"unknown"`. | Form saves use `farmer_reported` if either pH or texture is known, otherwise `unknown`. Untouched demo inputs use `synthetic`. The UI has no `soil_test` selector. |
| `sampledOn` | Valid `YYYY-MM-DD` date or `null`. | Always `null` in the current request builder. |

The builder preserves an existing `soil.source`. If it is absent in state, the fallback is `farmer_reported` for the `empty-farm` scenario and `synthetic` for other scenarios. This is provenance metadata; do not treat demo values as laboratory measurements.

Every supported soil texture:

| Value | Meaning |
| --- | --- |
| `sand` | Sand |
| `loamy_sand` | Loamy sand |
| `sandy_loam` | Sandy loam |
| `loam` | Loam |
| `silt_loam` | Silt loam |
| `silt` | Silt |
| `sandy_clay_loam` | Sandy clay loam |
| `clay_loam` | Clay loam |
| `silty_clay_loam` | Silty clay loam |
| `sandy_clay` | Sandy clay |
| `silty_clay` | Silty clay |
| `clay` | Clay |
| `null` | Texture unknown; JSON null, not the string `"null"`. |

Soil source meanings:

| Value | Meaning |
| --- | --- |
| `farmer_reported` | Supplied by the farmer; does not itself establish a laboratory test. |
| `soil_test` | Soil test origin; accepted by the schema, not selectable in the current UI. |
| `synthetic` | Synthetic demo input. |
| `unknown` | Source unknown. |

## Irrigation inputs

All paths in this section start with `localInputs.irrigation`.

| Field | Accepted values | Meaning / current behavior |
| --- | --- | --- |
| `availability` | `"available"`, `"none"`, or `"unknown"`. | Irrigation access is available, absent, or unknown. Access does not establish an allocated water volume. |
| `method` | `"drip"`, `"sprinkler"`, `"surface"`, or `null`. | Drip, sprinkler, surface irrigation, or unknown. |
| `waterBudget` | Object described below, or `null`. | Known total irrigation allocation, or unknown allocation. |
| `applicationEfficiency` | Number greater than `0` and at most `1`, or `null`. | Fraction, e.g. `0.9` for 90%. The current builder always sends `null`. |

When `waterBudget` is an object, both child properties are required:

| Field | Accepted values | Meaning |
| --- | --- | --- |
| `waterBudget.volumeM3` | Number at least `0`. | Total cubic metres available for the **whole field**. The backend chooses the planning horizon and discloses how it applies this allocation. Not cubic metres per hectare, per month, or per hour. |
| `waterBudget.basis` | Exactly `"field_inlet"`. | Gross water delivered at the field inlet, before application losses. |

The builder creates the budget from the form's `volumeM3` and sets `basis` to `field_inlet`. It sends no period dates. When `volumeM3` is unknown, the entire `waterBudget` is `null`.

Cross-field validation:

| `availability` | Allowed `waterBudget` | Allowed `method` | Allowed `applicationEfficiency` |
| --- | --- | --- | --- |
| `available` | `null`, zero-volume budget, or positive-volume budget | `null`, `drip`, `sprinkler`, or `surface` | `null` or a number in `(0, 1]` |
| `none` | `null` or a zero-volume budget | Only `null` | Only `null` |
| `unknown` | Only `null` | Only `null` | Only `null` |

The current UI sets `volumeM3` to `0` when the farmer selects No irrigation, so it normally sends a zero-volume budget for `availability: "none"`. Selecting Unknown clears the method and budget. Selecting Available initially clears both, and the farmer may then enter them.

**`null` means unknown; `0` means a known zero allocation.** A zero-volume budget still includes `basis`.

## Crop history and existing plan

Accepted crop IDs are limited to the current frontend catalog:

| Value | Crop |
| --- | --- |
| `wheat` | Wheat |
| `barley` | Barley |
| `maize` | Maize |
| `sorghum` | Sorghum |
| `chickpea` | Chickpea |
| `lentil` | Lentil |
| `faba-bean` | Faba bean |
| `sunflower` | Sunflower |
| `potato` | Potato |
| `tomato` | Open-field tomato |

- `localInputs.previousCropId`: one of those strings, or `null` when unknown. This is the previous crop, not a requested next crop.
- `localInputs.currentPlan`: two season entries when the farmer supplies a plan or an applicable selected plan is available; otherwise `null`. Each entry has integer `seasonIndex` equal to `1` or `2` and a `cropId` from the table above. Both indices must occur once; their array order is not prescribed.

Example of a supported current plan:

```json
[
  { "seasonIndex": 1, "cropId": "wheat" },
  { "seasonIndex": 2, "cropId": "chickpea" }
]
```

## Complete request example

This is the payload shape produced from the current default demo field when API mode is selected. Coordinates and inputs are illustrative, not measured farm conditions. `requestId` changes on each attempt.

```json
{
  "schemaVersion": "1.0",
  "requestId": "93cbd94b-a7ef-4d6d-a91b-a8b07be6fd4c",
  "farmId": "farm-demo-01",
  "boundaryVersion": 1,
  "boundary": {
    "type": "Polygon",
    "coordinates": [
      [
        [34.79, 30.85],
        [34.79235, 30.85],
        [34.79235, 30.852],
        [34.79, 30.852],
        [34.79, 30.85]
      ]
    ]
  },
  "regionLabel": "Selected field",
  "localInputs": {
    "soil": {
      "ph": 7.5,
      "texture": "sandy_loam",
      "source": "synthetic",
      "sampledOn": null
    },
    "irrigation": {
      "availability": "available",
      "method": "drip",
      "waterBudget": {
        "volumeM3": 10000,
        "basis": "field_inlet"
      },
      "applicationEfficiency": null
    },
    "previousCropId": "wheat",
    "currentPlan": null
  },
  "priorities": ["save_water"]
}
```

For a farmer-created field, `farmId` is normally a UUID and soil provenance follows the form rules above. If soil, irrigation access, and crop history are all unknown, replace `localInputs` with:

```json
{
  "soil": {
    "ph": null,
    "texture": null,
    "source": "unknown",
    "sampledOn": null
  },
  "irrigation": {
    "availability": "unknown",
    "method": null,
    "waterBudget": null,
    "applicationEfficiency": null
  },
  "previousCropId": null,
  "currentPlan": null
}
```

The boundary, identifiers, and one priority are still required. Unknown measurements do not prevent the frontend from sending a valid request.

## Backend integration notes

- Validate the request on the backend too. Client validation does not establish that inputs are trusted measurements.
- Calculate field area from `boundary`. Choose the planning horizon and recommended crop planting dates, retrieve environmental evidence, and apply scoring on the backend. Temperature, rainfall, satellite moisture, crop scores, and scoring weights are not request fields.
- Farm name, schematic bed geometry, planted plots, selected rotation, care tasks, and journal records are not sent by this request; they are stored on the device.
- A successful response must echo `requestId`, `farmId`, and `boundaryVersion` exactly. The frontend rejects mismatched identifiers and ignores results for superseded requests.
- Crop options may include `recommendedPlantingDate`, a valid calendar date in `YYYY-MM-DD` selected by the backend. Omission or `null` means no date recommendation is available. The frontend shows a supplied date and can use it when creating a new planting; an actual planting record remains editable.
- HTTP 200 with an arbitrary JSON object is insufficient: the response must satisfy `analysisResultSchema`. Its current required fields are `schemaVersion`, `analysisId`, `requestId`, `farmId`, `boundaryVersion`, `areaHa`, `generatedAt`, `dataMode`, `signals`, `cropOptions`, `rotationPlans`, `assumptions`, and `limitations`. Nested definitions are in the validator linked below.
- A 404 or 422 response with JSON `{"code":"NO_COVERAGE"}` receives the specific no-coverage message. Other 404/422 responses are treated as invalid requests; other non-success statuses as unavailable analysis. An API error is not replaced with a mock result.

## Implementation references

- [AnalysisRequest type](../src/domain/orbitFarm-types.ts)
- [Request builder and state behavior](../src/domain/orbitFarm-model.ts)
- [Exact request and response validation](../src/domain/orbitFarm-validation.ts)
- [API URL normalization, HTTP request, timeout, and errors](../src/domain/orbitFarm-providers.ts)
- [Form options, UUID generation, and provider selection](../src/orbitFarm-app.tsx)
- [Demo crop catalog and default inputs](../src/domain/orbitFarm-fixtures.ts)

The existing [proposal example](../contracts/orbitFarm-analysis-request.example.json) uses `regionLabel: "Negev, Israel"`. That is accepted by the schema, but the current builder sends `"Selected field"` as shown above.
