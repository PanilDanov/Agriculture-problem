# orbitFarm analysis contract

`POST /v1/analysis` is implemented by the field API. The browser sends a WGS84
field polygon and farmer inputs; the server collects environmental evidence,
calculates field area and compares two crop seasons. Unknown observations
remain unknown. A schematic bed layout does not supply geographic area or
satellite measurements.

Use these implementation references for the current request and response:

- [Farmer input guide](orbitFarm-backend-inputs.md) and [core JSON request guide](orbitFarm-backend-request-guide.md).
- [Field API schemas and validation](../agronomy/api.py), [frontend types](../src/domain/orbitFarm-types.ts)
  and [frontend request/response validator](../src/domain/orbitFarm-validation.ts).
- [Current API behaviour](../agronomy/analysis-api.md), [scoring/water equations](../agronomy/scoring-and-water.md)
  and [field-source definitions](../agronomy/field-data.md).
- [ML inference contracts](../yield_prediction/docs/inference_service.md),
  [provincial modes](../yield_prediction/docs/province_models.md),
  [country annual-history mode](../yield_prediction/docs/national_models.md)
  and [bundled legacy regional inputs](../yield_prediction/docs/published_regional_inputs.md).

Business dates use `YYYY-MM-DD`; technical retrieval/calculation timestamps
retain their time. Whole-field gross irrigation allocation, net crop water
requirement, historical water screens and seasonal water balances have separate
units and meaning. A known zero is not a missing observation.

The ML result must identify its crop, country/region, target year, input cutoff,
model version and spatial/temporal limitations. Provincial NASA point-proxy,
national-history and crop-mask regional estimators remain different contracts.
An explicit regional request is not silently replaced by a national estimate.
The API and frontend validators reject mismatched results and nonfinite numbers.

The [original November 14 proposal](archive/2026-11-14-analysis-proposal.md)
is retained as design history, not a statement of unimplemented backend work.
