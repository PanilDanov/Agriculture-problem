# orbitFarm

**From orbit to your next season.**

[Open orbitFarm](https://orbitfarm.vercel.app/) · [Test benches](https://orbitfarm.vercel.app/#/lab)

A cozy 16-bit farm companion that turns Earth observations and local knowledge into explainable crop rotations and everyday care reminders.

Frontend work continues on the `frontend` branch. All project content, code, comments, and interface copy must be in English.

- [Project overview](orbitFarm.md)
- [Product specification](docs/orbitFarm-product.md)
- [24-hour delivery plan](docs/orbitFarm-delivery-plan.md)
- [Local development and test benches](docs/orbitFarm-development.md)
- [Vercel deployment and updates](docs/orbitFarm-deployment.md)
- [Proposed analysis request contract](docs/orbitFarm-analysis-contract.md)
- [Example analysis request](contracts/orbitFarm-analysis-request.example.json)
- [Brandbook](brand/orbitFarm-brandbook.md)
- [Crop sprite pack · 10 crops, 4 images each](brand/sprites/crops-v1/README.md)
- [Plantable crop catalog · IDs and demo behavior](docs/orbitFarm-crop-catalog.md)
- [Editable Figma design](https://www.figma.com/design/ZD6mSeYogRklG9vO6eMUCJ)

Development now prioritizes the working website and reproducible test benches. PWA installation and home-screen behavior are deferred. Mock data remains visibly labeled; the local backend and authentic NASA data are separate integrations.

## Run the website

Use Node.js 22.12 or newer; CI uses Node.js 24.

```bash
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/#/farm` for the application or `http://127.0.0.1:5173/#/lab` for test benches. Run `npm run verify` for type checks, domain tests, a production build, and browser tests. Before the first browser test run, install Chromium with `npx playwright install chromium`. Check actual command and GitHub Actions results before treating a revision as verified.
