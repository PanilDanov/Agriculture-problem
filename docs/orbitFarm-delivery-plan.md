# orbitFarm · 24-hour delivery plan: four sprints with visible results

Status: development plan. The application, CI pipeline, and tests below are not implemented yet. Every sprint must end with a working test bench that the team can open and inspect. Tests are added alongside the corresponding behavior.

## What we ship

One complete English user journey: **Draw farm → Scan → Compare plans → Plant → Care → Log action**. The farm persists between visits. The interface supports widths from 320 px, is separately checked at 390 px, and supports home-screen installation. Prototypes use explicitly labelled mock data. The final release passes at least one authentic NASA source from the selected challenge's Resources through the same adapter and UI; an authentic saved data snapshot is acceptable.

The comparison has three cards: **Current plan / Save water / Improve soil**, each showing a two-season crop sequence. The farmer supplies the first sequence. If no personal plan exists, use an explicitly labelled **Example current plan** and persist its example status. A previous crop alone does not define a future plan. Explain trade-offs in water demand, crop diversity, and soil constraints. A universal yield model is outside the first 24 hours. Plantings occupy 3–6 slots in a schematic farm labelled `Schematic layout — not to scale`; the geographic boundary selects the area for analysis.

The crop-rotation comparison addresses [Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/field-shift-adapting-farms-with-nasa-data/). Global Awards eligibility requires at least one NASA source from Resources and citations for the materials used in the submission: [GO Team clarification, November 5, 2026](https://github.com/nasa/spaceapps/discussions/1827). Authentic data is therefore a release requirement. Mock mode remains a development tool and a repeatable demonstration scenario.

## Sprints and acceptance

| Time from start | Work | Visible result | Acceptance gate |
| --- | --- | --- | --- |
| **0–4 h · Foundation and style** | Establish an original cozy 16-bit pixel-art direction viewed from above, with flat game panels. Build the responsive farm screen and loading/error/empty states; agree on the analytics contract; connect test-bench scenarios and minimal CI. | First preview URL, a phone layout, and `/lab` with selectable scenarios. | Readable from 320 px; every scenario has a direct link; build and checks already run in CI. |
| **4–10 h · Territory and decisions** | Let the user draw a polygon, confirm its fence, run a short scanning animation, and see environmental signals, recommendations, and three comparison cards. Collect soil information and a water-saving priority. | Complete journey from an empty map to a selected seasonal plan. | Invalid geometry cannot be confirmed; advice shows its reason, source, and observation time; missing data has its own state; animation never substitutes for analysis. |
| **10–18 h · Planting and care** | Assign crops and planting dates to 3–6 schematic slots. Add care tasks, a journal, snoozing, Undo, and persistence. Connect an authentic NASA snapshot or API through the common adapter. | A task appears above its plot and the user's action enters the journal. `Advance 1 day` reproduces the following day in Demo mode. | Slots cannot be occupied twice; repeated clicks do not duplicate actions; reload preserves state; a real NASA signal appears in the UI with provenance; a separate scenario reproduces API failure. |
| **18–24 h · Phone and release** | Configure the PWA and offline shell; check real phones and the production build; fix critical defects; prepare a 90-second demonstration. Reserve the final two hours for failures and rehearsal. | Working production URL, an installed phone app, a repeatable demonstration, and green CI. | Critical E2E passes against the built app; installation and relaunch are manually verified; a NASA source from Resources has passed through the common UI; a cached snapshot supports the demonstration without the analytics laptop; data mode is visible. |

Work in parallel: **UI/product** owns the journey and graphics; **analytics** owns sources, transformations, and explanations; **integration/QA** owns the contract, test benches, CI, and release. With three people, the UI owner also makes product decisions. With four, product/graphics can be a separate role. At each sprint review, everyone opens the same URL.

If time runs short, reduce the schematic farm to three slots, then cut extra crops and decorative animation. Preserve the farm boundary, a real NASA signal, explainable analysis, three rotation plans, one care task, the journal, and the complete demonstration journey.

## Architecture independent of an always-on laptop

**Frontend:** React + TypeScript + Vite, a static build, and Vercel as the primary host. This is a supported deployment path: [Vite static deployment](https://vite.dev/guide/static-deploy.html), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite). Use hash routing for portability to GitHub Pages. Select the map and geographic boundary editor in the first sprint. The game layout and its slots remain independent of the map.

**Data:** the UI calls `FarmDataProvider`. `MockProvider`, `NasaCacheProvider`, and `ApiProvider` return the same structures and pass the same contract checks. `dataMode` is `mock | nasa-cache | nasa-api`; UI labels are `Demo data / Cached NASA data / NASA data`. An API is a delivery mechanism, not a direct satellite connection. An authentic snapshot retains the original file/response, source, query parameters, observation time, and processing time. Mock scenarios have fixed inputs, dates, and responses without randomness.

**State:** persist the small farm, selected plan, plantings, and journal locally with a format version. localStorage is sufficient for the MVP; show write failures. A format change requires migration or a clear reset prompt with an export option. Local storage does not provide cross-device synchronization. Do not send precise farm coordinates to visitor analytics.

**Time:** business logic receives a `Clock`. Store actual UTC timestamps separately from demonstration time. Only explicit Demo mode enables `Advance 1 day` and scenario reset. Format timestamps in the farm's selected time zone on phones and in production. Advancing demo time does not launch background jobs or change satellite measurements.

**Team backend:** expose the local service to the deployed frontend through a stable **HTTPS tunnel**. In a phone browser, `localhost` means the phone, not the team's computer. A local HTTP address is not a reliable API endpoint for an HTTPS site. Restrict CORS to preview/production domains and local development, with the required preflight support. Keep secret keys on the backend; frontend build variables are public.

**API unavailable:** show `Analysis unavailable`, a saved result labelled `Last available analysis`, and Retry. Switching to `Demo data` requires an explicit user choice. Never silently replace a failure with fabricated analysis.

**PWA:** HTTPS, manifest, icons, `start_url`, `scope`, and standalone display; a service worker caches the shell and prepared snapshot. Installation differs between browsers, and offline behavior is a separate capability: [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable). Offline access includes the saved farm, journal, and clearly labelled snapshot; new analysis needs a connection. Map tiles have their own unavailable state. Push notifications are outside the first day; tasks are recalculated when the app opens. Application updates must not erase the farm.

## Analytics handoff contract

This is a v1 proposal to agree on within the first four hours. A stable contract matters more than the backend language.

| Operation / object | Fields and meaning |
| --- | --- |
| `POST /v1/analysis` | `schemaVersion`, `requestId`, `farmId`, `boundaryVersion`, `boundary` (GeoJSON Polygon, WGS84, **longitude, latitude** coordinates), `farmTimeZone`, `localInputs` (soil, irrigation access, crop history, and the farmer's plan for two future seasons or unknown), `priorities` such as saving water. Pass unknown inputs as unknown, never zero. |
| Analysis response | `analysisId`; required echoes of request `requestId`, `farmId`, and `boundaryVersion`; `generatedAt`; `dataMode: mock\|nasa-cache\|nasa-api`; `signals`, `cropOptions`, `rotationPlans`, and `limitations`. A response for an older boundary or superseded request must not replace the current result. |
| `signals[]` | Stable `signalId` for `evidenceRefs`; `origin: synthetic\|nasa`; observed variable type; value or `null`; unit; `observedAt`; `fetchedAt`; aggregation period; spatial resolution/footprint; quality; and `source`. A NASA source includes dataset, URL, and product version. A synthetic source includes the fixture name and an explicit synthetic-origin label. Overall `dataMode` describes delivery; mixed NASA/mock signals are individually labelled by `origin`. Soil moisture and relative air humidity are different variables. A forecast is not stored as an observation. |
| `forecast` · demo fixture only | Optional synthetic forecast for `rain-coming`: require `origin: synthetic`, `issuedAt`, `validAt`, `expiresAt`, value, unit, and a source containing the fixture name. The UI shows `Demo forecast` and ignores it after `expiresAt`. Real NASA observations omit this field. A live forecast-service integration is outside the first day. |
| `cropOptions[]` | Stable `cropId`, English name, compatibility conditions, `reasons[]` referencing signals/local inputs, and `caveats[]`. Prefer categories such as `Suitable` or `Needs irrigation` over an unsupported suitability percentage. |
| `rotationPlans[]` | Exactly three `planId` values: current, save-water, improve-soil. Each includes two seasons with crops, assumptions, qualitative trade-offs, and reasons. current requires `baselineOrigin: farmer\|example`: farmer uses the entered plan; example displays `Example current plan`. Do not add precise yield, water-use, or income forecasts without a validated model. |
| Plantings and care | Local `plotId`, `slotId`, `cropId`, and `plantedAt`; each slot belongs to a 3–6-cell schematic layout, not a geographic polygon. A task has `taskId`, `plotId`, `kind`, `dueAt`, `reason`, `evidenceRefs`, `status`, and `snoozedUntil`. For the MVP, the server returns analysis and the journal lives on the device. |
| Errors | Structured `code`, English `message`, and `retryable`; distinguish invalid geometry, no coverage, insufficient data, and temporary unavailability. HTTP 200 with an empty successful-looking analysis must not conceal an error. |

All timestamps use ISO 8601 in UTC; units are required. When combining data, do not confuse `generatedAt` with observation time. Farm boundaries and schematic plots have stable IDs. Calculate geographic area geodesically, not from map pixels.

The geographic boundary is a simple GeoJSON Polygon without holes: reject self-intersections, zero area, nonnumeric coordinates, and MultiPolygon. Editing the boundary marks its analysis stale. Game plots use a separate local grid: only existing slots inside the layout are valid, and two plots cannot occupy one slot. Keep `Schematic layout — not to scale` visible. The layout does not claim precise bed coordinates or cell-level measurements.

Irrigation recommendations remain prompts for checking conditions, considering crop stage, rainfall, irrigation access, and local observations. A single satellite moisture value cannot establish a precise water or fertilizer dose. Without soil testing and validated rules, show `Check soil nutrients`, not an application rate. Completing a task records **the user's report**, not a new physical measurement.

## Test benches that show progress

One `/lab` section (`/#/lab` with hash routing) uses the application's actual components, providers, and business logic. The public bench contains synthetic scenarios and a permitted public NASA snapshot, without user coordinates. Every scenario shows its data-origin mode.

| Scenario | Manual and E2E checks |
| --- | --- |
| `empty-farm` | Create/edit a boundary and enter the main journey. |
| `dry-week` | Low moisture and no expected rain explain the recommendation; a specific crop owns the task. |
| `rain-coming` | Synthetic only: with unchanged plantings, a `Demo forecast` containing `origin: synthetic`, `issuedAt`, `validAt`, and `expiresAt` changes the advice from checking irrigation needs to checking/waiting under a fixed rule. An expired forecast does not affect advice. A real forecast integration is not required. |
| `stale-or-missing-data` | Old or missing observations do not become zero moisture or confident advice. |
| `api-unavailable` | Retry, saved analysis, and an explicit choice to enter the demonstration; no silent fallback. |
| `care-cycle` | Advance Demo clock; exercise done/skipped/snoozed, Undo, reload, and the journal. |
| `nasa-snapshot` | Pass an authentic NASA snapshot through the common adapter; show source and date; never present cached data as a new satellite pass. |

One pinned fixture per scenario is shared by the frontend, analytics team, and tests. Rule changes explain why expected results change. Define input fixtures and expected results independently; do not compute the expectation with the same implementation being tested.

## Tests and build gates

| Level | Risk | Required cases |
| --- | --- | --- |
| **Unit · Vitest** | Invalid geometry or layout breaks placement. | GeoJSON rejects self-intersection, zero area, and invalid lon/lat ranges. The schematic grid rejects out-of-bounds slot IDs and duplicate occupancy; neighboring slots are valid. These are separate test sets. |
| **Unit · Vitest** | Time loses or duplicates tasks. | Before `dueAt`, a task is upcoming; at `dueAt`, it is due. Snoozed tasks do not reappear early. done/skipped tasks do not return after refresh. Test farm-local day changes and DST transitions with a fixed Clock. |
| **Unit / integration** | Incomplete data produces confident unsafe advice. | `null` remains unknown; signals beyond an agreed TTL become stale; a synthetic `Demo forecast` changes the fixed example but stops influencing advice after `expiresAt`; `Watered` does not change measured moisture; missing soil data never produces fertilizer dosage. |
| **Contract / integration** | Data delivery changes meaning. | Mock, NASA cache, and API pass one schema; unknown units/versions fail; `dataMode`, per-signal origin, and provenance are mandatory; match requestId/boundaryVersion and ignore old responses; timeout, no coverage, and HTTP errors have distinct states; three plans each contain two seasons; a missing personal plan is labelled as an example. |
| **Integration** | Action reports disappear or duplicate. | Double-click creates one journal entry; Undo restores status; write/reload preserves the plot and journal; localStorage failure is visible and is never reported as a successful save. |
| **E2E · Playwright** | Separate features fail as a complete journey. | Against the production build, draw/confirm the farm, scan, compare three plans, select a slot, advance demo time, complete a task, reload, and verify the journal. Separately cover unavailable API and a NASA snapshot with provenance. At 320 and 390 px, primary actions remain accessible without horizontal scrolling. |
| **Manual phone QA** | Emulation does not prove PWA installation. | Android/Chrome: install and launch from the home screen. iPhone/Safari: Add to Home Screen and standalone launch. Check reopening, farm persistence, and the offline shell. Record the devices and versions actually tested; clearly identify untested cases. |

E2E operates the UI. A deterministic provider or API interception is allowed, but creating a ready farm by writing directly to storage does not validate onboarding. Geometry needs valid and invalid examples. Markup snapshots and `true === true` do not replace these checks.

The proposed release command is `npm run verify`: **typecheck → unit/integration/contract tests → production build → E2E against production preview**. GitHub Actions runs the full `verify`: CI installs browser dependencies and serves production output rather than the dev server. Keep `build` as a separate package script. Deterministic CI needs no API secrets.

Production deployment is a separate step after successful `verify`: CI deploys the tested output for that exact commit SHA to Vercel, without rebuilding changed sources. Disable Vercel's automatic production Git deployments so they cannot bypass E2E; this configuration is required but not completed yet. If automatic Vercel preview deployments are enabled, their Build Command runs typecheck → unit/integration/contract tests → build without Playwright. A preview is not an accepted release until full CI passes. Browsers belong on the CI runner, not in the Vercel build environment.

Do not target an arbitrary coverage percentage. Violated invariants, a failing primary journey, and contract errors block release. Run a separate real-API smoke test when the backend is available; its success does not validate the entire NASA analysis pipeline.

## Release and demonstration

Vercel is the primary host. GitHub Pages remains a fallback for the same static build. If selected, verify base path, icon URLs, service-worker scope, and API URL on the actual published path. Freeze the production URL before the demonstration and keep the host stable in the final hour.

Demonstration: outline the field → see the fence and scan → read the reason for a crop recommendation → compare three two-season plans → assign a crop to a slot → `Advance 1 day` → `Mark watered` → inspect the journal. Keep data mode visible. Enable demonstration time explicitly. A real NASA signal passes through the same UI with its source, time, and resolution; synthetic forecasts/tasks carry separate demo labels. The satellite animation is not described as a new satellite pass.

Ready to demonstrate means: the complete journey succeeds twice in a row; an authentic NASA source from Resources is used and cited, with its saved snapshot available while the backend is off; the application launches from the home screen on at least one tested real phone; tests for the latest commit pass; and users can see each signal's limitations and origin. This is the team's technical acceptance gate, not a guarantee of competition eligibility.
