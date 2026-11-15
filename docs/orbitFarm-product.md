# orbitFarm · Product behaviour

This document describes the integrated application and its product boundaries, reviewed 15 November 2026. All code, comments, file contents, user interface text, errors, help text, and demo content must be in English. The product name is **orbitFarm**; trademark availability has not been checked.

The browser application includes live field analysis, explicitly labelled demo test benches, two-season rotation comparisons, planting/harvest progression and a local journal. The backend uses actual NASA POWER observations and versioned crop/ML sources. PWA installation, accounts and cloud synchronization remain outside this release. See the [current implementation](../README.md), [data-source scope](data-sources.md) and [analysis contract](orbitFarm-analysis-contract.md) for verified behaviour and limits.

## Product in one sentence

**A friendly farm companion that turns Earth observations into explainable crop rotations and everyday care reminders.**

Farmers see their land as a cozy 16-bit pixel-art farm from above, with a fence, crops, a satellite companion, and specific tasks attached to planting areas. Flat game windows use readable English body text. Stardew Valley is a reference for the mood; sprites, the logo, and artwork are original. The experience follows a clear chain: data → reasons → options → selected plan → actions and history.

## Connection to the NASA challenge

The project uses NASA Earth observations as evidence for crop and rotation decisions. Its implemented NASA source is POWER, with observation dates, units and provenance retained. A scan is an interface transition while available data is processed, not a new satellite overpass. [Official NASA POWER data service](https://power.larc.nasa.gov/docs/services/) · [Project data-source inventory](data-sources.md).

## Main user journey

| Step | User action | Visible result |
| --- | --- | --- |
| **1 · Your land** | Search for a place or choose `Try demo farm`, place boundary points, and select `Confirm boundary`. The last point can be undone. | A real map, a closed polygon, area in ha, and a fence along the boundary after confirmation. |
| **2 · Farm context** | The server chooses recommended planting dates and the planning horizon. Enter the previous crop, the farmer's current plan for the next two seasons, soil type, irrigation access, and a priority: `Save water`, `Improve soil`, or `Balanced`. Missing values may remain `Unknown`. | A short form. When no personal plan is available, the comparison uses an explicitly labeled `Example current plan`. The demo contains a prefilled synthetic example. |
| **3 · A view from orbit** | Select `Analyze my farm`. | Orbit-1 flies over the field with a scanning beam. Copy: `Analyzing latest available observations`. The interface then shows the actual loading, result, missing-data, or error state. |
| **4 · Plan the next seasons** | Review crop options and available server-recommended planting dates, compare `Current plan`, `Save water`, and `Improve soil`, and select a plan. Without a personal baseline, the first card is named `Example current plan`. | Each option includes a two-season crop sequence, reasons, limitations, and qualitative trade-offs. `Why this plan?` reveals observations and assumptions. An example is never presented as the farmer's existing plan. |
| **5 · Make it your farm** | Draw custom polygon beds, move them, edit their corners, or start from a preset. Select a bed, a crop, and the actual planting date. Planning and actual planting remain distinct. | A cozy top-down 16-bit pixel-art farm with named, non-overlapping beds and readable controls. The label `Schematic layout — not to scale` remains visible. New farms start with one `Whole field` bed covering the entire planning grid. Custom and previously saved layouts are preserved; the classic 3 × 2 arrangement remains available as a preset and in test benches. |
| **6 · Care, then remember** | Open a planting area's task icon, read the reason, and select `Watered`, `Done`, `Skip`, or `Remind me tomorrow`. `Undo` is available. | An icon, a short task description, a due date, and its basis. Completed actions move to the journal. Show one priority task above each planting area; additional tasks remain in `Tasks`. |

The geographic farm boundary is stored as GeoJSON. The positions of game planting areas belong to a separate local schematic inside its fence. The schematic's dimensions must never determine geographic area or satellite sampling. Planning a future crop does not mean that the user has already planted it.

The bed editor uses a 24 × 12 planning grid with arbitrary simple polygons, up to 24 beds and 32 corners per bed. Beds may touch, but their interiors cannot overlap. Invalid moves and corner edits retain the last valid shape. Undo, Redo, and Cancel operate on the unsaved layout draft. Saving a layout that removes planted beds requires confirmation and preserves historical journal entries. Numeric corner controls and a named-bed selector provide alternatives to precise dragging on narrow screens.

## Planting and harvest cycle

The selected plan is visible on the farm and beside the crop selector. The next crop has a `Next in plan` badge; choosing a different crop shows an explanation and requires `Plant outside the selected plan` before saving. Without a plan, the best evaluated crops from the saved analysis are highlighted with their suitability scores.

Each bed tracks its own two-season progress. `Harvest crop` appears when the planting reaches its estimated harvest on the selected season date, including season preview. The `Harvest date` field defaults to that selected date and can be checked before recording. Moving the slider alone does not record a harvest. Recording saves the crop, planting and harvest dates, bed name, and plan season in the journal, then frees the bed on that date and makes the next planned crop available. Planting the following crop cannot precede the recorded harvest. Future dates are labeled `Planned harvest` rather than a completed field operation; switching back to an earlier date shows the earlier planting as a read-only history view. The farmer checks the actual crop before recording a completed harvest. After the second harvest the plan is complete and a fresh analysis is suggested; the sequence does not automatically repeat. Whole-field harvests update the previous crop sent to the next analysis when their date is reached. A partial bed's crop is not presented as the history of the whole field.

When planting matches the plan's recommended date, a supplied calendar harvest date sets the estimated harvest. Changing that date uses the catalog's illustrative duration instead of moving the source calendar. Dates remain estimates and do not certify maturity. Harvests and progress persist on this device, alongside existing care history.

## Improvements to the original idea

1. **Two seasons instead of a crop list.** Farmers understand how the next crop relates to the previous one and compare two alternatives with their current plan.
2. **Every suggestion has a reason.** For example: `Check soil moisture` → `Regional moisture is low. Check your soil before watering.` Show the observation date, units, spatial scale, and source quality nearby. Unknown information remains unknown.
3. **Actions update the journal; new observations update measurements.** Selecting `Watered` does not increase satellite-derived moisture. A gentle watering animation and `Irrigation logged` confirmation may acknowledge the action.
4. **Demo date controls advance by calendar days.** `Advance 1 day` demonstrates the next stage in seconds. Business dates use `YYYY-MM-DD`, with no time or timezone conversion. Actual planting records, backend-recommended dates, technical observation timestamps, and the demo date remain separate. Crop growth represents an estimated stage based on the planting date, labeled `Estimated growth stage`.
5. **Explain comparisons without invented percentages.** Initially use categories such as `Lower water demand` or `Requires irrigation`. Do not promise yield or water savings without a model and validation.

## Farm screen and navigation

On desktop, place narrow navigation on the left, the farm in the center, and `Today on your farm` with tasks and the selected planting area on the right. The data source and `Map / Farm` switch remain accessible. Analysis and comparison open in a panel while keeping the farm context visible.

On a phone, the farm occupies the upper part of the screen. Details for the selected planting area open in a bottom panel. Bottom navigation uses `Farm / Plans / Tasks / Journal`. Main actions work by touch without hover; map navigation must not conflict with boundary drawing. Provide `Finish boundary`, `Undo point`, and `Cancel`. Early demonstrations may use `Use demo boundary`.

The website MVP must include on-device persistence, farm renaming, planting-area editing, actual planting dates, server-recommended planting dates when available, tasks with due dates, action history, undo, the latest analysis date, retry, clear errors, and a confirmed demo reset. Deleting a planting area requires confirmation or a safe undo. Farm export/import is optional if time remains. Accounts and synchronization are outside the first 24 hours. Installation instructions belong to the later PWA stage.

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

`Wait for rain` is allowed only with a separate forecast that has an identified source and validity period. Historical NASA POWER or GPM rainfall is not a forecast. Any synthetic forecast in a test bench must be labelled `Demo forecast`. A genuine future-weather forecast service is outside this release. Recording a completed action is a user report, not evidence that field conditions changed.

## Environmental data and model scope

The live collector uses NASA POWER daily weather, SoilGrids static soil predictions and sourced calendar candidates. A POWER point represents its provider grid, not a measurement of each planting bed. Source availability and missing data remain visible. SMAP satellite retrievals and HLS imagery are not implemented product inputs; optional POWER moisture fields are modelled grid outputs and must not be labelled SMAP observations.

The project also has ten national annual-history models and twenty experimental Spanish provincial pre-season/mid-season models using MAPA labels and NASA POWER monthly point proxies. Eight original/candidate wheat/maize regional estimators retain a separate crop-mask input contract. Model coverage and temporal cutoffs differ; field accuracy is unverified. [Model/source inventory and limitations](data-sources.md).

The response keeps source URLs, versions, observation/retrieval dates, units, spatial scope and quality. Synthetic demo data, real saved observations and live provider responses remain distinct. No decorative confidence percentage is a substitute for validation.

## First-release boundaries

**Included:** a geographic field boundary, ten crop profiles, a supplied or clearly labelled example current plan plus two alternative two-season sequences, custom schematic beds, planting/harvest progression, care tasks, local journal/persistence, live API analysis and repeatable demo/error benches. The plans preserve reasons and unavailable dates rather than claiming every crop is locally scheduled. The available ML modes retain their documented geographic scope and warnings.

**Later work:** PWA installation and offline shell, multiple user accounts, cloud synchronization, push/background tasks, field-calibrated yield uncertainty, a validated whole-field water balance where local inputs are missing, market prices, IoT and a game economy. No coins, penalties or artificial plant deaths are driven by timers.

The [original short delivery plan](archive/2026-11-14-delivery-plan.md) is retained as project history. Current setup and checks are in the [development guide](orbitFarm-development.md) and [integrated recovery guide](../DATA_RECOVERY.md).
