# orbitFarm · Product specification v0.1

This document guides the team's first 24 hours. All code, comments, file contents, user interface text, errors, help text, and demo content must be in English. The product name is **orbitFarm**; trademark availability has not been checked.

Status: the specification, delivery plan, and starter Figma design are prepared. Figma includes five screen drafts. The application, server, CI, and automated tests have not been implemented; the requirements below describe the intended product.

## Product in one sentence

**A friendly farm companion that turns Earth observations into explainable crop rotations and everyday care reminders.**

Farmers see their land as a cozy 16-bit pixel-art farm from above, with a fence, crops, a satellite companion, and specific tasks attached to planting areas. Flat game windows use readable English body text. Stardew Valley is a reference for the mood; sprites, the logo, and artwork are original. The experience follows a clear chain: data → reasons → options → selected plan → actions and history.

## Connection to the NASA challenge

The accessible search representation of the official **Field Shift** page describes crop-rotation decision support using NASA Earth observations, local soil information, crop characteristics, and farmer priorities. Comparing crop sequences therefore belongs in the main user journey. The three options below are our MVP decision, not a NASA requirement. Direct access to the page failed while this document was prepared; the team must check the full statement and its Resources tab before submission. [Official 2026 challenge](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/).

Early test benches use mocks. The final demonstration must show at least one genuine NASA source from the challenge's Resources, with its date and provenance visible in the UI. The GO Team clarified this condition for Global Awards eligibility on November 5, 2026. A saved genuine response makes the pitch more reliable than a live request. [GO Team clarification](https://github.com/nasa/spaceapps/discussions/1827).

## Main user journey

| Step | User action | Visible result |
| --- | --- | --- |
| **1 · Your land** | Search for a place or choose `Try demo farm`, place boundary points, and select `Confirm boundary`. The last point can be undone. | A real map, a closed polygon, area in ha, and a fence along the boundary after confirmation. |
| **2 · Farm context** | Enter the previous crop, the farmer's current plan for the next two seasons, soil type, irrigation access, and a priority: `Save water`, `Improve soil`, or `Balanced`. Missing values may remain `Unknown`. | A short form. When no personal plan is available, the comparison uses an explicitly labeled `Example current plan`. The demo contains a prefilled synthetic example. |
| **3 · A view from orbit** | Select `Analyze my farm`. | Orbit-1 flies over the field with a scanning beam. Copy: `Analyzing latest available observations`. The interface then shows the actual loading, result, missing-data, or error state. |
| **4 · Plan the next seasons** | Review crop options, compare `Current plan`, `Save water`, and `Improve soil`, and select a plan. Without a personal baseline, the first card is named `Example current plan`. | Each option includes a two-season crop sequence, reasons, limitations, and qualitative trade-offs. `Why this plan?` reveals observations and assumptions. An example is never presented as the farmer's existing plan. |
| **5 · Make it your farm** | Choose among 3–6 schematic slots, select a crop, and enter the actual planting date. Planning and actual planting remain distinct. | A cozy top-down 16-bit pixel-art farm with original fence, path, and crop sprites, plus flat game windows with readable English text. The label `Schematic layout — not to scale` remains visible. Precise dragging is an enhancement; selecting a slot is sufficient for the MVP. |
| **6 · Care, then remember** | Open a planting area's task icon, read the reason, and select `Watered`, `Done`, `Skip`, or `Remind me tomorrow`. `Undo` is available. | An icon, a short task description, a due time, and its basis. Completed actions move to the journal. Show one priority task above each planting area; additional tasks remain in `Tasks`. |

The geographic farm boundary is stored as GeoJSON. The positions of game planting areas belong to a separate local schematic inside its fence. The schematic's dimensions must never determine geographic area or satellite sampling. Planning a future crop does not mean that the user has already planted it.

## Improvements to the original idea

1. **Two seasons instead of a crop list.** Farmers understand how the next crop relates to the previous one and compare two alternatives with their current plan.
2. **Every suggestion has a reason.** For example: `Check soil moisture` → `Regional moisture is low. Check your soil before watering.` Show the observation date, units, spatial scale, and source quality nearby. Unknown information remains unknown.
3. **Actions update the journal; new observations update measurements.** Selecting `Watered` does not increase satellite-derived moisture. A gentle watering animation and `Irrigation logged` confirmation may acknowledge the action.
4. **Time controls exist only in Demo mode.** `Advance 1 day` demonstrates the next stage in seconds. Actual dates, observation timestamps, and the demo clock remain separate. Crop growth represents an estimated stage based on the planting date, labeled `Estimated growth stage`.
5. **Explain comparisons without invented percentages.** Initially use categories such as `Lower water demand` or `Requires irrigation`. Do not promise yield or water savings without a model and validation.

## Farm screen and navigation

