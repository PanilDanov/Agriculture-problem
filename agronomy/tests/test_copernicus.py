"""Synthetic boundary tests of ingestion; no synthetic observations are shipped."""
from datetime import date, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from agronomy.copernicus import (
    build_requests, canonical_values, configure_credentials, credential_status,
    crop_weights, publish_regional_input, weighted_mean,
)


class CopernicusTests(unittest.TestCase):
    def test_token_is_private_and_never_returned(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {}, clear=True):
            path = Path(directory) / '.cdsapirc'
            token = 'not-a-real-token-for-the-unit-test'
            result = configure_credentials(token, path)
            self.assertTrue(result['configured'])
            self.assertTrue(result['privatePermissions'])
            self.assertNotIn(token, json.dumps(result))
            self.assertNotIn(token, json.dumps(credential_status(path)))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(ValueError):
                configure_credentials(token, path)

    def test_current_official_form_requests_are_monthly_and_bounded(self):
        jobs = build_requests('2024-02-01', '2024-02-29', [50, 10, 49, 11])
        self.assertEqual(len(jobs), 5)
        temperature = jobs[0]['request']
        self.assertEqual(temperature['version'], '2_0')
        self.assertEqual(temperature['variable'], '2m_temperature')
        self.assertEqual(len(temperature['day']), 29)
        self.assertEqual(temperature['statistic'], ['24_hour_minimum', '24_hour_mean', '24_hour_maximum'])
        self.assertTrue(all('statistic' not in job['request'] for job in jobs[1:]))
        self.assertEqual(jobs, build_requests('2024-02-01', '2024-02-29', [50, 10, 49, 11]))
        with self.assertRaises(ValueError):
            build_requests('2024-02-01', '2024-01-01', [50, 10, 49, 11])
        with self.assertRaises(ValueError):
            build_requests('2024-02-01', '2024-02-29', [90, -180, -90, 180])
        with self.assertRaises(ValueError):
            build_requests('2024-02-01', date.today().isoformat(), [50, 10, 49, 11])

    def test_crop_area_weighting_and_spatial_missingness(self):
        result, covered = weighted_mean([[10, 20], [float('nan'), 99]], [[1, 3], [0, 0]])
        self.assertEqual(result, 17.5)
        self.assertEqual(covered, 1)
        result, covered = weighted_mean([[10, float('nan')]], [[1, 3]])
        self.assertIsNone(result)
        self.assertEqual(covered, .25)
        with self.assertRaises(ValueError):
            weighted_mean([[10, 20]], [[0, 0]])
        np.testing.assert_array_equal(canonical_values([1], 'kPa', 'vpd'), [10])
        np.testing.assert_array_equal(canonical_values([1], 'MJ/m2/day', 'rad'), [1_000_000])
        with self.assertRaises(ValueError):
            canonical_values([10], 'percent', 'vpd')

    def test_crop_mask_is_not_replaced_by_a_point(self):
        with self.assertRaisesRegex(ValueError, 'points'):
            crop_weights('absent.tif', {'type': 'Polygon', 'coordinates': [[[0,0],[1,0],[1,1],[0,1],[0,0]]]},
                         [0.5], [0.5], source_unit='m2')

    def test_actual_retrieval_cannot_be_backdated_to_make_a_forecast(self):
        region = {'regionId': 'TEST', 'countryCode': 'DE', 'boundarySource': 'synthetic unit boundary',
                  'boundaryVersion': 'test', 'boundary': {'type': 'Polygon', 'coordinates': [[[0,0],[1,0],[1,1],[0,1],[0,0]]]},
                  'crosswalkVerified': True, 'crosswalkSource': 'synthetic unit crosswalk',
                  'cropMask': {'cropId': 'wheat'}, 'calendar': {'source': 'synthetic unit calendar', 'seasons': [
                      {'harvest_year': year, 'start': f'{year}-01-01', 'end': f'{year}-06-30', 'available_on': f'{year-1}-01-01'}
                      for year in (2022, 2023, 2024)]}}
        rows = []
        for year in (2022, 2023):
            start = date(year, 1, 1)
            for offset in range((date(year, 6, 30) - start).days+1):
                rows.append({'date': (start+timedelta(days=offset)).isoformat(), 'available_on': '2026-11-15',
                             'tmin': 275., 'tavg': 280., 'tmax': 285., 'prec': 2., 'et0': 1., 'vpd': 2., 'rad': 10_000_000., 'cwb': 1.})
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'verified availability'):
                publish_regional_input(directory, region, 'wheat', 2024, 'pre_season', '2026-11-15', rows, {})
            self.assertFalse((Path(directory) / 'registry.json').exists())

    def test_netcdf_and_crop_raster_are_aggregated_with_verified_units(self):
        from zipfile import ZipFile
        import rasterio
        from rasterio.transform import from_origin
        from netCDF4 import Dataset
        from agronomy.copernicus import aggregate_archives, digest, atomic_json, DATASET
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            mask = folder / 'mask.tif'
            with rasterio.open(mask, 'w', driver='GTiff', height=2, width=2, count=1, dtype='float32',
                               crs='EPSG:4326', transform=from_origin(0, 2, 1, 1)) as raster:
                raster.write(np.asarray([[1, 3], [0, 0]], dtype='float32'), 1)
            region = {'regionId': 'TEST', 'countryCode': 'DE', 'boundarySource': 'unit test',
                      'boundaryVersion': 'unit test', 'crosswalkSource': 'unit test', 'crosswalkVerified': True,
                      'boundary': {'type': 'Polygon', 'coordinates': [[[0,0],[2,0],[2,2],[0,2],[0,0]]]},
                      'cropMask': {'path': str(mask), 'sha256': digest(mask), 'source': 'unit test',
                                   'version': '1', 'unit': 'm2', 'cropId': 'wheat'}}
            groups = {'temperature': [('Temperature_Air_2m_Min_24h', 'K', 270),
                                       ('Temperature_Air_2m_Mean_24h', 'K', 280),
                                       ('Temperature_Air_2m_Max_24h', 'K', 290)],
                      'prec': [('Precipitation_Flux', 'mm day-1', 1)],
                      'et0': [('Reference_Evapotranspiration', 'mm day-1', 2)],
                      'rad': [('Solar_Radiation_Flux', 'J m-2 day-1', 10_000_000)],
                      'vpd': [('Vapour_Pressure_Deficit', 'hPa', 5)]}
            for group, definitions in groups.items():
                archive_path = folder / f'{group}.zip'
                with ZipFile(archive_path, 'w') as archive:
                    for name, unit, value in definitions:
                        nc_path = folder / f'{name}.nc'
                        with Dataset(nc_path, 'w') as nc:
                            nc.createDimension('time', 1)
                            nc.createDimension('lat', 2)
                            nc.createDimension('lon', 2)
                            time = nc.createVariable('time', 'f8', ('time',))
                            time.units = 'days since 2024-01-01'
                            time[:] = [0]
                            nc.createVariable('lat', 'f8', ('lat',))[:] = [1.5, .5]
                            nc.createVariable('lon', 'f8', ('lon',))[:] = [.5, 1.5]
                            data = nc.createVariable(name, 'f8', ('time', 'lat', 'lon'))
                            data.units = unit
                            data[:] = [[[value, value+4], [value, value]]]
                        archive.write(nc_path, nc_path.name)
                atomic_json(archive_path.with_suffix('.manifest.json'),
                    {'path': archive_path.name, 'sha256': digest(archive_path), 'dataset': DATASET,
                     'product': 'AgERA5', 'version': '2.0', 'timeStandard': 'LST',
                     'group': group, 'retrievedOn': '2026-11-15'})
            observations, provenance = aggregate_archives(folder, region)
            self.assertEqual(len(observations), 1)
            self.assertAlmostEqual(observations[0]['tavg'], 283.)
            self.assertAlmostEqual(observations[0]['prec'], 4.)
            self.assertAlmostEqual(observations[0]['et0'], 5.)
            self.assertAlmostEqual(observations[0]['cwb'], -1.)
            self.assertEqual(observations[0]['available_on'], '2026-11-15')
            self.assertEqual(provenance['minimumObservedCropAreaFraction'], 1.)
