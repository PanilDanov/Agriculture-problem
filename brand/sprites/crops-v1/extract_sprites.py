#!/usr/bin/env python3
"""Losslessly extract the four quadrants from each generated crop sheet."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from PIL import Image


STAGES = ("seedling", "growing", "ready", "harvest")
CROP_NAMES = {
    "wheat": "Wheat",
    "barley": "Barley",
    "maize": "Maize",
    "sorghum": "Sorghum",
    "chickpea": "Chickpea",
    "lentil": "Lentil",
    "faba-bean": "Faba bean",
    "sunflower": "Sunflower",
    "potato": "Potato",
    "tomato": "Open-field tomato",
}


def bounds_dict(bounds: tuple[int, int, int, int]) -> dict[str, int]:
    left, top, right, bottom = bounds
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def extract(pack_root: Path) -> None:
    sources = json.loads((pack_root / "sources.json").read_text())
    output_dir = pack_root / "png"
    output_dir.mkdir(exist_ok=True)
    sprites = []
    max_edge_alpha = 0

    for source in sources["sheets"]:
        crop_id = source["cropId"]
        source_path = pack_root / source["file"]
        with Image.open(source_path) as sheet:
            if sheet.mode != "RGBA":
                raise ValueError(f"Expected RGBA, got {sheet.mode}: {source_path}")
            width, height = sheet.size
            if width % 2 or height % 2:
                raise ValueError(f"Sheet dimensions must divide evenly by 2: {source_path}")
            cell_width, cell_height = width // 2, height // 2
            for index, stage in enumerate(STAGES):
                x = (index % 2) * cell_width
                y = (index // 2) * cell_height
                frame = sheet.crop((x, y, x + cell_width, y + cell_height))
                rgba_bytes = frame.tobytes()
                alpha = frame.getchannel("A")
                alpha_bounds = alpha.getbbox()
                visual_bounds = alpha.point(lambda value: 255 if value > 128 else 0).getbbox()
                if alpha_bounds is None or visual_bounds is None:
                    raise ValueError(f"Empty frame: {crop_id}/{stage}")
                alpha_min, alpha_max = alpha.getextrema()
                if alpha_min != 0 or alpha_max != 255:
                    raise ValueError(f"Expected transparent and opaque pixels: {crop_id}/{stage}")
                edges = (
                    alpha.crop((0, 0, cell_width, 1)),
                    alpha.crop((0, cell_height - 1, cell_width, cell_height)),
                    alpha.crop((0, 0, 1, cell_height)),
                    alpha.crop((cell_width - 1, 0, cell_width, cell_height)),
                )
                edge_max = max(edge.getextrema()[1] for edge in edges)
                max_edge_alpha = max(max_edge_alpha, edge_max)
                if edge_max > 128:
                    raise ValueError(f"Visible artwork touches a cell boundary: {crop_id}/{stage}")

                filename = f"{crop_id}-{stage}.png"
                output_path = output_dir / filename
                frame.save(output_path, format="PNG", compress_level=9)
                with Image.open(output_path) as saved:
                    if saved.mode != "RGBA" or saved.size != frame.size or saved.tobytes() != rgba_bytes:
                        raise ValueError(f"RGBA pixel preservation failed: {output_path}")

                left, top, right, bottom = visual_bounds
                anchor_x = (left + right) / 2
                anchor_y = bottom
                sprites.append({
                    "name": f"crop/{crop_id}/{stage}",
                    "cropId": crop_id,
                    "cropName": CROP_NAMES[crop_id],
                    "stage": stage,
                    "file": f"png/{filename}",
                    "width": cell_width,
                    "height": cell_height,
                    "sourceFile": source["file"],
                    "sourceRect": {"x": x, "y": y, "width": cell_width, "height": cell_height},
                    "alphaBounds": bounds_dict(alpha_bounds),
                    "visualAlphaBounds": bounds_dict(visual_bounds),
                    "anchor": {
                        "x": anchor_x,
                        "y": anchor_y,
                        "normalizedX": round(anchor_x / cell_width, 6),
                        "normalizedY": round(anchor_y / cell_height, 6),
                        "basis": "bottom-center of visualAlphaBounds; not an anatomical root anchor",
                    },
                    "alphaRange": {"min": alpha_min, "max": alpha_max},
                    "maxBoundaryAlpha": edge_max,
                    "visualBoundaryClipping": False,
                    "sourceRgbaSha256": hashlib.sha256(rgba_bytes).hexdigest(),
                    "pngSha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
                })

    manifest = {
        "name": "orbitFarm crop sprites",
        "version": "1.0.0",
        "createdOn": sources["createdOn"],
        "generator": "built-in image_gen",
        "cropCount": len(sources["sheets"]),
        "spriteCount": len(sprites),
        "stages": list(STAGES),
        "sheetLayout": {"columns": 2, "rows": 2, "order": "left-to-right, top-to-bottom"},
        "coordinateSystem": "Pixels from top-left; bounds are x/y/width/height; anchors use continuous pixel-edge coordinates.",
        "alphaBoundsRule": "alpha > 0",
        "visualAlphaBoundsRule": "alpha > 128, used only for bounds and clipping checks; RGBA pixels are never modified",
        "limitations": [
            "Generated pixel-art-style raster artwork; exact native 32x32 pixel-grid compliance is not guaranteed.",
            "Growth stages are illustrative artwork, not validated phenological observations or timing models.",
            "Plant scales and ground anchors can vary between generated stages; position them in a common Figma frame before use.",
            "Near-transparent generated alpha noise may extend to cell edges; visible artwork does not touch a cell boundary.",
        ],
        "validation": {
            "allFramesNonEmpty": True,
            "allFramesRgbaPixelsPreserved": True,
            "allFramesHaveFullyTransparentAndFullyOpaquePixels": True,
            "allVisibleArtworkInsideCellBounds": True,
            "maxBoundaryAlpha": max_edge_alpha,
        },
        "sprites": sprites,
    }
    (pack_root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Extracted and verified {len(sprites)} RGBA sprites from {len(sources['sheets'])} sheets.")
    print(f"All frames preserve source RGBA pixels; maximum boundary alpha: {max_edge_alpha}/255.")


def archive(pack_root: Path) -> None:
    archive_path = pack_root.parent / "orbitFarm-crops-v1.zip"
    files = sorted(
        path for path in pack_root.rglob("*")
        if path.is_file() and not any(part.startswith(".") or part == "__pycache__" for part in path.relative_to(pack_root).parts)
    )
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for path in files:
            relative_path = Path(pack_root.name) / path.relative_to(pack_root)
            info = zipfile.ZipInfo(relative_path.as_posix(), date_time=(2026, 11, 14, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, path.read_bytes())
    with zipfile.ZipFile(archive_path) as result:
        if result.testzip() is not None:
            raise ValueError("Archive integrity check failed")
    print(f"Created {archive_path} with {len(files)} files.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", action="store_true", help="Also package the complete current pack as a ZIP.")
    parser.add_argument("--archive-only", action="store_true", help="Refresh the ZIP without extracting frames again.")
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parent
    if not arguments.archive_only:
        extract(root)
    if arguments.archive or arguments.archive_only:
        archive(root)
