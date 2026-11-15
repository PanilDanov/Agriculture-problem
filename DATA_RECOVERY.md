# Restore orbitFarm on another computer

Clone this integrated repository and use Python 3.11 and Node.js 22.12 or newer
(CI uses Node 24). From the repository root:

```bash
python3 scripts/orbitFarm-local.py setup
python3 scripts/orbitFarm-local.py check
python3 scripts/orbitFarm-local.py run
```

Open `http://127.0.0.1:8000/`. The launcher prepares isolated API/ML environments;
the checkout includes all 38 estimator artifacts and compact source snapshots.
See [the current deployment guide](docs/orbitFarm-deployment.md) for the same
container used locally and on Vercel. These instructions replace the earlier
two-branch frontend/backend installation.

Large original archives and provider caches are deliberately outside Git.
The [data-source guide](docs/data-sources.md) links the exact extraction and
training commands, citations, source hashes and coverage limits. Restoring
more data must preserve crop, geography, units and actual availability dates;
point weather is not a substitute for a crop-mask regional input.

CDS credentials belong only in the user's private `.cdsapirc` or environment.
Use the [Copernicus setup guide](agronomy/copernicus-data.md); never copy tokens
into Git, screenshots or provenance. Browser farms/layouts/journals remain in
local storage for each browser origin/profile and are not Git datasets.

The [historical separate-branch recovery notes](docs/archive/2026-11-15-separate-branch-recovery.md)
remain for reproducing the earlier experiments; they are not the current
installation path. Downloaded source workbooks, virtual environments and caches
can be regenerated using their documented scripts rather than committed.
