# orbitFarm plantable crop catalog

All ten crops are available in the **Crop** planting selector and **Previous crop** field. Each crop has artwork for three growth stages. Plantings support editing, care reminders, recording harvests, replanting, and browser-local save/reload. New farms start with one whole-field bed. A selected rotation highlights its next crop and advances one season after the matching crop is harvested.

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

Care reminders use the demonstration schedule and ask the farmer to check local conditions.

## Growth estimates

The farm scene and bed card show **Seedling** from the recorded planting date, **Growing** from the end of the reference initial stage, and **Ready to harvest** from the reference harvest threshold. The demo season slider spans at least a year from the current demo date and includes any later estimated harvest. The landscape blends through the four illustrated seasons as the displayed date changes. For open-field tomato, the recorded date is when the seedlings are transplanted into the field, and the harvest threshold estimates the first ripe fruit.

The thresholds count elapsed calendar days. They use published examples or reference range midpoints for the demo. Field timing varies with cultivar, climate, and management. The analysis contract supplies a recommended planting date when available. A matching recommended plan planting date can use the supplied calendar harvest date. Otherwise the estimates below are derived from the planting record and this catalog. `Harvest crop` is available when the crop is ready on the selected season date. Its `Harvest date` field defaults to that date. The explicit action records the date and unlocks the following planting; moving the season slider alone does not record a harvest. Future records appear as `Planned harvest` in the journal. Earlier dates continue to show the archived planting without permitting a second harvest.

| Crop | Growing from day | Ready to harvest from day | Reference |
| --- | ---: | ---: | --- |
| Wheat | 20 | 135 | Spring-sown cereal example at 35–45° latitude, [FAO Table 11](https://www.fao.org/4/x0490e/x0490e0b.htm) |
| Barley | 21 | 115 | Vienna spring barley field trial, initial stage length and calendar days from sowing March 15 to harvest July 8, [IAEA-TECDOC-1813, p. 39](https://www-pub.iaea.org/MTCD/Publications/PDF/TE-1813_web.pdf#page=48) |
| Maize | 30 | 150 | Grain maize example for Spain and California, [FAO Table 11](https://www.fao.org/4/x0490e/x0490e0b.htm) |
| Sorghum | 20 | 125 | Initial duration and midpoint of the 120–130 day grain sorghum range, [FAO Table 7](https://www.fao.org/4/S2022E/s2022e07.htm) |
| Chickpea | 20 | 100 | Hawata cultivar in Gezira field observations, [Mahmoud et al., Table 2](https://doi.org/10.1007/s44279-025-00458-3) |
| Lentil | 25 | 160 | Worked example for lentils, [FAO Chapter 3](https://www.fao.org/4/S2022E/s2022e07.htm) |
| Faba bean | 20 | 105 | Ed-Damer cultivar in Gezira field observations, [Mahmoud et al., Table 2](https://doi.org/10.1007/s44279-025-00458-3) |
| Sunflower | 25 | 130 | Mediterranean and California example, [FAO Table 11](https://www.fao.org/4/x0490e/x0490e0b.htm) |
| Potato | 30 | 130 | Worked example for potatoes, [FAO Chapter 3](https://www.fao.org/4/S2022E/s2022e07.htm) |
| Open-field tomato | 15 | 75 | Initial phase after transplanting and rounded midpoint of the 69–80 day mid-season maturity range, [FAO Chapter 3](https://www.fao.org/4/S2022E/s2022e07.htm), [Utah State University Extension, p. 10](https://extension.usu.edu/planthealth/files/up-newsletter/2015/UtahPests-Newsletter-fall15.pdf#page=10) |

## Implementation and verification

- [Shared catalog and supported IDs](../src/domain/orbitFarm-crop-catalog.ts)
- [Artwork component](../src/components/orbitFarm-crop-sprite.tsx)
- [Domain planting, care, persistence, and API tests](../src/domain/orbitFarm-crops.test.ts)
- [Browser planting and artwork regression](../tests/orbitFarm-crops.spec.ts)
- [Original artwork pack](../brand/sprites/crops-v1/README.md)
