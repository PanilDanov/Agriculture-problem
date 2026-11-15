# orbitFarm

**From orbit to your next season.**

orbitFarm is Team HaHaton's project for [Field Shift: Adapting Farms with NASA Data](https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/), NASA Space Apps Challenge 2026.

The implemented journey is **draw a field → analyze source evidence → compare rotations → record planting → care → harvest → plant the next crop**. All ten product crops are supported in the planting lifecycle. Farm records persist in the browser.

The public application runs the React/TypeScript website, Python analysis API and separate pinned ML runtime together at [orbitfarm.vercel.app](https://orbitfarm.vercel.app/#/farm). NASA POWER weather, ISRIC soil estimates, published crop calendars and explicitly sourced farmer inputs remain distinguishable. Live analysis does not use synthetic test-bench responses.

The model bundle contains 20 experimental NASA/MAPA provincial crop/mode models, ten FAOSTAT national models and eight original wheat/maize regional artifacts. These families have distinct input requirements and coverage; they do not establish field-level accuracy. Missing inputs, historical replays and baseline failures are disclosed.

See the [README](README.md) for capabilities, limitations and quick start; [submission material](docs/submission/project.md) for the project description; [development](docs/orbitFarm-development.md) for verification; and [deployment](docs/orbitFarm-deployment.md) for hosting.

Original code, source data and generated artwork have separate attribution and reuse information in [third-party notices](THIRD_PARTY_NOTICES.md) and [AI usage](AI_USAGE.md). Earlier AgriWise naming survives only in compatibility filenames and historical material.
