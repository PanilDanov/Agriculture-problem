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
| `/#/farm` | Farm, planting slots, care actions, and the selected plot. |
| `/#/setup` | Field boundary and farmer inputs. |
| `/#/plans` | Crop options and three rotation plans. |
| `/#/tasks` | Due and upcoming care tasks. |
| `/#/journal` | Saved action history and Undo. |
| `/#/lab` | Repeatable mock scenarios and integration tools. |

## Test benches

Test benches use the same interface, reducer, validation, and providers as the application. Loading a scenario replaces the saved demo state only after the application's reset confirmation. Each scenario has a fixed clock and visible `Demo data` labeling.

| Scenario | What to inspect |
| --- | --- |
| `normal` | A usable analysis, crop options, rotations, and regular care. |
| `dry-week` | A dry-condition explanation and a moisture-check task. |
| `missing-data` | Unknown inputs remain unknown; incomplete scores are not fabricated. |
| `stale-data` | Observation dates and outdated-data warnings remain visible. |
| `api-unavailable` | Analysis stays an error and offers retry; no silent successful mock fallback. |
| `empty-farm` | Boundary entry, input validation, and the complete creation journey. |

The demo clock can advance one day. It changes task scheduling, not observation timestamps or measured soil moisture. Completing a task changes the journal and task status, not satellite measurements.

## Verification commands

```bash
node scripts/orbitFarm-verify-content.mjs
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run build` runs the English-content check, type checks, and domain tests before producing `dist/`. `npm run verify` runs the build and Playwright end-to-end checks. Playwright starts the production preview at `http://127.0.0.1:4173`; it does not test the development server. Its browser tests create a farm through the UI, analyze it, choose a plan, plant a crop, record care, and verify persistence after reload and field editing. Separate cases cover invalid dates, manual invalid boundaries, unavailable analysis, API-provider persistence, task-specific Undo notices, runtime errors, and layouts at 390 and 320 px.

For local checks against an already installed Google Chrome, set `ORBITFARM_BROWSER_CHANNEL=chrome` when running `npm run test:e2e`. CI uses the Playwright-managed Chromium installed by the workflow.

Every test gets an isolated browser context. The main journey does not inject a ready farm into localStorage. External map tiles may fail or be blocked in tests; boundary tools and the rest of the application must remain usable.

The GitHub Actions workflow runs locked dependency installation, the English-content check, Chromium installation, and `npm run verify`. It stores browser diagnostics after failures. A workflow file existing in the branch does not itself establish that a remote run has passed; inspect the actual run result.

## Data and deployment limits

Mock scenarios are development fixtures, not NASA evidence. Authentic NASA data and the team's local backend are separate integration work. API mode must expose failures instead of replacing them with synthetic analysis. Exact request fields remain documented in the [analysis contract](orbitFarm-analysis-contract.md).

Browser state is stored on the current device; there are no accounts or cross-device synchronization. Deployed sites need an HTTPS-reachable backend. A laptop's `localhost` URL cannot be used by a visitor's browser on another device.

Vercel and GitHub Pages can host `dist/`. Configure a release to deploy the same artifact/commit that passed verification. The initial workflow verifies the website and does not configure hosting credentials or publish a site.
