"""Optional local native-library setup shared by CLI and HTTP inference."""

import ctypes
import os
from pathlib import Path
import sys
import threading

_handles = []
_loaded = False
_lock = threading.Lock()


def prepare_native_runtime():
    """Preload an explicitly configured OpenMP library without system changes."""
    global _loaded
    with _lock:
        if _loaded:
            return
        directory = os.environ.get("ORBITFARM_NATIVE_LIB_DIR")
        if directory:
            name = "libomp.dylib" if sys.platform == "darwin" else "libgomp.so.1"
            path = Path(directory).expanduser().resolve() / name
            if not path.is_file():
                raise RuntimeError(f"Configured native runtime is missing {name}")
            _handles.append(ctypes.CDLL(str(path), mode=ctypes.RTLD_GLOBAL))
        _loaded = True