On desktop, place narrow navigation on the left, the farm in the center, and `Today on your farm` with tasks and the selected planting area on the right. The data source and `Map / Farm` switch remain accessible. Analysis and comparison open in a panel while keeping the farm context visible.

On a phone, the farm occupies the upper part of the screen. Details for the selected planting area open in a bottom panel. Bottom navigation uses `Farm / Plans / Tasks / Journal`. Main actions work by touch without hover; map navigation must not conflict with boundary drawing. Provide `Finish boundary`, `Undo point`, and `Cancel`. Early demonstrations may use `Use demo boundary`.

The MVP must include on-device persistence, farm renaming, planting-area editing, planting dates, tasks with due times, action history, undo, the latest analysis time, retry, clear errors, a confirmed demo reset, and installation instructions. Deleting a planting area requires confirmation or a safe undo. Farm export/import is optional if time remains. Accounts and synchronization are outside the first 24 hours.

## States and English copy

| Situation | Copy / action |
| --- | --- |
| No farm yet | `Your next season starts here.` / `Draw my farm` / `Try demo farm` |
| Invalid boundary | `The boundary crosses itself. Move or remove a point.` |
| Demonstration | `Demo data — simulated conditions` |
| Genuine saved dataset | `Cached NASA data` / `Observed …` / `Retrieved …` |
| Data from the connected NASA pipeline | `NASA data` / dataset name / observation date / resolution |
| No coverage or usable observation | `Not enough data for this field.` / `Add local information` |
| API unavailable | `Analysis unavailable` / `Try again` / `Use demo data` |
| Network disconnected | `Offline — showing your saved farm` / `Last synced …` |
| Moisture check needed | `Check soil moisture` / `Watered` / `Skip` / `Remind me tomorrow` |
| Nutrient information missing | `Check soil nutrients` — no fertilizer dosage |
| Action recorded | `Irrigation logged` / `Undo` |

`Wait for rain` is allowed only with a separate forecast that has an identified source and validity period. Historical NASA POWER or GPM rainfall is not a forecast. During the first 24 hours, forecasts exist only in the synthetic `rain-coming` test bench, labeled `Demo forecast`; connecting a genuine forecast service is outside the MVP. Recording a completed action is a user report, not evidence that field conditions changed.

## Data agreement with the analytics team

The first genuine end-to-end integration uses NASA POWER for regional temperature and rainfall, plus one preprocessed SMAP or HLS snapshot if feasible. Do not integrate five systems at once. The data team prepares agronomic rules and an approved crop list for one region; the frontend must not invent them from the color of the soil.

| Source | Available information | Responsible UI use |
| --- | --- | --- |
| **NASA POWER** | Regional weather and climate parameters; meteorological grid of 0.5° × 0.625°. | Regional context, not a measurement of an individual planting area. [POWER API docs](https://power.larc.nasa.gov/docs/tutorials/service-data-request/api/). |
| **SMAP Enhanced L3** | Surface soil moisture on a 9 km grid. SMAP observes approximately the upper 5 cm of soil. | A single regional signal may apply to the entire small farm. A daily product does not guarantee a new observation of every field each day. [Dataset](https://data.nasa.gov/dataset/smap-enhanced-l3-radiometer-global-and-polar-grid-daily-9-km-ease-grid-soil-moisture-v006-3df00), [NASA on SMAP](https://www.nasa.gov/image-article/smap-data-aids-agriculture/). |
| **HLS** | Land-surface observations at 30 m resolution. | An optional spatial layer and vegetation indices. Account for clouds and observation time; this is not live video. [HLS products](https://hls.gsfc.nasa.gov/data-products/). |

The scan visualizes requesting or processing available data; it does not command a new satellite overpass. Require the source URL, dataset/product version, `observedAt`, `fetchedAt`, units, spatial resolution/footprint, quality, and a clear distinction between synthetic data, NASA cache, and NASA API delivery. Every recommendation references its supporting signals and local inputs. Do not display decorative confidence claims such as `98% confidence`.

## First-release boundaries

**Included:** one region and one farm, 3–4 reviewed crops, the current rotation plus two alternatives covering two seasons, a game-style planting schematic, care tasks, a journal, PWA support, a mock/API adapter, and error test benches. At least one genuine NASA observation is required for the final demonstration. Every remaining synthetic signal is labeled individually.

**After the hackathon:** multi-user accounts, multiple farms, cloud synchronization, push and background tasks, market prices, dosage calculations, yield prediction, IoT, a marketplace, 3D, and a game economy. During the first 24 hours, there are no coins, penalties for missed tasks, or artificial plant deaths driven by timers.

Choose the demo region with the analytics team during the first hour, based on available data and suitable crops. Fixtures may remain synthetic until then; this does not justify claiming support for every climate zone. Sprint outcomes, the data contract, and tests are described in the [orbitFarm delivery plan](orbitFarm-delivery-plan.md).
