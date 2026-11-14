"""Download the pinned CY-Bench sample or selected members of the Zenodo release."""

import argparse
import io
import re
import shutil
import struct
import time
import zlib
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent
REVISION = "b55e6918de1e1fa1b998966f6014b578cd36b83b"
SAMPLE = f"https://codeload.github.com/WUR-AI/sample_data/zip/{REVISION}"
RECORD = "17279151"
ZENODO = f"https://zenodo.org/records/{RECORD}/files/cybench-data.zip?download=1"
ARCHIVE_BYTES = 6_228_749_411
GROUPS = {
    "maize": "ES NL FR IT DE RO HU CN PL PT BE CZ BG ZA ZM ET MX MG AO",
    "wheat": "ES NL FR IT DE RO HU CN PL PT BE CZ BG AU DK FI SE",
}
KINDS = {"yield", "crop_calendar", "meteo", "soil", "location"}


def request_range(start, end):
    request = Request(ZENODO, headers={"Range": f"bytes={start}-{end}"})
    for attempt in range(4):
        try:
            with urlopen(request, timeout=90) as response:
                expected = f"bytes {start}-{end}/{ARCHIVE_BYTES}"
                if response.status != 206 or response.headers.get("Content-Range") != expected:
                    raise ValueError("Zenodo did not return the pinned byte range")
                data = response.read()
                if len(data) != end - start + 1:
                    raise OSError("Incomplete byte range")
                return data
        except (HTTPError, URLError, OSError) as error:
            if attempt == 3:
                raise
            delay = int(error.headers.get("Retry-After", 2)) if isinstance(error, HTTPError) else 2
            time.sleep(min(delay, 60) * (attempt + 1))


def central_directory():
    """Open a virtual ZIP view whose only resident bytes are the ZIP64 directory."""
    class ArchiveTail(io.BytesIO):
        start = ARCHIVE_BYTES - 131_072

        def seek(self, offset, whence=0):
            return super().seek(offset - self.start if whence == 0 else offset, whence) + self.start

        def tell(self):
            return super().tell() + self.start

    with ZipFile(ArchiveTail(request_range(ArchiveTail.start, ARCHIVE_BYTES - 1))) as archive:
        return archive.infolist()


def fetch_group(members, output):
    first = min(member.header_offset for member in members)
    # A ZIP local file header, its name and local extra fields precede each payload.
    last_member = max(members, key=lambda member: member.header_offset)
    last = last_member.header_offset + last_member.compress_size + 131_101
    data = request_range(first, min(last, ARCHIVE_BYTES - 1))
    temp = output.with_suffix(".tmp")
    with ZipFile(temp, "w", compression=8, compresslevel=1) as archive:
        for member in members:
            header = member.header_offset - first
            signature, name_length, extra_length = struct.unpack_from("<4s22xHH", data, header)
            if signature != b"PK\x03\x04":
                raise ValueError(f"Invalid ZIP member {member.filename}")
            offset = header + 30 + name_length + extra_length
            payload = data[offset : offset + member.compress_size]
            if member.compress_type == 8:
                payload = zlib.decompress(payload, -15)
            elif member.compress_type != 0:
                raise ValueError(f"Unsupported compression for {member.filename}")
            if len(payload) != member.file_size or zlib.crc32(payload) != member.CRC:
                raise ValueError(f"CRC or size mismatch for {member.filename}")
            archive.writestr(member.filename, payload)
    temp.replace(output)


def download_sample(directory):
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / "sample-b55e691.zip"
    if not output.exists():
        temp = output.with_suffix(".tmp")
        with urlopen(SAMPLE, timeout=90) as response, temp.open("wb") as stream:
            shutil.copyfileobj(response, stream)
        with ZipFile(temp) as archive:
            if archive.testzip() is not None:
                raise ValueError("Corrupt sample ZIP")
        temp.replace(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", choices=["sample", "zenodo"])
    parser.add_argument("--countries", nargs="+")
    parser.add_argument("--crop", choices=GROUPS)
    parser.add_argument("--max-span-mib", type=int, default=150)
    args = parser.parse_args()
    if args.source == "sample":
        download_sample(ROOT / "data/raw/sample")
        return
    from concurrent.futures import ThreadPoolExecutor

    folder = ROOT / "data/raw/zenodo"
    folder.mkdir(parents=True, exist_ok=True)
    groups = {}
    for info in central_directory():
        match = re.fullmatch(r"cybench-data/(maize|wheat)/([A-Z]{2})/(.+)_\1_\2\.csv", info.filename)
        if match and match[3] in KINDS:
            groups.setdefault((match[1], match[2]), []).append(info)

    def download(item):
        (crop, country), members = item
        output = folder / f"{crop}_{country}.zip"
        if output.exists():
            return
        if len(members) != len(KINDS):
            raise ValueError(f"Missing required CY-Bench CSVs for {crop}/{country}")
        span = max(m.header_offset + m.compress_size for m in members) - min(m.header_offset for m in members)
        if span > args.max_span_mib * 1024**2:
            raise ValueError(f"{crop}/{country} spans {span / 1024**2:.1f} MiB")
        fetch_group(members, output)
        print(f"{crop}/{country}  {span / 1024**2:.1f} MiB", flush=True)

    chosen = [
        (key, value) for key, value in groups.items()
        if (args.crop is None or key[0] == args.crop)
        and key[1] in (args.countries or GROUPS[key[0]].split())
    ]
    if not chosen:
        parser.error("No archive members match this selection")
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(download, chosen))


if __name__ == "__main__":
    main()
