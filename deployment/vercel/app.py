import os
import sys
from ctypes import CDLL, RTLD_GLOBAL
from pathlib import Path
from tempfile import gettempdir

from fastapi.staticfiles import StaticFiles

os.environ.setdefault("ORBITFARM_CACHE_DIR", str(Path(gettempdir()) / "orbitfarm-field-cache"))

# Rasterio's Linux wheel links to Expat, which is absent from the Vercel runtime.
if sys.platform == "linux":
    CDLL(str(Path(__file__).with_name("native") / "libexpat.so.1"), mode=RTLD_GLOBAL)

from agronomy.api import app

app.mount("/", StaticFiles(directory="dist", html=True), name="frontend")
