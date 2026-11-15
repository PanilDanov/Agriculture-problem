# Artwork provenance

orbitFarm uses generated pixel-art-style illustrations. This inventory identifies
their recorded origin and derived uses. It does not describe them as manually
drawn assets or as NASA imagery. See [AI_USAGE.md](../AI_USAGE.md) and the
[machine-readable disclosure](ai-usage.json).

| Asset family | Runtime or source files | Recorded generation evidence |
| --- | --- | --- |
| Forty crop-stage illustrations | `brand/sprites/crops-v1/sheets/`, `brand/sprites/crops-v1/png/` | [`sources.json`](../brand/sprites/crops-v1/sources.json), [`generation-prompts.json`](../brand/sprites/crops-v1/generation-prompts.json), [`manifest.json`](../brand/sprites/crops-v1/manifest.json) record built-in `image_gen`, original output names and extraction metadata. |
| Runtime crop seedlings and growing stages | `public/assets/farm/crops/*-seedling-v1.png`, `*-growing-v1.png` | The [farm source record](../brand/sprites/farm-v2/sources.json) links these derivatives to the crop-stage manifest. |
| Ten mature field crop sprites | `public/assets/farm/crops/*-field-v2.png` | [Farm source record](../brand/sprites/farm-v2/sources.json): `image_gen`, ten-crop sheet prompt and 32×32 runtime frames. |
| Meadow and scene background | `public/assets/farm/orbitFarm-meadow-v2.png` | [Farm source record](../brand/sprites/farm-v2/sources.json): `image_gen`, scenery prompt and 400×280 runtime dimensions. Seasonal terrain and vegetation are code-rendered derivatives of the scene. |
| Astronaut dog | `public/assets/farm/orbitFarm-dog-astronaut-v1.png` | [Farm source record](../brand/sprites/farm-v2/sources.json): `image_gen`, twelve-frame prompt and 48×34 runtime frames. |
| Active NASA team-page dog avatar, v2 | `brand/submission/orbitFarm-team-avatar-v2.png` | [V2 provenance](../brand/submission/provenance-v2.json): built-in `image_gen` edit of v1; embedded text removed at the user's explicit request. AI origin, exact edit prompt and checksums remain disclosed. |
| Retained marked avatar alternative, v1 | `brand/submission/orbitFarm-team-avatar-v1.png` | [Original avatar provenance](../brand/submission/provenance.json): built-in `image_gen`, dog identity reference, exact prompt, output dimensions/checksum and embedded **AI-generated** mark. |
| Fictional Orbit-1 satellite | `public/assets/orbit-1/orbit-1-scanner-v1.png` | [`source.json`](../brand/sprites/orbit-1-v1/source.json) records `image_gen`, date, prompt and project emblem; [component notes](../brand/sprites/orbit-1-v1/README.md) describe code animation. |

The exact image-model version was not recorded. Farm-v2 metadata contains prompts
and runtime paths, but does not identify every original generation output or the
reference mockup's full history. Those missing details have not been fabricated.
Historical prompts and source records remain verbatim. Descriptions such as
“hand-crafted” inside a historical prompt are style instructions, not a claim of
manual authorship.

## Visible marks and exports

`ArtworkMark` renders **AI-generated artwork** with a solid high-contrast backing.
It appears within the farm and scanner scenes and with standalone satellite and
crop-illustration groups. Composite marks cover the generated elements within
that composition, including the farm dog and plants. They do not change data
source badges or the meaning of a scientific result.

Runtime raster pixels, source masters and historical prompts are unchanged.
The raw runtime PNGs are not themselves watermarked exports. The extraction script can
rebuild a sprite archive; that archive is not a tracked submission artefact.
Keep the visible mark when taking website screenshots or recording a
demo. If a raw sprite is presented separately, give that presentation a visible
generation mark too. The [2026 submission guide](https://www.spaceappschallenge.org/resources/project-submission-guide)
requires visible identification of generated images and video.

The selected team-header avatar is the separately generated **v2** portrait.
Its in-image label was removed at the user's request, while its AI disclosure
remains in the project description and provenance. This record does not claim
that the unmarked avatar satisfies an in-image watermark requirement. The
marked v1 remains available as an alternative; the website's HTML/CSS artwork
marks are unaffected by the avatar edit.

## Scope and identity

The source crop masters are 1254×1254 pixels, with 627×627 extracted cells.
Runtime sprites use smaller frames; generated masters do not guarantee a native
16×16 or 32×32 pixel grid. Illustrative growth stages do not determine crop timing.

The project emblem and the fictional Orbit-1 character are orbitFarm artwork;
they are not an actual NASA spacecraft or mission identifier. NASA sources are
credited for data. The project does not claim NASA affiliation or endorsement.
The historical Stardew Valley reference describes visual direction, rather than
an asset supplier for the generated files listed above.
