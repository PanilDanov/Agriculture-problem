"""Exercise the bounded ZIP downloader with an in-memory archive."""

from io import BytesIO
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

import pytest

import download_data


def test_large_group_is_written_only_after_crc_verification(monkeypatch, tmp_path):
    upstream = BytesIO()
    expected = {"stored.csv": b"adm_id\n001\n002\n", "compressed.csv": b"date,value\n20240101,7\n" * 9}
    with ZipFile(upstream, "w") as archive:
        archive.writestr("stored.csv", expected["stored.csv"], compress_type=ZIP_STORED)
        archive.writestr("compressed.csv", expected["compressed.csv"], compress_type=ZIP_DEFLATED)
        members = archive.infolist()
    payload = upstream.getvalue()
    monkeypatch.setattr(download_data, "request_range", lambda start, end: payload[start : end + 1])
    monkeypatch.setattr(download_data, "RANGE_CHUNK_BYTES", 7)
    monkeypatch.setattr(download_data, "BUFFERED_GROUP_BYTES", 1)

    target = tmp_path / "valid.zip"
    download_data.fetch_group(members, target)
    with ZipFile(target) as archive:
        assert {name: archive.read(name) for name in archive.namelist()} == expected

    members[-1].CRC ^= 1
    failed = tmp_path / "invalid.zip"
    with pytest.raises(ValueError, match="CRC or size mismatch"):
        download_data.fetch_group(members, failed)
    assert list(tmp_path.iterdir()) == [target]
