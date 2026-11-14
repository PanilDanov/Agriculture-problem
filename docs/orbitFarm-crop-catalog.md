# orbitFarm plantable crop catalog

All ten crops are available in the **Crop** planting selector and **Previous crop** field. Each crop has its own ready-stage artwork. Plantings support editing, care reminders, and browser-local save/reload.

| API and saved-state ID | English display name |
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

The same IDs are accepted for crop history, current-plan entries, analysis crop options, and rotation sequences. Existing farms keep their previous plantings; no storage-version change is required to add catalog entries.

## Demo behavior

Manual planting is available for all ten crops. The mock analysis still contains the original three synthetic recommendation profiles: wheat, chickpea, and sorghum. The other seven crops receive no invented suitability score or planting recommendation. They remain available for recording the farmer's actual planting and editable planting date.

Growth stages use illustrative demo durations. The seven newly plantable crops use the existing 120-day demo fallback; these values are interface fixtures, not biological predictions. Care reminders use the existing fixed demonstration schedule and ask the farmer to check local conditions. The ready-stage artwork is a crop identifier and does not change with the estimated growth stage.

## Implementation and verification

- [Shared catalog and supported IDs](../src/domain/orbitFarm-crop-catalog.ts)
- [Artwork component](../src/components/orbitFarm-crop-sprite.tsx)
- [Domain planting, care, persistence, and API tests](../src/domain/orbitFarm-crops.test.ts)
- [Browser planting and artwork regression](../tests/orbitFarm-crops.spec.ts)
- [Original artwork pack](../brand/sprites/crops-v1/README.md)
