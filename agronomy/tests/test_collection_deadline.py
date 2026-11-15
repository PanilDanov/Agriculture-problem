"""A slow provider must not hold a completed NASA result past the API budget."""
from datetime import date
import tempfile
import time
import unittest
from unittest.mock import patch

from agronomy.field_context import collect_field_context, read_sources
from agronomy.field_providers import SourceClient

BOUNDARY = {'type': 'Polygon', 'coordinates': [[[30.,30.],[30.01,30.],[30.01,30.01],[30.,30.01],[30.,30.]]]}


class CollectionDeadlineTests(unittest.TestCase):
    def test_slow_optional_sources_return_by_deadline_and_preserve_ready_weather(self):
        def slow(*args, **kwargs):
            time.sleep(.2)
            return {'status': 'available'}
        with tempfile.TemporaryDirectory() as directory:
            with patch('agronomy.field_context.fetch_weather', return_value={'status': 'available', 'records': ['actual-ready-value']}), \
                 patch('agronomy.field_context.locate_country', return_value={'status': 'available', 'country_code': 'EG'}), \
                 patch('agronomy.field_context.fetch_soil', side_effect=slow), \
                 patch('agronomy.field_context.fetch_calendars', side_effect=slow):
                started = time.monotonic()
                result = collect_field_context(BOUNDARY, date(2024,1,1), date(2024,1,2),
                         client=SourceClient(directory), timeout_seconds=.04)
                elapsed = time.monotonic()-started
        self.assertLess(elapsed, .15)
        self.assertEqual(result['weather']['records'], ['actual-ready-value'])
        self.assertEqual(result['country']['country_code'], 'EG')
        self.assertEqual(result['soil']['status'], 'provider_error')
        calendars = result['planting_calendars']['crops']
        self.assertEqual(len(calendars), 10)
        self.assertTrue(all(value['status'] == 'unavailable' for value in calendars.values()))
        self.assertTrue(all(value['missing_reason'] == 'lookup_incomplete' for value in calendars.values()))

    def test_client_deadline_is_not_mutated_across_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            client = SourceClient(directory, offline=True)
            collect_field_context(BOUNDARY, date(2024,1,1), date(2024,1,2), client=client, timeout_seconds=.1)
            self.assertIsNone(client.deadline)
