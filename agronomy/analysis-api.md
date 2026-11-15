# Two-season field analysis API

`POST /v1/analysis` accepts the orbitFarm v1 field request. It collects environmental data at the submitted boundary and compares two upcoming crop seasons. The response includes an example baseline or the supplied current plan, one Save water plan, and one Improve soil plan. Each plan contains two crop IDs in planting order. The same ten crop profiles are evaluated for every boundary. [Field collection and source settings](field-data.md) · [Example API request](example_analysis_request.json)

## Hosted API

The orbitFarm frontend uses [orbitfarm.vercel.app](https://orbitfarm.vercel.app/) and calls `POST /v1/analysis` on the same origin. From the backend repository root, submit the example field to the hosted endpoint.

```powershell
curl.exe https://orbitfarm.vercel.app/v1/analysis -H "Content-Type: application/json" --data-binary "@agronomy/example_analysis_request.json"
```

The Vercel deployment uses temporary storage for provider responses. The browser stores its farm locally. [Vercel function filesystem](https://vercel.com/docs/functions/runtimes#file-system-support)

## Run the API locally

Run these commands from the repository root in PowerShell. Use the separate field-data virtual environment.

```powershell
py -3.11 -m venv yield_prediction/data/processed/field_context/.venv
$fieldPython = "yield_prediction/data/processed/field_context/.venv/Scripts/python.exe"
& $fieldPython -m pip install -r agronomy/requirements-api.txt
& $fieldPython -m uvicorn agronomy.api:app --host 127.0.0.1 --port 8000
```

In a second terminal, post the example request.

```powershell
curl.exe http://127.0.0.1:8000/v1/analysis -H "Content-Type: application/json" --data-binary "@agronomy/example_analysis_request.json"
```

In the orbitFarm frontend, open **Test benches**, set **API base URL** to `http://localhost:8000`, select **Use API**, and analyze the selected field. The API allows the default Vite origins `http://127.0.0.1:5173` and `http://localhost:5173`. Set `ORBITFARM_ALLOWED_ORIGINS` to comma-separated origins for that installation. `ORBITFARM_SOURCE_CONFIG` and `ORBITFARM_CACHE_DIR` override the collector settings and cache. Set `ORBITFARM_OFFLINE=1` to replay cached source responses. `GET /health` is available for a local startup check.

The server calculates WGS84 geodesic field area, verifies the strict v1 request, and echoes the request, farm and boundary identifiers. A source failure responds with HTTP 503 when NASA weather is unavailable. A successful lookup with no historical weather coverage returns HTTP 422 with code `NO_COVERAGE`. A calendar gap can coexist with a successful analysis.

## Choose the seasons and dates

The planner starts from the approximate local solar date of the field and considers a 730-day horizon. It checks the date sequence using the appropriate planting and harvest windows. The initial sowing day is the published typical day or the published earliest day when a typical date is unavailable. If the first harvest runs past the second crop's typical sowing day, the planner can move the second sowing day inside its published window. It shifts the representative harvest by the same number of days when the shifted harvest fits the published bound. When that harvest cannot be supported, the proposed sowing can be shown with unknown harvest and the plan stays provisional.

Exact recommended dates require a published day and a location-qualified source. A Sacks cell inherits the original observation's geographic level. State, province and sub-state observations can supply a recommended day in the corresponding grid. Confirmed FAO agroecological zones can also qualify. National Sacks observations can shape a provisional comparison, and country-level FAO or GGCMI entries remain regional or modeled context. Each crop and season returns null for unsupported recommendations. Season two needs a supported first harvest before it can show its own date. The user supplies the field boundary and available field inputs. The service chooses the dates. [Sacks calendar files and geographic metadata](https://sage.nelson.wisc.edu/data-and-models/datasets/crop-calendar-dataset/netcdf-0-5-degree/) · [FAO Crop Calendar](https://api-cropcalendar.apps.fao.org/) · [GGCMI](https://zenodo.org/records/5062513)

Both objectives first prefer a usable sequence with two locally supported seasons, then a usable comparison timeline, available calendar evidence, fewer crop-host risks and repetitions, dated candidates and fewer soil conflicts. A provisional plan remains visible when stronger evidence is unavailable. If the field request includes the farmer's existing sequence, it becomes the baseline in supplied season order. Otherwise the clearly labeled comparison repeats the previous crop or the first crop of the Save water plan.

## Save water

The service requests four completed calendar years of daily NASA POWER data in local solar time. It derives grass-reference ET₀ with the daily FAO-56 Penman–Monteith equation using temperature, dew point, gridded solar radiation, surface pressure, 2 m wind and the grid elevation. It uses zero daily soil heat flux, bounds the relative radiation ratio at 0.3 and 1.0, and leaves ET₀ unavailable when the available fields or solar geometry cannot support the calculation. [NASA POWER daily inputs](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) · [FAO reference method](https://www.fao.org/4/x0490e/x0490e06.htm) · [FAO daily example](https://www.fao.org/4/x0490e/x0490e08.htm)

For each calendar season, replay its planting-to-harvest interval against the historical daily series. On each day, calculate the positive part of `peak reference Kc × ET₀ − same-day precipitation`. Use the maximum reference Kc in the crop profile so the screen can compare common calendar intervals with unknown crop stages and cultivars. A value requires at least three complete historical seasons. The two-season value is the sum of crop-level median historical totals. When the historical comparison is unavailable, the shortlist uses the reference Kc and available field evidence. [Crop coefficients and source references](crop_profiles.json) · [FAO standard crop evapotranspiration](https://www.fao.org/4/X0490E/x0490e0a.htm)

`waterScreenMm` is a relative historical dry-day screen in millimeters. It omits rain carried between days, field infiltration losses, application losses and current root-zone water. A field-inlet allocation is returned as context. A usable allocation comparison requires an allocation period, application efficiency and a validated field water balance.

## Improve soil

Use pH and texture from farmer-reported values or soil tests when supplied. Fill missing values from SoilGrids topsoil where available. The soil screens compare these inputs against the team's documented reference ranges and texture lists, which provide soft compatibility signals. Check catalogued carry-over risks at both transitions, from the supplied previous crop to season one and from season one to season two. Prefer different crop families and a legume before another family among comparable schedules. Nodulation and residue management affect how much benefit a farm receives. When soil criteria tie, prefer a different sequence from the Save water plan before using water as a secondary sort. An Improve soil plan needs a locally scheduled crop-family change and both soil indicators to be marked supported. [Team crop table and source review](data-audit.md) · [Host risk rules and references](crop_profiles.json) · [USDA ARS field rotation study](https://www.ars.usda.gov/research/publications/publication/?seqNo115=431508)

## Response and verification

The frontend displays each plan's optional `seasons`, nullable `waterScreenMm`, and `planStatus`. Provenance is available through the source detail and response metadata. Full crop suitability scores remain null until the agreed water adequacy component can be evaluated. Saved analyses and demo responses can omit the optional season fields.

The tests check request validation and CORS, date order including year boundaries, published-window adjustment, national calendar uncertainty, reactions to different previous crops, water-screen completeness, and the FAO Example 18 ET₀ calculation. Run them from the same environment.

```powershell
& $fieldPython -m unittest discover -s agronomy/tests -v
```

The endpoint was checked using the cached source responses for the published CropHarvest validation boundaries in France, Ethiopia and Brazil. It also completed a live cold-cache request for the illustrative Iowa boundary on November 15, 2026. The historical period was 2022–2025.

| Field | Save water | Improve soil | Calendar evidence |
| --- | --- | --- | --- |
| France, CropHarvest row 3104 | Sunflower → barley, 860.0 mm | Sunflower → wheat, 980.2 mm | National calendar comparisons, with dates withheld |
| Ethiopia, CropHarvest row 43 | Potato → sorghum, 345.2 mm | Sorghum → potato, 345.2 mm | National calendar comparisons, with dates withheld |
| Brazil, CropHarvest row 463 | Sorghum → barley, 1,691.9 mm | Sorghum → barley, 1,691.9 mm | Both objectives selected the same provisional pair |
| Iowa, example boundary | Maize → wheat, 1,387.3 mm | Maize → wheat, diversification unresolved | Subnational planting days on May 13 and October 18, 2027 |

The Iowa request completed in 6.88 seconds from an empty source cache in the verification environment. A headless browser then submitted the same field through the frontend's API mode and rendered both season labels, the historical water screen, the provisional Improve soil card, and an unavailable planting date for lentil. [CropHarvest sample and source checks](field-data-validation.md)
