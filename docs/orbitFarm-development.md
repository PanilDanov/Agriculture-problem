# orbitFarm: Website Development and Test Benches

The current delivery prioritizes a working browser application. PWA installation, service workers, push notifications, and home-screen behavior are deferred until the website flow is stable.

## Run locally

Use Node.js 22.12 or newer. Node.js 24 is used by CI.

```bash
npm ci
npm run dev
```

The development site uses `http://127.0.0.1:5173`. The application uses hash routes so a static host can serve deep links without an application server.

| Address | Purpose |
| --- | --- |
| `/#/farm` | Farm, custom planting beds, care actions, and the selected bed. |
| `/#/layout` | Polygon-bed layout editor with draft Undo, Redo, and Cancel. |
| `/#/setup` | Field boundary and farmer inputs. |
| `/#/plans` | Crop options and three rotation plans. |
| `/#/tasks` | Due and upcoming care tasks. |
| `/#/journal` | Saved action history and Undo. |
| `/#/lab` | Repeatable mock scenarios and integration tools. |

## Test benches

Test benches use the same interface, reducer, validation, and providers as the application. Loading a scenario replaces the saved demo state only after the application's reset confirmation. Each scenario has a fixed calendar date and visible `Demo data` labeling.

| Scenario | What to inspect |
| --- | --- |
| `normal` | A usable analysis, crop options, rotations, and regular care. |
| `dry-week` | A dry-condition explanation and a moisture-check task. |
| `missing-data` | Unknown inputs remain unknown; incomplete scores are not fabricated. |
| `stale-data` | Observation dates and outdated-data warnings remain visible. |
| `api-unavailable` | Analysis stays an error and offers retry; no silent successful mock fallback. |
| `empty-farm` | Boundary entry, input validation, and the complete creation journey. |

Growth stages and reminders use the browser's local calendar day. The season slider previews other dates in demo mode. Farm dates use `YYYY-MM-DD` for `demoToday`, task `dueOn` and `snoozedUntil`, journal `createdOn` and `previousSnoozedUntil`, and plot `plantedOn`. Technical `generatedAt`, `observedAt`, and `fetchedAt` metadata use ISO timestamps. Completing a task updates the journal and task status.

Field setup sends no planting date, season end, or timezone. The backend chooses planting recommendations and the planning horizon. A crop option can return optional `recommendedPlantingDate` as a calendar date; the actual planting record remains a separate editable date.

## Custom bed layouts

`Edit layout` opens a separate draft editor. The classic 3 × 2 arrangement is only the initial preset. Draw simple polygons on a 24 × 12 schematic grid, move entire beds, change individual corners, name beds, or use the row and patchwork presets. The editor allows up to 24 beds with up to 32 corners each. A 0.5-cell snap keeps placement predictable; numeric point and corner controls support keyboard use and touch screens.

Shared edges are allowed. Self-crossing, overlapping, zero-area, and out-of-bounds beds are rejected without replacing the last valid shape. The layout is separate from the geographic field boundary and does not change hectares, satellite sampling, or existing analysis.

Moving or reshaping a bed preserves its planting, care status, and journal. Removing a planted bed asks for confirmation when saving; associated current planting/tasks are removed, while journal history remains. Cancel discards the draft. Stable bed identifiers keep crops attached to the same bed even when its position or name changes.

Saved farms use state version 3. Existing version-1 and version-2 farms are migrated to date-only business fields while retaining plantings, tasks, journal, and analysis. Version-1 farms also receive the classic layout. Removed setup-season inputs are discarded; legacy business timestamps retain their written calendar date without timezone conversion. The existing storage key is retained for this migration. Damaged saved data remains protected by the recovery flow.

## Verification commands

```bash
node scripts/orbitFarm-verify-content.mjs
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run build` runs the English-content check, type checks, and domain tests before producing `dist/`. `npm run verify` runs the build and Playwright end-to-end checks. Playwright starts the production preview at `http://127.0.0.1:4173`; it does not test the development server. Its browser tests create a farm through the UI, analyze it, choose a plan, plant a crop, record care, and verify persistence after reload and field editing. Separate cases cover date-only scheduling, removed setup-date fields, manual invalid boundaries, unavailable analysis, API-provider persistence, task-specific Undo notices, runtime errors, and layouts at 390 and 320 px.

For local checks against an already installed Google Chrome, set `ORBITFARM_BROWSER_CHANNEL=chrome` when running `npm run test:e2e`. CI uses the Playwright-managed Chromium installed by the workflow.

Every test gets an isolated browser context. The main journey does not inject a ready farm into localStorage. External map tiles may fail or be blocked in tests; boundary tools and the rest of the application must remain usable.

Boundary regression checks cover closing a four-corner field by clicking its first corner, explicitly finishing a triangle, repeated clicks, coordinate duplicates, Undo, and mobile taps. A stored GeoJSON ring repeats its first coordinate once for closure; the interface counts only the distinct corners the user placed.

Layout checks cover a seventh non-rectangular bed, exact geometry after reload, crop/task/journal preservation during moves, overlap rejection, draft Undo/Redo/Cancel, and confirmed deletion. Touch checks draw a polygon and resize the viewport during editing at 320 and 390 px. These checks operate the real editor instead of seeding a finished layout into browser storage.

All selection fields share the custom listbox component. Browser checks cover keyboard navigation, incremental text search, dismissal, touch scrolling, menu placement near viewport edges, and resizing at 320 and 390 px. Headings and the wordmark use locally bundled Chakra Petch; body text uses Inter.

To run a separate review instance without replacing an existing development server, use `npm run dev -- --port 5175` and open `http://127.0.0.1:5175/`. Browser storage is isolated by port.

The GitHub Actions workflow runs locked dependency installation, the English-content check, Chromium installation, and `npm run verify`. It stores browser diagnostics after failures. A workflow file existing in the branch does not itself establish that a remote run has passed; inspect the actual run result.

## Data and deployment limits

Local development uses labeled demo fixtures by default. To use live field data, start the FastAPI service and select **Use API** in Test benches. The hosted site uses its own origin for live field analysis. API mode reports service failures in the interface. [Analysis contract](orbitFarm-analysis-contract.md) · [Local setup and data recovery](https://github.com/PanilDanov/Agriculture-problem/blob/feature/yield-prediction/DATA_RECOVERY.md)

Farm state is stored in browser local storage for each origin and profile.

Run the checks above before building the frontend and API release. [Vercel deployment guide](orbitFarm-deployment.md)
