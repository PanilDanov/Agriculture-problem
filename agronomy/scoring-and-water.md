# Ten-crop reference screening and measured water assessment

The analysis API uses all ten crops from `AgroWise_crop_requirements_clean.csv` and the source-linked FAO profiles in `crop_profiles.json`. `rotation_planner.py` now returns crop component scores and an `irrigationAssessment`. These outputs describe reference compatibility and a measured water snapshot. They do not predict yield or a probability of success. The separately trained yield models retain their own scope and version.

## Crop screen

Policy version: `crop-reference-screen-v1` in `suitability.py`.

`score = 0.35 * temperature + 0.25 * soilPh + 0.30 * water + 0.10 * soilTexture`

Every factor is on 0–100. Missing factors stay `null`; `knownWeight` is the sum of their known weights, and the complete score stays `null`. The policy never renormalizes a partial sum. `missingFields` and component evidence explain why a score cannot be completed.

The CSV contains the team's reference ranges, not cultivar-specific biological thresholds. The score is an explicit software policy based on those references:

- Temperature: replay the proposed planting-to-harvest interval against complete NASA POWER daily seasons. At least three complete historical seasons are required. The seasonal-mean factor is 100 inside the CSV's mean-temperature range, decreases linearly to 0 at its lower/upper temperature reference bound, and is multiplied by `1 - outOfReferenceDays / seasonDays`. Count a day only once when its minimum or maximum exceeds the relevant reference. Average the factor over complete seasons. The result includes per-season dates, mean temperature and counts; it is labeled a historical climate scenario rather than a forecast. Duplicate dates and stale source-cache status cannot complete this component.
- Soil pH: 100 inside the stated inclusive range, 0 outside. Texture: 100 inside the stated list, 0 outside. A known violation produces `evaluationStatus: excluded` and `score: null`. These exclusions are constraints from the team's reference policy; the evidence remains visible for agronomic review.
- Water: use a documented *net seasonal irrigation requirement*, never the historical dry-day screen. Match the requirement to the crop and exact season dates. Compare it with a whole-field allocation for those same dates. `effectiveAllocationMm = volumeM3 * applicationEfficiency / (10 * areaHa)`; `water = 100 * min(1, effectiveAllocationMm / netRequirementMm)`. Unknown period, volume, efficiency or field area leaves the factor unknown. A known zero volume remains zero even if efficiency is unknown. Explicitly absent irrigation access is known zero. A documented zero net requirement scores 100 without requiring an allocation.

`evaluationStatus` is `evaluated`, `insufficient_data` or `excluded`. Legacy `scoreStatus` remains `complete` or `insufficient_data` for existing clients; an excluded candidate has a null complete score and explicit exclusion reasons. Known soil-conflicting rotations cannot receive `planStatus: supported`, and compatible crop pairs are preferred when any exist.

An exact dated allocation shortfall also prevents a supported plan and is considered before calendar and objective tie-breaks. Plans expose `waterAllocationStatus` and per-season `waterAllocationEvidence`; unknown allocation adequacy stays `insufficient_data` and is distinct from the historical `waterScreenMm` comparison. A budget is never silently reused for a second season with different dates.

When a published calendar is unavailable, one farmer-supplied documented water-balance period can define the *screening* interval. Its origin is retained as `farmer_supplied_water_balance_period`; this does not create a published planting recommendation.

## Input additions

The service adds `analysisContext: { areaHa, asOf }` internally. Optional `fieldObservations` and `seasonalWaterBalance` inputs are independent: a seasonal planning assessment requires no current measurement date, stage or soil-moisture reading. The field-input excerpt is:

```json
{
 "fieldObservations": {
  "observedOn": "2026-07-01",
  "cropId": "tomato",
  "variant": "processing",
  "stage": "mid_season",
  "stageProgress": null,
  "et0MmDay": 5,
  "source": "Farmer root-zone measurement and local reference ET",
  "applicationEfficiency": 0.8,
  "rootZoneLayers": [
    {"thicknessM": 0.3, "thetaFc": 0.30, "thetaWp": 0.15, "thetaNow": 0.22},
    {"thicknessM": 0.3, "thetaFc": 0.28, "thetaWp": 0.14, "thetaNow": 0.18}
  ]
 },
 "seasonalWaterBalance": [
    {
      "cropId": "tomato",
      "periodStart": "2026-04-01",
      "periodEnd": "2026-09-01",
      "netIrrigationRequirementMm": 100,
      "source": "Local field-water-balance assessment",
      "method": "Documented balance including effective rainfall and root-zone storage"
    }
  ]
}
```

Values in this JSON illustrate the contract. They are not observations from an actual farm and are never used as runtime defaults. Irrigation `waterBudget` may add `periodStart` and `periodEnd`; `volumeM3` remains the total gross volume available to the whole field at its inlet.

Older saved inputs may contain `fieldObservations.seasonalWaterBalance`; that path remains supported. When a top-level `seasonalWaterBalance` is present it takes precedence, including an explicitly empty array used to clear earlier planning data. Editing legacy balances in the interface migrates them to the independent planning input. Removing daily observations preserves seasonal planning records.

## Root-zone snapshot

`irrigation.py` calls the original `assessment.irrigation_screen()` for all 24 FAO crop variants. The current snapshot requires an explicitly sourced observation date, crop, stage and ET0. Multi-variant crops require the farmer to choose a variant. Measured active-root layers determine storage; NASA's historical/modelled moisture is never substituted.

FAO formulas already implemented in `assessment.py` remain unchanged:

- `ETc = Kc * ET0`, with linearly interpolated Kc during development and late stages;
- `p = clamp(pRef + 0.04 * (5 - ETc), 0.1, 0.8)`;
- `TAW = sum(1000 * (thetaFc - thetaWp) * thicknessM)` and `RAW = p * TAW`;
- `Dr = sum(clamp(1000 * (thetaFc - thetaNow) * thicknessM, 0, TAWlayer))`;
- `grossRefillMm = Dr / efficiency`; `volumeM3 = depthMm * areaHa * 10`.

Policy version `field-water-snapshot-v1` requires observations at most two calendar days old for a current calculation. Future/stale measurements produce explicit statuses and no current refill. This two-day limit is a conservative application freshness rule, not a universal agronomic interval. Missing thetaNow leaves the deficit unknown. Missing efficiency leaves gross refill unknown. Sources of reference Kc and depletion fractions are retained from `crop_profiles.json` (FAO Irrigation and Drainage Paper 56, revision 1).

A storage deficit is not an automatic watering instruction: effective rainfall, infiltration, system capacity, current allocation and local measurements still matter. A supplied allocation is compared with gross refill only when its dates include the observation and its stated volume is treated as unspent; the response states this assumption. The seasonal water score and current storage snapshot remain separate calculations.

## Verification

```bash
python -m unittest discover -s agronomy/tests -v
```

Tests cover all ten reference profiles, complete versus partial weights, unknown versus zero water, period mismatches, exact gross/net unit conversion, incomplete historical windows across New Year, stale/duplicate weather, historical frost flags, soil-conflicting plan labels, root-zone depletion and missing/stale/future observations.
