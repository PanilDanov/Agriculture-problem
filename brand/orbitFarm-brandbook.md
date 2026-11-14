# orbitFarm — starter brandbook

Product name: **orbitFarm**, with this exact casing. Name and domain availability have not been checked. All product content and project files use English.

**From orbit to your next season.**

orbitFarm turns farm conditions into a clear plan for planting, crop rotation, and daily care. Its visual identity is an original cozy 16-bit pixel farm with a satellite companion. Its recommendations explain the evidence, observation date, source, and data limitations.

## Personality and artwork

- Friendly, calm, and curious. Guidance supports the farmer's decisions without promising a guaranteed harvest.
- Cozy 16-bit pixel art: a slightly angled top-down view, tiled plots, wooden fences, small expressive plants, and dark green outlines. Use one perspective and consistent pixel density for every object. Stardew Valley is a mood reference; orbitFarm characters, interface, and artwork are original and use no copied game assets.
- Base sprites use a 16×16 or 32×32 px grid. Scale by whole numbers with nearest-neighbor resampling; object edges align with the pixel grid. Apply `image-rendering: pixelated` to game artwork, with no smoothing, gradients, or blur.
- Land and plants dominate the scene. Panels and labels remain flat and readable. Do not represent scientific measurements as decorative game meters without units.
- **Orbit-1** is the proposed satellite companion, with solar panels and a sprout on its body. It accompanies analysis and explains the result. Its status copy is `Analyzing latest available observations`.
- The wordmark is `orbitFarm`. A separate logo mark is **Planned**: an original pixel sprout inside an open orbit. At small sizes, use the mark alone. Minimum clear space is half the mark's height.
- Credit NASA in data sources. The product identity and satellite belong to orbitFarm; do not use the official NASA logo as the app mark or imply NASA endorsement.

## Palette

| Token | Color | Purpose |
| --- | --- | --- |
| `cream` | `#FFF8E8` | Main background |
| `white` | `#FFFFFF` | Panels and cards |
| `ink` | `#203D32` | Main text and outlines |
| `green` | `#286B45` | Primary button and active action |
| `mint` | `#DDEDC5` | Selected plan and calm state |
| `sky` | `#BDE4F0` | Data and water; satellite backdrop |
| `ochre` | `#F4C95D` | Attention and tasks requiring a check |
| `clay` | `#C96A4B` | Soil and decorative details |
| `muted` | `#57665B` | Secondary text |
| `border` | `#D6DEC9` | Subtle dividers |

Every status has a label and an icon: `Needs a check`, `Done`, `Skipped`, `Snoozed`, or `Data unavailable`. Color reinforces meaning. Primary actions use white text on `green`; secondary actions use `ink` on `cream` or `white`; attention states use `ink` on `ochre`.

Contrast was calculated from sRGB relative luminance: `ink/cream` **11.18:1**, `white/green` **6.40:1**, `muted/cream` **5.74:1**, `ink/mint` **9.57:1**, `ink/sky` **8.74:1**, and `ink/ochre` **7.53:1**. Reserve `clay` for artwork: neither white nor `ink` body text on this background meets 4.5:1. Do not use `border` as the only indicator of an input or focus state; interactive boundaries use `green`.

## Typography and dimensions

Headings and the wordmark use **Chakra Petch**, weight 700, for clear Latin letterforms with squared retro details. Body text uses **Inter**, weights 400/500/600. Heading fallback: `Inter, system-ui, sans-serif`; body fallback: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Pixel styling remains in game artwork; longer text, values, and actions stay easy to read. Fontsource packages bundle the fonts locally under the SIL Open Font License so the demo does not depend on a CDN.

| Level | Desktop | Mobile | Weight / line height |
| --- | --- | --- | --- |
| Page title | 32 px | 28 px | 700 / 1.25 |
| Section title | 24 px | 24 px | 700 / 1.25 |
| Body | 16 px | 16 px | 400 / 1.5 |
| Label | 14 px | 14 px | 600 / 1.4 |
| Caption | 12 px | 12 px | 400 / 1.4 |

