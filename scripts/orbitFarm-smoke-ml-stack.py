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
    available = [row for row in regional if row['status'] == 'available'
                 and row['forecast'].get('weather_support') != 'representative_point']
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

    from shapely.geometry import Point, box, mapping, shape
    evaluation = json.loads((ROOT / 'yield_prediction/artifacts/provincial/evaluation.json').read_text())
    geography = json.loads((ROOT / 'yield_prediction/artifacts/provincial/provinces.json').read_text())
    geographies = {row['region_id']: row for row in geography['records']}
    remaining = {(row['crop'], row['mode']) for row in evaluation['models']}
    covered = set()
    province_fields = []
    while remaining:
        choices = {code: {(row['crop'], row['mode']) for row in evaluation['models']
                          if code in row['currentCoverageRegions']} & remaining for code in geographies}
        code = max(choices, key=lambda value: len(choices[value]))
        assert choices[code], f'No real province covers remaining model cases: {remaining}'
        region = geographies[code]
        longitude, latitude = region['longitude'], region['latitude']
        # A small illustrative field around the audited interior point must
        # remain wholly within the same official province geometry.
        polygon = box(longitude - .0005, latitude - .0005, longitude + .0005, latitude + .0005)
        assert shape(region['geometry']).covers(polygon)
        assert shape(region['geometry']).covers(Point(longitude, latitude))
        province_fixture = field_fixture()
        province_fixture['country'] = {'country_code': 'ES', 'status': 'available'}
        province_fixture['sample'] = {'longitude': longitude, 'latitude': latitude}
        province_app = create_app(collector=lambda *args, value=province_fixture, **kwargs: value,
                                  now=lambda: datetime(2026, 11, 15, tzinfo=timezone.utc),
                                  yield_client=YieldClient(args.ml_url))
        province_payload = dict(regional_payload, boundary=mapping(polygon), farmId='automated-province-' + code)
        for mode in sorted({case[1] for case in choices[code]}):
            province_payload['yieldForecast'] = {'mode': mode, 'harvestYear': 2026}
            with TestClient(province_app) as client:
                province_response = client.post('/v1/analysis', json=province_payload)
            assert province_response.status_code == 200, province_response.text
            forecasts_by_crop = {row['cropId']: row for row in province_response.json()['yieldForecasts']}
            for crop, expected_mode in choices[code]:
                if expected_mode != mode:
                    continue
                row = forecasts_by_crop[crop]
                assert row['status'] == 'available', (code, crop, mode, row)
                forecast = row['forecast']
                assert forecast['spatial_level'] == 'administrative_region'
                assert forecast['mode'] == mode and forecast['predicted_yield_t_ha'] > 0
                assert forecast['is_replay'] is True
                if forecast.get('weather_support') == 'representative_point':
                    assert forecast['region_id'] == code
                    assert forecast['release_status'] == 'experimental'
                    assert row['usesNasaWeather'] is True
                covered.add((crop, mode))
        province_fields.append(code)
        remaining -= choices[code]
    assert len(covered) == 20
    print(json.dumps({'status': 'passed', 'actualHttpModelForecasts': len(forecasts),
                      'actualRegionalModelForecasts': len(available), 'verifiedRegion': 'ES112',
                      'actualSeasonalCropModes': len(covered), 'auditedProvinces': province_fields,
                      'weather': 'explicit automated test fixture',
                      'forecastScope': 'country', 'modelVersions': {
                          row['cropId']: row['forecast']['model_version'] for row in forecasts}}, indent=2))


if __name__ == '__main__':
    main()
