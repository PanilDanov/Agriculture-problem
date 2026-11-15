"""Verify real national and published regional models through the field API.

Weather is an explicit test fixture in this deterministic CI check. Forecasts
come from the real packaged national estimators over HTTP. The separate live
release smoke check exercises real public NASA/source retrieval.
"""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ml-url', default='http://127.0.0.1:8001')
    args = parser.parse_args()
    deadline = time.monotonic() + 45
    while True:
        try:
            with urlopen(args.ml_url.rstrip('/') + '/ready', timeout=10) as response:
                ready = json.load(response)
            assert ready['status'] == 'ready', ready
            break
        except (OSError, URLError, ValueError, AssertionError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(.25)

    from fastapi.testclient import TestClient
    from agronomy.api import create_app
    from agronomy.ml_client import YieldClient
    from agronomy.tests.test_api import field_fixture

    field = field_fixture()
    field['country'] = {'country_code': 'EG', 'status': 'available'}
    field['sample'] = {'longitude': 31.05, 'latitude': 30.4}
    app = create_app(collector=lambda *args, **kwargs: field,
                     yield_client=YieldClient(args.ml_url))
    payload = json.loads((ROOT / 'agronomy/example_analysis_request.json').read_text())
    payload['farmId'] = 'automated-test-fixture'
    payload['boundary']['coordinates'] = [[[31.049, 30.399], [31.051, 30.399],
                                          [31.051, 30.401], [31.049, 30.401], [31.049, 30.399]]]
    payload['yieldForecast'] = {'mode': 'annual_history', 'harvestYear': datetime.now(timezone.utc).year + 1}
    with TestClient(app) as client:
        response = client.post('/v1/analysis', json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    forecasts = result['yieldForecasts']
    assert len(forecasts) == 10
    assert len({row['cropId'] for row in forecasts}) == 10
    assert all(row['status'] == 'available' for row in forecasts), forecasts
    assert all(row['forecast']['spatial_level'] == 'country' for row in forecasts)
    assert all(row['forecast']['predicted_yield_t_ha'] > 0 for row in forecasts)
    assert all(row.get('usesNasaWeather') is False for row in forecasts)
    assert len(result['cropOptions']) == 10
    assert len(result['rotationPlans']) == 3

    regional_field = field_fixture()
    regional_field['country'] = {'country_code': 'ES', 'status': 'available'}
    regional_field['sample'] = {'longitude': -7.572, 'latitude': 43.11323}
    regional_app = create_app(collector=lambda *args, **kwargs: regional_field,
                             now=lambda: datetime(2026, 11, 15, tzinfo=timezone.utc),
                             yield_client=YieldClient(args.ml_url))
    regional_payload = json.loads((ROOT / 'deployment/smoke-regional-field.json').read_text())
    with TestClient(regional_app) as client:
        regional_response = client.post('/v1/analysis', json=regional_payload)
    assert regional_response.status_code == 200, regional_response.text
    regional = regional_response.json()['yieldForecasts']
    available = [row for row in regional if row['status'] == 'available']
    assert {row['cropId'] for row in available} == {'maize', 'wheat'}, regional
    for row in available:
        forecast, diagnostics = row['forecast'], row['diagnostics']
        assert row['regionId'] == 'ES112'
        assert forecast['spatial_level'] == 'administrative_region'
        assert diagnostics['dataThrough'].startswith('2023-')
        assert row['inputAsOf'] == diagnostics['inputAsOf'] == '2026-11-15'
        assert forecast['forecast_date'] == diagnostics['forecastDate']
        assert forecast['calculated_at'] == diagnostics['calculatedAt']
        assert forecast['is_replay'] is (forecast['forecast_date'] < datetime.now(timezone.utc).date().isoformat())
        assert row['usesNasaWeather'] is False
    print(json.dumps({'status': 'passed', 'actualHttpModelForecasts': len(forecasts),
                      'actualRegionalModelForecasts': len(available), 'verifiedRegion': 'ES112',
                      'weather': 'explicit automated test fixture',
                      'forecastScope': 'country', 'modelVersions': {
                          row['cropId']: row['forecast']['model_version'] for row in forecasts}}, indent=2))


if __name__ == '__main__':
    main()
