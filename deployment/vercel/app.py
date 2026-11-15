import os
import sys
from ctypes import CDLL, RTLD_GLOBAL
from pathlib import Path
from tempfile import gettempdir

from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

os.environ.setdefault("ORBITFARM_CACHE_DIR", str(Path(gettempdir()) / "orbitfarm-field-cache"))
os.environ.setdefault("ORBITFARM_REGIONAL_INPUT_DIR", str(Path(__file__).with_name("agronomy") / "regional_inputs"))

# Rasterio's Linux wheel links to Expat, which is absent from the Vercel runtime.
if sys.platform == "linux":
    CDLL(str(Path(__file__).with_name("native") / "libexpat.so.1"), mode=RTLD_GLOBAL)

from agronomy.api import app

frontend = Path(__file__).with_name("dist")


@app.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
@app.api_route("/index.html", methods=["GET", "HEAD"], include_in_schema=False)
async def frontend_index():
    # Vercel normalizes file timestamps. StaticFiles' mtime/size ETag can stay
    # unchanged across releases and make browsers reuse HTML with old asset URLs.
    return HTMLResponse(
        (frontend / "index.html").read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-store"},
    )


app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
