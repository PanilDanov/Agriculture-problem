#!/usr/bin/env python3
"""Package unchanged crop PNG files into a self-contained Figma import board."""

import base64
import hashlib
import json
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent
CROPS = [
    ("wheat", "Wheat", "Bread wheat"),
    ("barley", "Barley", "Long-awn grain"),
    ("maize", "Maize", "Corn"),
    ("sorghum", "Sorghum", "Grain sorghum"),
    ("chickpea", "Chickpea", "Grain legume"),
    ("lentil", "Lentil", "Grain legume"),
    ("faba-bean", "Faba bean", "Broad bean"),
    ("sunflower", "Sunflower", "Oilseed crop"),
    ("potato", "Potato", "Tuber crop"),
    ("tomato", "Tomato", "Open-field tomato"),
]
STAGES = [("seedling", "Seedling"), ("growing", "Growing"), ("ready", "Ready"), ("harvest", "Harvest item")]
SVG = "http://www.w3.org/2000/svg"
XLINK = "http://www.w3.org/1999/xlink"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", XLINK)


def element(tag, parent, **attrs):
    return ET.SubElement(parent, "{" + SVG + "}" + tag, {k: str(v) for k, v in attrs.items()})


def text(parent, value, x, y, size=18, weight=400, color="#203D32", **attrs):
    node = element("text", parent, x=x, y=y, fill=color, **attrs)
    node.set("font-family", "Inter, Arial, sans-serif")
    node.set("font-size", str(size))
    node.set("font-weight", str(weight))
    node.text = value
    return node


def main():
    root = ET.Element("{" + SVG + "}svg", {"width": "1440", "height": "1792", "viewBox": "0 0 1440 1792"})
    element("title", root).text = "orbitFarm: ten crops, forty sprite states"
    element("desc", root).text = "Self-contained Figma import board. Forty unchanged transparent PNG layers are embedded as data URLs. Text and board shapes remain vectors; crop artwork remains raster."
    element("rect", root, x=0, y=0, width=1440, height=1792, fill="#FFF8E8")
    element("rect", root, x=40, y=40, width=40, height=8, fill="#286B45")
    text(root, "orbitFarm / ASSET LIBRARY 01", 96, 51, 16, 600)
    text(root, "A little growth. A lot of possibility.", 40, 110, 40, 700)
    text(root, "10 crops · 4 visual states · Transparent PNG artwork", 40, 149, 20)
    text(root, "Import this SVG into Figma to place all 40 named image layers at once.", 40, 180, 16, color="#57665B")

    header = element("g", root, id="column-headings")
    element("rect", header, x=40, y=208, width=1360, height=48, fill="#203D32", rx=4)
    text(header, "CROP", 64, 239, 14, 600, color="#FFF8E8")
    centers = [468, 724, 980, 1236]
    for (_, title), cx in zip(STAGES, centers):
        text(header, title, cx, 239, 16, 600, color="#FFF8E8", **{"text-anchor": "middle"})

    hashes = []
    for i, (crop_id, name, subtitle) in enumerate(CROPS):
        y = 264 + i * 140
        row = element("g", root, id="crop-" + crop_id + "-row")
        element("rect", row, x=40, y=y, width=1360, height=132, fill="#FFFFFF" if i % 2 == 0 else "#F1F5E8", rx=4)
        element("rect", row, x=40, y=y, width=4, height=132, fill="#286B45")
        text(row, f"{i+1:02d}", 64, y+34, 13, 600, color="#57665B")
        text(row, name, 64, y+66, 24, 600)
        text(row, subtitle, 64, y+94, 14, color="#57665B")
        for (stage_id, _), cx in zip(STAGES, centers):
            path = ROOT / "png" / f"{crop_id}-{stage_id}.png"
            raw = path.read_bytes()
            data_url = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
            image = element("image", row, id=f"crop-{crop_id}-{stage_id}", x=cx-64, y=y+2, width=128, height=128, preserveAspectRatio="xMidYMid meet")
            image.set("{" + XLINK + "}href", data_url)
            hashes.append({"id": image.get("id"), "source": "png/" + path.name, "sha256": hashlib.sha256(raw).hexdigest()})

    text(root, "VISUAL ARTWORK", 40, 1702, 13, 600)
    text(root, "Growth stages are illustrative. Sprite artwork does not encode crop suitability, measurements or growth timing.", 40, 1730, 15, color="#57665B")
    text(root, "Original orbitFarm artwork · Built-in image_gen · Source PNG pixels preserved", 40, 1760, 14, color="#57665B")
    target = ROOT / "orbitFarm-crops-figma.svg"
    ET.ElementTree(root).write(target, encoding="utf-8", xml_declaration=True)

    parsed = ET.parse(target).getroot()
    images = parsed.findall(".//{" + SVG + "}image")
    assert len(images) == 40
    assert len({n.get("id") for n in images}) == 40
    for image, expected in zip(images, hashes):
        embedded = base64.b64decode(image.get("{" + XLINK + "}href").split(",", 1)[1])
        assert hashlib.sha256(embedded).hexdigest() == expected["sha256"]
    state = {
        "status": "blocked_tool_rate_limit",
        "destinationFileKey": "ZD6mSeYogRklG9vO6eMUCJ",
        "reason": "Figma MCP Starter-plan tool call limit reached before any file mutation.",
        "canvasMutated": False,
        "fallback": "orbitFarm-crops-figma.svg",
        "fallbackImageCount": len(images),
        "fallbackDimensions": [1440, 1792],
        "embeddedSourcePixelsUnchanged": True,
        "images": hashes,
    }
    (ROOT / "figma-import.json").write_text(json.dumps(state, indent=2) + "\n")
    print(json.dumps({"file": str(target), "imageLayers": len(images), "bytes": target.stat().st_size, "embeddedPNGHashesMatch": True}))


if __name__ == "__main__":
    main()