The interface uses an 8 px spacing grid, with 4 px for small internal spacing. Cards, buttons, and badges use a 4 px radius. Card padding is 24 px on desktop and 16 px on mobile. Outlines are 2 px `ink`; shadows have a solid 4 px offset with no blur, using `ink` or `clay` for soil objects. Buttons are at least 48 px tall. All touch targets are at least 44×44 px. Focus uses a visible 2 px `green` outline with a 3 px offset. Pixel borders do not reduce hit areas.

Sprite motion uses short sequences of 2–4 keyframes. With reduced motion, show a static state and text progress. Do not apply `image-rendering: pixelated` to body text, forms, or the entire page.

Primary design widths are **1440 px** for desktop and **390 px** for mobile. The minimum supported width is **320 px**. On phones, the map occupies the upper screen and selected planting details appear in a lower panel. Tasks must not require precise dragging. Provide an alternative: select cells → `Plant here`.

## Product voice

Short statement → action → reason. Avoid agronomic certainty when evidence is missing. No punishments, dying plants, or stressful game timers for skipped recommendations.

| Situation | English copy |
| --- | --- |
| Start | `Draw your farm` / `Use demo farm` |
| Boundary confirmed | `Your farm is ready. Let's look at the latest observations.` |
| Analysis | `Analyzing latest available observations` |
| Priority selection | `What matters most this season?` |
| Plan | `Compare rotation plans` / `Use this plan` |
| Moisture check | `Check soil moisture` — `Regional conditions suggest a dry spell. Check the soil before irrigating.` |
| Irrigation | `Log irrigation` / `Mark as done` / `Skip` / `Remind me tomorrow` |
| Soil nutrients | `Check soil nutrients` — `Add a soil test to guide nutrient decisions.` |
| Missing data | `We couldn't load new observations. Your saved farm is still available.` |
| API connection | `Analysis service is unavailable. Retry or switch to Demo data.` |

Show `Wait for rain` only when a separately credited forecast source supports it; historical NASA observations are not a forecast. Do not infer fertilizer doses from a satellite index.

## Data trust

A visible status applies to the specific observation or result, rather than to the entire product:

- **`Demo data`** — a synthetic scenario. Every value and assessment is illustrative.
- **`Cached NASA data`** — saved real observations; show both observation and retrieval dates.
- **`NASA data`** — retrieved NASA observations, not a live satellite feed.
- **`Outdated observations`** — data is stale under source-specific freshness rules.
- **`Data unavailable`** — the value is missing; show `—`, not `0`.

A recommendation includes `Why this?`, the observation date, source, and spatial scale. Logging irrigation changes the journal and task state; measured moisture changes only with a new observation. When mock and real sources are mixed, label each metric individually.

## Figma: current starter set

The editable [Figma · Brand & Product v0.1](https://www.figma.com/design/ZD6mSeYogRklG9vO6eMUCJ) contains **33 variables** and **7 text styles** prefixed with `orbitFarm/`. It has three pages:

- **`00 Brand`** — wordmark, palette, typography, farm illustration, and voice examples.
- **`01 Components`** — four component families with 16 variants: **Button** — Primary / Secondary × Default / Disabled / Focus; **Task** — Due / Done / Skipped / Snoozed; **Data badge** — Demo / Cached / NASA; **Metric** — Available / Missing / Stale.
- **`02 Screens`** — five screens: **Draw**, **Compare**, **Farm desktop**, **Care mobile**, and **Journal mobile**.

The Screens page also includes local **Rotation plan / Base** and **Mobile navigation / Item** components used in the layouts. Satellite analysis is described as a transition between Draw and Compare; the starter set has no separate Scan screen.

The file includes editable pixel farm artwork and a wordmark. A separate logo mark, app icons, sprite atlas, and animation states for **Orbit-1** are **Planned**; individual sprites have not been exported. Additional responsive screens and extended game components remain implementation work.

Shared colors, dimensions, and radii are stored in [orbitFarm-tokens.json](orbitFarm-tokens.json). Components use auto-layout, and instances share the same tokens. This is a hackathon starter brandbook to expand after the working vertical flow is complete.
