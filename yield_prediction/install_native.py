"""Install a checksum-pinned, task-local OpenMP runtime on Apple Silicon macOS.

No system directories are changed. Linux deployments should install libgomp1.
The archive is a public conda-forge build; its license is retained alongside it.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import platform
import subprocess
import tarfile
import tempfile

URL = "https://conda.anaconda.org/conda-forge/osx-arm64/llvm-openmp-15.0.5-h7cfbb63_0.tar.bz2"
SHA256 = "df8d545338b3a895d5d010aa1d672d484006b4f3f406ff5146b18f51f3acd0ea"


def install(directory):
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("This optional local installer supports Apple Silicon macOS only.")
    directory = Path(directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    manifest_path = directory / "openmp-source.json"
    target = directory / "libomp.dylib"
    if target.is_file() and manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text())
        if manifest.get("archiveSha256") == SHA256 and hashlib.sha256(target.read_bytes()).hexdigest() == manifest.get("librarySha256"):
            return target
    with tempfile.TemporaryDirectory() as folder:
        archive_path = Path(folder) / "llvm-openmp.tar.bz2"
        subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--max-time", "60",
                        URL, "--output", str(archive_path)], check=True)
        body = archive_path.read_bytes()
    if hashlib.sha256(body).hexdigest() != SHA256:
        raise RuntimeError("OpenMP archive SHA-256 does not match the pinned distribution.")
    with tarfile.open(fileobj=io.BytesIO(body), mode="r:bz2") as archive:
        member = archive.getmember("lib/libomp.dylib")
        if not member.isfile():
            raise RuntimeError("The pinned OpenMP library is not a regular file.")
        library = archive.extractfile(member).read()
        licenses = [item for item in archive.getmembers() if item.isfile() and item.name.startswith("info/licenses/")]
        if not licenses:
            raise RuntimeError("The OpenMP archive contains no license.")
        license_text = b"\n\n".join(archive.extractfile(item).read() for item in licenses)
    target.write_bytes(library)
    (directory / "OpenMP-LICENSE.txt").write_bytes(license_text)
    manifest_path.write_text(json.dumps({"source": URL, "archiveSha256": SHA256,
                                         "librarySha256": hashlib.sha256(library).hexdigest()}, indent=2) + "\n")
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parents[1] / ".runtime/native")
    args = parser.parse_args()
    target = install(args.directory)
    print(f"Local OpenMP runtime: {target}")
    print(f"Set ORBITFARM_NATIVE_LIB_DIR={target.parent} before starting the ML service.")


if __name__ == "__main__":
    main()
