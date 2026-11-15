# NASA Space Apps 2026 submission copy

Team: [Team HaHaton](https://www.spaceappschallenge.org/2026/find-a-team/team-robert/?tab=project). Challenge: [Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/).

This file supplies factual project copy. It does not certify submission for judging. The team is preparing the required public demo; its URL must be added to the form. The official limit is **30 seconds for video or seven slides for a presentation**.

## Project name

orbitFarm — From orbit to your next season

## Summary

orbitFarm helps farmers turn Earth observations into understandable crop and rotation choices. Draw a field, enter its crop history and known management constraints, and compare two-season plans for ten crops. NASA POWER weather, ISRIC SoilGrids estimates, published calendars and explicit local measurements support source-linked crop screening and water calculations. Twenty experimental models combine NASA monthly weather with Spain's MAPA statistics to estimate pre-season and mid-season provincial yields; separate national and original regional models retain their own coverage. Each result exposes missing inputs, dates, geography and validation against a simple yield baseline. An interactive farm lets users record planting, care and harvests, then advance the rotation. Our goal is accessible, transparent planning for changing conditions: evidence and uncertainty stay visible, while farmers retain control of their decisions.

## Public links

- Final project: https://orbitfarm.vercel.app
- Complete source branch: https://github.com/PanilDanov/Agriculture-problem/tree/codex/submission-ready
- Demo: supplied separately by the team when ready.

## Project details

### From observations to a practical workflow

Choosing the next crop involves climate, soil, available water, crop history and the farmer's priorities. orbitFarm connects those considerations to an interactive field rather than presenting an unexplained score. Users draw a boundary, enter what they know, compare two-season rotation scenarios, record planting and care, and record a harvest to advance the plan. The crop catalog includes wheat, barley, maize, sorghum, chickpea, lentil, faba bean, sunflower, potato and open-field tomato. Saved farm records remain in the user's browser.

### NASA data in the calculation

The field-analysis API retrieves NASA POWER daily weather for historical temperature screening and weather evidence. A separate family of 20 experimental provincial models uses actual NASA POWER monthly temperature, precipitation and solar radiation at a fixed representative point, together with official Spanish MAPA annual crop statistics and published monthly calendars. All ten crops have separate pre-season and mid-season models. Pre-season features exclude target-season weather; mid-season features use only complete months before the scenario cutoff. Point proxies are explicitly distinguished from province-wide or crop-mask weather averages.

### Explainable decisions and water evidence

Crop reference screening reports temperature, pH, texture and water components. Incomplete components remain unknown; a known soil conflict excludes a crop under the reference policy. Seasonal water adequacy requires a documented net irrigation requirement and allocation for matching dates. A separate FAO-56 root-zone snapshot uses sourced measurements, ET0, crop coefficients, available water and depletion; missing or stale measurements remain explicit. Comparative rotation scenarios support exploration, not claims of measured future water savings or restored soil health.

### Models, validation and limits

The deployed bundle includes 20 NASA/MAPA provincial artifacts, ten national annual-history artifacts and eight original wheat/maize regional artifacts. National estimates use national yield history; the original regional family requires compatible AgERA5 crop-mask inputs. The families preserve separate geography and feature contracts. For frozen 2026 scenarios, all 20 provincial crop/mode combinations have coverage in Ciudad Real, Granada, Huesca, Lleida, Tarragona and Zaragoza; coverage elsewhere varies.

Provincial training keeps harvest years in temporal partitions and evaluates against the latest available observed yield. Thirteen of 20 models beat that baseline in both the overall holdout and conservative label-age check. Every provincial model remains experimental, and baseline failures stay visible. Retrospective data snapshots and representative weather points do not establish field-level accuracy or recreate historical publication-time availability. The interface identifies replay dates, source cutoffs, missing inputs and model versions.

### Implementation and intended impact

The application uses React, TypeScript and Vite; Python and FastAPI; and separately pinned scikit-learn, CatBoost and XGBoost dependencies. The complete stack runs on Vercel Container Runtime, with reproducible model snapshots, checksums and automated frontend, API and ML checks. The visual farm makes planning approachable while evidence views explain why a result is available or incomplete. We aim to support informed crop planning and farmer discussion; increased farm yield, reduced consumption and field-level agronomic performance have not been demonstrated.

Source code, methodology, validation reports, attribution, generated-art provenance and reuse conditions are available in the public repository. The project uses NASA resources without implying NASA endorsement.

Full source code, model artifacts and reproducible setup: https://github.com/PanilDanov/Agriculture-problem/tree/codex/submission-ready

## Super Intelligence disclosure

OpenAI Codex assisted with code, debugging, tests, integration, deployment and documentation. OpenAI image generation produced decorative farm, crop, companion and satellite artwork; prompts/provenance are retained. Observed NASA, MAPA, FAOSTAT and other source datasets are not AI-generated. Trained predictive models are separately documented with their actual inputs and temporal validation. Generated artwork must carry visible identification in submitted visuals. No generated artwork is intended to contain NASA logos, flags or mission identifiers. See [AI_USAGE.md](../../AI_USAGE.md).

## NASA resources

- [NASA POWER](https://power.larc.nasa.gov/)
- [POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/)
- [POWER Monthly API](https://power.larc.nasa.gov/docs/services/api/temporal/monthly/)
- [NASA Harvest CropHarvest](https://zenodo.org/records/5533193) — independent source-collection validation boundaries, rather than the operational province geometry.

## Other resources

The submission links the public repository and [third-party notices](../../THIRD_PARTY_NOTICES.md), plus the primary ISRIC, MAPA, FAO/FAOSTAT, CY-Bench, Copernicus/AgERA5 and IGN/CNIG sources catalogued there. The notice covers libraries, fonts and artwork. Source rights are not replaced by the original-code Apache 2.0 licence. Current Spanish selection boundaries use official IGN/CNIG data under CC BY 4.0; historical source references remain identifiable.

## Team completion steps

1. Upload the final demo publicly, verify its duration and access, and include visible SI-generated labels where generated artwork appears.
2. Add its URL to the team project form and review the saved copy and source links.
3. The team owner completes the declarations and **Submit for Judging** before the event deadline. Saving progress alone does not submit a project.
