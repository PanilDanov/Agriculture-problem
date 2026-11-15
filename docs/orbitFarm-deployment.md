# orbitFarm deployment on Vercel

The `lu1dgys-projects/orbitfarm` project serves the Vite frontend and FastAPI on [orbitfarm.vercel.app](https://orbitfarm.vercel.app/). New sessions start in live API mode and submit the field contour to `POST /v1/analysis` at the site's origin. Saved farms use browser local storage. The backend fetches source data on demand and caches responses in the function's temporary filesystem. [Vercel FastAPI hosting](https://vercel.com/docs/frameworks/backend/fastapi) · [Vercel function filesystem](https://vercel.com/docs/functions/runtimes#file-system-support)

## Build a release

Use Node.js 22.12 or newer and an authenticated Vercel CLI. The release script uses the Windows system `tar.exe` or `bsdtar` on macOS and Linux.

From the frontend checkout, install the frontend dependencies and build the release using the backend checkout as input.

```bash
npm ci
npm run deploy:stage -- ../Agriculture-problem
```

The script prints a new release directory under `.vercel/`. It builds Vite with same-origin analysis enabled and stages the FastAPI entry point, the analysis modules, the crop catalog and the provider configuration. Set provider endpoints and calendar files in the backend's `agronomy/field_sources.json`. The methodology, references and source gaps are documented in that checkout's `agronomy/field-data.md` and `agronomy/analysis-api.md`.

The package uses Python 3.12. The release script verifies the SHA-256 checksum of a pinned Amazon Linux 2023 Expat RPM and includes the shared library and license required by Rasterio's Linux wheel. Update `deployment/vercel/expat.json` with the package URL, checksum and archive paths when updating Expat. [Amazon Linux 2023 package sources](https://docs.aws.amazon.com/linux/al2023/ug/managing-repos-os-updates.html)

## Verify and publish

Run the following from the printed release directory.

```bash
vercel link --yes --scope lu1dgys-projects --project orbitfarm
vercel deploy --prod --skip-domain --yes --scope lu1dgys-projects
```

Open the staged deployment using Vercel project access. Create a farm and draw or enter a field boundary, then select **Analyze my farm**. Check that the browser sends `POST /v1/analysis` to the staged hostname, the response uses `nasa-api` or `nasa-cache`, and **Save water** and **Improve soil** each display two crops. Use [Vercel CLI curl](https://vercel.com/docs/cli/curl) for an authenticated HTTP check when needed. Revoke a temporary automation credential after the check if the CLI creates one.

Promote the verified deployment and repeat the browser check at the public domain.

```bash
vercel promote <staged-deployment-url> --yes --scope lu1dgys-projects
```

A direct public API smoke test can use the illustrative Iowa payload from the backend checkout.

```bash
curl https://orbitfarm.vercel.app/v1/analysis \
  -H "Content-Type: application/json" \
  --data-binary "@agronomy/example_analysis_request.json"
```

The browser shows **Planting date unavailable** when the published sources cannot support a field-level date. [Staged production deployments](https://vercel.com/docs/cli/deploy#skip-domain) · [Vercel promotion](https://vercel.com/docs/cli/promote)

## Public release verification

On November 15, 2026, a fresh browser session entered each contour through **Create farm** and submitted it to the public deployment. Both requests returned HTTP 200 with `nasa-api` and all ten crop options. The browser displayed both two-season plans.

| Field | Save water | Improve soil | Dates shown |
| --- | --- | --- | --- |
| France, CropHarvest row 3104 | Sunflower → barley | Sunflower → wheat | Unavailable for both provisional plans |
| Iowa, API example contour | Maize → wheat | Maize → wheat, provisional | May 13, 2027 and October 18, 2027 |

The France and Iowa requests took 3.9 and 4.4 seconds respectively in the browser smoke test. The run used production deployment `dpl_5vdYhgAa6xkf5QgNXukFy4HmXcfP`.
