import gzip
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import Mock, patch

from agronomy.field_calendars import unpack_netcdf
from agronomy.field_context import read_sources
from agronomy.field_providers import SourceClient, SourceError, fetch_weather


class SourceResilienceTests(unittest.TestCase):
    def test_corrupted_gzip_is_a_provider_validation_error(self):
        data = bytearray(gzip.compress(b"CDF" + b"calendar" * 100))
        data[10] = 7
        with self.assertRaisesRegex(ValueError, "valid gzip"):
            unpack_netcdf(bytes(data))

    @patch("agronomy.field_providers.requests.get")
    def test_semantically_invalid_weather_is_not_retained_as_fresh_cache(self, get):
        get.return_value.content = b"{}"
        source = read_sources()["weather"]
        with tempfile.TemporaryDirectory() as directory:
            client = SourceClient(directory)
            for _ in range(2):
                with self.assertRaises(SourceError):
                    fetch_weather(client, source, 31, 31, date(2025, 1, 1), date(2025, 1, 2))
            self.assertEqual(get.call_count, 2)
            self.assertEqual(list(Path(directory).glob("*.bin")), [])

    @patch("agronomy.field_providers.write_atomic", side_effect=OSError("test disk full"))
    @patch("agronomy.field_providers.requests.get")
    def test_successful_live_data_survives_an_unwritable_cache(self, get, _write):
        get.return_value.content = b'{"valid":true}'
        with tempfile.TemporaryDirectory() as directory:
            result = SourceClient(directory).get("https://example.test/source")
        self.assertEqual(result.value, {"valid": True})
        self.assertEqual(result.provenance["retrieval"], "downloaded_uncached")

    @patch("agronomy.field_providers.requests.get")
    def test_expired_collection_budget_starts_no_network_request(self, get):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(SourceError):
                SourceClient(directory, deadline=time.monotonic() - 1).get("https://example.test/source")
        get.assert_not_called()
