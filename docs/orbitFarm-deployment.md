# orbitFarm: Vercel Deployment

Publish the production files that passed verification. The packaging step copies the existing `dist/` tree into Vercel's static [Build Output API](https://vercel.com/docs/build-output-api) directory and writes `.vercel/output/config.json` with `version: 3`. It does not rebuild the application, upload source files, or configure credentials.

## Current deployment

- Website: [orbitfarm.vercel.app](https://orbitfarm.vercel.app/).
- Test benches: [orbitfarm.vercel.app/#/lab](https://orbitfarm.vercel.app/#/lab).
- Vercel project: `lu1dgys-projects/orbitfarm`.
- First release application source: `ef9ecca885381e7d01e6aad8fcc138833d69288a`, verified with 54 unit tests and 22 browser tests before packaging.
- The first release is a static demo. No always-on laptop or backend is required for its demo flow.
- Git-triggered deployments are not connected. Production updates use the verified prebuilt flow below.

## Release commands

Use Node.js 22.12 or newer, an authenticated Vercel CLI, and the intended account/project. Link the checkout to that project with `vercel link` before its first deployment; review the selected scope and project before continuing. The link is stored locally in the ignored `.vercel/` directory.

```bash
npm run verify
npm run deploy:prepare
vercel deploy --prebuilt --prod
```

For this project, use `vercel link --yes --scope lu1dgys-projects --project orbitfarm` once in a new checkout. Use `vercel deploy --prebuilt --prod --yes --scope lu1dgys-projects` to publish subsequent verified builds. A fresh checkout must authenticate with Vercel before linking.

`npm run verify` must finish successfully for the current source revision. `deploy:prepare` requires `dist/index.html`, replaces only the generated `.vercel/output/static/` directory, and copies the complete build, including fonts and image assets. Do not edit `dist/` between verification, packaging, and deployment. `vercel deploy --prebuilt --prod` uploads the prepared artifact without a second build; see the [Vercel deploy command](https://vercel.com/docs/cli/deploy).

## Public verification

Open the returned production URL and check:

- `/#/farm`: the farm, fonts, satellite, and primary actions load.
- `/#/setup`: boundary tools and the input form work.
- `/#/plans`: an analysis resolves to the three demo plans.
- `/#/journal`: a care action remains after reload.
- `/#/lab`: repeatable scenarios and their explicit data labels are available.

The first public release uses synthetic demo data. Authentic NASA observations and the team's backend remain separate integration work. A deployed frontend needs an HTTPS-reachable backend; a visitor's `localhost` is not the team's computer. Keep API secrets on the backend.

## Later updates

Continue design and application changes on `frontend`, run `npm run verify`, and repeat the packaging/deployment commands. This flow does not enable automatic Git deployments. No Vercel credentials, local project metadata, or generated output belong in Git.
