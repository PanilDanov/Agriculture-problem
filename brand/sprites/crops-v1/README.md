# orbitFarm crop sprites v1

Ten crops, each with four transparent PNG sprites: **Seedling**, **Growing**, **Ready**, and **Harvest item**. The pack contains 40 individual RGBA PNGs at 627 × 627 px and ten original generated sheets at 1254 × 1254 px.

The crops are wheat, barley, maize, sorghum, chickpea, lentil, faba bean, sunflower, potato, and open-field tomato. All artwork was generated with the built-in `image_gen` tool. Exact prompts are saved in `generation-prompts.json`; original-output provenance is in `sources.json`.

The website labels rendered crop-illustration groups **AI-generated artwork**.
These source PNGs and original sheets are preserved unchanged and are not
watermarked exports. Keep a visible generation mark when presenting them in a
submission screenshot, recording or standalone illustration. See the full
[asset provenance](../../../docs/asset-provenance.md) and [AI disclosure](../../../AI_USAGE.md).

## Use in Figma

Generate the board locally with `python3 build-figma-board.py`, then drag the resulting `orbitFarm-crops-figma.svg` onto the Figma canvas. It embeds PNG sprites with editable vector labels; the plants remain raster artwork. The generated SVG and local import-session JSON are ignored exports, not source files.

To place individual sprites:

1. Drag the desired files from `png/` onto a Figma canvas, or use **Place image**.
2. Keep image proportions locked. Put each sprite inside a common-size frame so the surrounding layout stays stable when stages change.
3. Use names such as `crop/wheat/seedling`. The complete naming list and source rectangles are in `manifest.json`.
4. Align the visible plant to the ground baseline inside its frame. `visualAlphaBounds` and `anchor` provide placement references; the generated images do not all share an identical ground anchor.
5. Keep labels, controls, and task status as separate editable Figma layers. The artwork itself imports as raster image fills.

Every source sheet uses this order:

| Upper left | Upper right |
| --- | --- |
| Seedling | Growing |
| Ready (lower left) | Harvest item (lower right) |

## Validation and limits

The extraction is lossless: each individual PNG has exactly the RGBA pixels from its source quadrant, with no resizing, recoloring, redrawing, or alpha cleanup. All 40 frames are non-empty and contain fully transparent and fully opaque pixels. Artwork with alpha greater than 128 stays inside its cell. Very faint generated alpha noise can reach cell edges; this is retained in the files and recorded in the manifest.

These are generated pixel-art-style rasters, not guaranteed native 32 × 32 pixel-grid assets. Scaling them down in Figma can soften details; inspect artwork at the intended product size. Generated plants can vary in scale and baseline across stages. Growth artwork is illustrative and must not be presented as a validated biological growth or timing model.

## Reproduce extraction and packaging

Requires Python 3 and Pillow. From this directory:

```bash
python3 extract_sprites.py --archive
```

This rebuilds `png/` and `manifest.json`, verifies source-pixel preservation and alpha bounds, then creates the ignored local export `../orbitFarm-crops-v1.zip`. The ZIP and embedded SVG are omitted from Git because their original sources and generators are retained. To package the existing extracted sources without extracting again:

```bash
python3 extract_sprites.py --archive-only
```
