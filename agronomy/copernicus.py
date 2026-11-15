"""Audited AgERA5 ingestion: credentials, bounded requests and crop-area aggregation.

A point observation is never promoted to regional support. Publication dates are
first-observed retrieval dates unless an operator supplies an audited ledger.
"""
from __future__ import annotations
import calendar
from datetime import date, datetime, timedelta, timezone
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
from zipfile import ZipFile, is_zipfile

CDS_URL = "https://cds.climate.copernicus.eu/api"
DATASET = "sis-agrometeorological-indicators"
DATASET_URL = f"https://cds.climate.copernicus.eu/datasets/{DATASET}"
FORM_URL = "https://cds.climate.copernicus.eu/api/catalogue/v1/collections/sis-agrometeorological-indicators"
UNITS = {"tmin": "K", "tavg": "K", "tmax": "K", "prec": "mm/day", "rad": "J/m2/day", "et0": "mm/day", "vpd": "hPa", "cwb": "mm/day"}
VARIABLES = {"temperature": ("2m_temperature", ["24_hour_minimum", "24_hour_mean", "24_hour_maximum"]),
             "prec": ("precipitation_flux", None), "rad": ("solar_radiation_flux", None),
             "et0": ("reference_evapotranspiration", None), "vpd": ("vapour_pressure_deficit_at_maximum_temperature", None)}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
    try:
        temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def credential_values(config_path=None):
    path = Path(config_path or os.environ.get('CDSAPI_RC', Path.home() / '.cdsapirc')).expanduser()
    values = {}
    if path.is_file() and not path.is_symlink():
        for line in path.read_text(encoding='utf-8').splitlines():
            if ':' in line and not line.lstrip().startswith('#'):
                key, value = line.split(':', 1)
                values[key.strip()] = value.strip()
    return path, os.environ.get('CDSAPI_URL', values.get('url')), os.environ.get('CDSAPI_KEY', values.get('key'))


def credential_status(config_path=None):
    path, url, token = credential_values(config_path)
    private = not path.exists() or os.name == 'nt' or stat.S_IMODE(path.stat().st_mode) & 0o077 == 0
    return {'configured': bool(token) and url == CDS_URL, 'clientInstalled': importlib.util.find_spec('cdsapi') is not None,
            'configPath': str(path), 'privatePermissions': private,
            'dataset': DATASET, 'datasetLicenceMustBeAccepted': True,
            'licenceUrl': DATASET_URL + '?tab=download'}


def configure_credentials(token, config_path=None, *, overwrite=False):
    if not isinstance(token, str) or len(token.strip()) < 20 or any(ch.isspace() for ch in token):
        raise ValueError('Enter the Personal Access Token without whitespace')
    path = Path(config_path or Path.home() / '.cdsapirc').expanduser()
    if path.is_symlink() or (path.exists() and not overwrite):
        raise ValueError('Configuration already exists; inspect status or explicitly allow replacement')
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(dir=path.parent, prefix='.cdsapirc-')
    temporary = Path(name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            stream.write(f'url: {CDS_URL}\nkey: {token.strip()}\n')
        os.replace(temporary, path)
        path.chmod(0o600)
    finally:
        temporary.unlink(missing_ok=True)
    return credential_status(path)


def build_requests(start, end, area):
    start, end = date.fromisoformat(str(start)), date.fromisoformat(str(end))
    if end < start or start.year < 1979 or (end - start).days > 8 * 366:
        raise ValueError('Use an ordered interval from 1979 spanning at most eight years')
    if end > date.today() - timedelta(days=14):
        raise ValueError('Use observed dates at least 14 days before today')
    if len(area) != 4 or any(not math.isfinite(float(v)) for v in area):
        raise ValueError('Area must be [north, west, south, east] in WGS84')
    north, west, south, east = map(float, area)
    if not (-90 <= south < north <= 90 and -180 <= west < east <= 180) or max(north - south, east - west) > 30:
        raise ValueError('Use a bounded non-dateline area with each span at most 30 degrees')
    jobs = []
    cursor = start.replace(day=1)
    while cursor <= end:
        month_end = cursor.replace(day=calendar.monthrange(cursor.year, cursor.month)[1])
        days = [f'{day:02d}' for day in range(max(start, cursor).day, min(end, month_end).day + 1)]
        for key, (variable, statistic) in VARIABLES.items():
            request = {'version': '2_0', 'variable': variable, 'year': [str(cursor.year)],
                       'month': [f'{cursor.month:02d}'], 'day': days, 'area': [north, west, south, east]}
            if statistic:
                request['statistic'] = statistic
            identity = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()[:16]
            jobs.append({'id': f'{cursor:%Y%m}-{key}-{identity}', 'group': key, 'dataset': DATASET, 'request': request})
        cursor = (month_end + timedelta(days=1)).replace(day=1)
    return jobs


def download_jobs(jobs, directory, *, client=None, max_jobs=10):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if not isinstance(max_jobs, int) or max_jobs < 1 or max_jobs > 100:
        raise ValueError('max_jobs must be between one and 100; rerun to resume cached jobs')
    completed, downloaded = [], 0
    for job in jobs:
        path = directory / (job['id'] + '.zip')
        manifest = path.with_suffix('.manifest.json')
        if path.is_file() and manifest.is_file():
            metadata = json.loads(manifest.read_text())
            if digest(path) == metadata.get('sha256') and metadata.get('request') == job['request']:
                completed.append(metadata)
                continue
        if downloaded >= max_jobs:
            break
        if client is None:
            status = credential_status()
            if not status['configured'] or not status['privatePermissions']:
                raise ValueError('Configure CDS credentials with private permissions before downloading')
            import cdsapi
            _, url, key = credential_values()
            client = cdsapi.Client(url=url, key=key, quiet=True, debug=False, timeout=60, retry_max=2, sleep_max=10)
        temporary = path.with_suffix('.tmp')
        try:
            client.retrieve(DATASET, job['request'], str(temporary))
            if not is_zipfile(temporary):
                raise ValueError('CDS did not return the expected NetCDF ZIP archive')
            with ZipFile(temporary) as archive:
                if archive.testzip() or not any(name.lower().endswith('.nc') for name in archive.namelist()):
                    raise ValueError('CDS archive is corrupt or contains no NetCDF data')
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
        metadata = {'schemaVersion': '1.0', **job, 'path': path.name, 'sha256': digest(path),
                    'retrievedOn': datetime.now(timezone.utc).date().isoformat(),
                    'source': DATASET_URL, 'product': 'AgERA5', 'version': '2.0', 'timeStandard': 'LST'}
        atomic_json(manifest, metadata)
        completed.append(metadata)
        downloaded += 1
    return {'completed': len(completed), 'expected': len(jobs), 'downloaded': downloaded,
            'status': 'complete' if len(completed) == len(jobs) else 'partial', 'archives': completed}


def weighted_mean(values, weights, minimum_coverage=.95):
    import numpy as np
    values = np.ma.filled(np.ma.asarray(values, dtype=float), np.nan)
    weights = np.asarray(weights, dtype=float)
    if values.shape != weights.shape or not np.isfinite(weights).all() or (weights < 0).any() or weights.sum() <= 0:
        raise ValueError('Positive finite crop-area weights must match the meteorological grid')
    valid = np.isfinite(values) & (weights > 0)
    covered = float(weights[valid].sum() / weights.sum())
    return (float(np.sum(values[valid] * weights[valid]) / weights[valid].sum()) if covered >= minimum_coverage else None), covered


def crop_weights(mask_path, geometry, latitudes, longitudes, *, source_unit):
    import numpy as np
    import rasterio
    from rasterio.mask import mask as mask_raster
    from rasterio.transform import from_origin
    from rasterio.warp import reproject, Resampling
    from shapely.geometry import shape
    region = shape(geometry)
    if not region.is_valid or region.is_empty or region.geom_type not in {'Polygon', 'MultiPolygon'}:
        raise ValueError('A valid administrative region polygon is required')
    latitudes, longitudes = np.asarray(latitudes), np.asarray(longitudes)
    if len(latitudes) < 2 or len(longitudes) < 2 or not np.all(np.diff(latitudes) < 0) or not np.all(np.diff(longitudes) > 0):
        raise ValueError('A descending-latitude, ascending-longitude area grid is required; points are unsupported')
    dy, dx = -float(np.diff(latitudes).mean()), float(np.diff(longitudes).mean())
    if not np.allclose(np.diff(latitudes), -dy) or not np.allclose(np.diff(longitudes), dx):
        raise ValueError('AgERA5 grid must be regular')
    if source_unit not in {'m2', 'ha'}:
        raise ValueError('Crop mask must contain harvested area in m2 or ha, not an undocumented density')
    with rasterio.open(mask_path) as raster:
        if raster.crs is None:
            raise ValueError('Crop-area raster CRS is required')
        from rasterio.warp import transform_geom
        region_in_raster = transform_geom('EPSG:4326', raster.crs, geometry)
        cropped, transform = mask_raster(raster, [region_in_raster], crop=True, filled=False, indexes=1)
        data = np.ma.filled(cropped.astype(float), 0)
        if not np.isfinite(data).all() or (data < 0).any():
            raise ValueError('Crop-area weights must be nonnegative and finite')
        if source_unit == 'ha':
            data *= 10_000
        destination = np.zeros((len(latitudes), len(longitudes)), dtype=float)
        reproject(data, destination, src_transform=transform, src_crs=raster.crs,
                  dst_transform=from_origin(longitudes[0] - dx/2, latitudes[0] + dy/2, dx, dy),
                  dst_crs='EPSG:4326', resampling=Resampling.sum, src_nodata=0, dst_nodata=0)
    if np.count_nonzero(destination) < 2:
        raise ValueError('Region/crop support resolves to fewer than two meteorological cells')
    return destination


def variable_key(variable_name, filename, group):
    if group != 'temperature':
        return group
    label = re.sub('[^a-z0-9]', '', variable_name.lower() + filename.lower())
    for key, fragments in [('tmin', ('min24h', '24hourminimum', 'minimum')),
                           ('tmax', ('max24h', '24hourmaximum', 'maximum')),
                           ('tavg', ('mean24h', '24hourmean', 'mean'))]:
        if any(fragment in label for fragment in fragments):
            return key
    raise ValueError('Temperature statistic cannot be verified from NetCDF variable/file metadata')


def canonical_values(values, unit, key):
    import numpy as np
    normalized = str(unit).lower().replace(' ', '').replace('**', '^').replace('−', '-')
    values = np.ma.filled(np.ma.asarray(values, dtype=float), np.nan)
    if key in {'tmin', 'tavg', 'tmax'}:
        if normalized in {'k', 'kelvin'}:
            return values
        if normalized in {'c', 'degc', 'degree_celsius', 'degrees_celsius'}:
            return values + 273.15
    elif key in {'prec', 'et0'} and normalized in {'mmday-1', 'mmd-1', 'mm/day', 'mmday^-1'}:
        return values
    elif key == 'rad':
        if normalized in {'jm-2day-1', 'jm^-2day^-1', 'j/m2/day', 'jm-2d-1'}:
            return values
        if normalized == 'mj/m2/day':
            return values * 1_000_000
    elif key == 'vpd':
        if normalized in {'hpa', 'mbar'}:
            return values
        if normalized == 'kpa':
            return values * 10
    raise ValueError(f'Unrecognized source unit for {key}: {unit}')


def aggregate_archives(directory, region_manifest, *, availability=None):
    import numpy as np
    from netCDF4 import Dataset, num2date
    directory = Path(directory)
    region = region_manifest
    required = ('regionId', 'countryCode', 'boundary', 'boundarySource', 'boundaryVersion', 'crosswalkSource', 'cropMask')
    if any(not region.get(key) for key in required) or region.get('crosswalkVerified') is not True:
        raise ValueError('A source-verified administrative/CY-Bench crosswalk is required')
    if not re.fullmatch('[A-Z]{2}', region['countryCode']) or not re.fullmatch('[A-Za-z0-9_.-]{1,100}', region['regionId']):
        raise ValueError('Invalid region identifier or country code')
    crop_mask = region['cropMask']
    mask_path = Path(crop_mask['path']).expanduser().resolve()
    if not crop_mask.get('source') or not crop_mask.get('version') or digest(mask_path) != crop_mask.get('sha256'):
        raise ValueError('Crop-mask source, version and SHA-256 must match the installed raster')
    results, coverages, hashes, weights_cache = {}, {}, [], {}
    manifests = sorted(directory.glob('*.manifest.json'))
    if not manifests:
        raise ValueError('No downloaded AgERA5 archives are installed')
    for manifest_path in manifests:
        meta = json.loads(manifest_path.read_text())
        path = (directory / meta['path']).resolve()
        if (not path.is_relative_to(directory.resolve()) or digest(path) != meta['sha256']
                or meta.get('dataset') != DATASET or meta.get('product') != 'AgERA5'
                or meta.get('version') != '2.0' or meta.get('timeStandard') != 'LST'):
            raise ValueError('AgERA5 archive identity or dataset mismatch')
        hashes.append(meta['sha256'])
        retrieved = date.fromisoformat(meta['retrievedOn'])
        if retrieved > date.today():
            raise ValueError('Retrieval metadata cannot be future dated')
        with ZipFile(path) as archive:
            for filename in sorted(name for name in archive.namelist() if name.lower().endswith('.nc')):
                if archive.getinfo(filename).file_size > 200_000_000:
                    raise ValueError('NetCDF member exceeds the bounded regional ingestion size')
                with Dataset('memory.nc', memory=archive.read(filename)) as dataset:
                    lat_name = next((name for name in ('lat', 'latitude') if name in dataset.variables), None)
                    lon_name = next((name for name in ('lon', 'longitude') if name in dataset.variables), None)
                    if not lat_name or not lon_name or 'time' not in dataset.variables:
                        raise ValueError('NetCDF must provide latitude, longitude and dated daily time coordinates')
                    lat = np.asarray(dataset[lat_name][:], dtype=float)
                    lon = (np.asarray(dataset[lon_name][:], dtype=float) + 180) % 360 - 180
                    lat_order, lon_order = np.argsort(lat)[::-1], np.argsort(lon)
                    lat, lon = lat[lat_order], lon[lon_order]
                    grid = (tuple(lat), tuple(lon))
                    if grid not in weights_cache:
                        weights_cache[grid] = crop_weights(mask_path, region['boundary'], lat, lon, source_unit=crop_mask['unit'])
                    weights = weights_cache[grid]
                    times = num2date(dataset['time'][:], dataset['time'].units, calendar=getattr(dataset['time'], 'calendar', 'standard'))
                    coordinates = {lat_name, lon_name, 'time'}
                    for name, variable in dataset.variables.items():
                        if name in coordinates or not {lat_name, lon_name} <= set(variable.dimensions):
                            continue
                        key = variable_key(name, filename, meta['group'])
                        values = canonical_values(variable[:], getattr(variable, 'units', None), key)
                        dimensions = list(variable.dimensions)
                        for axis in reversed(range(len(dimensions))):
                            if dimensions[axis] not in {'time', lat_name, lon_name}:
                                if values.shape[axis] != 1:
                                    raise ValueError('Unsupported non-singleton NetCDF dimension')
                                values = np.take(values, 0, axis=axis)
                                dimensions.pop(axis)
                        if 'time' not in dimensions:
                            raise ValueError('Meteorological variable must have a dated time axis')
                        values = np.transpose(values, [dimensions.index(dim) for dim in ('time', lat_name, lon_name)])
                        values = values[:, lat_order, :][:, :, lon_order]
                        for day_value, grid_values in zip(times, values):
                            day = date(day_value.year, day_value.month, day_value.day).isoformat()
                            known = (availability or {}).get(day, retrieved.isoformat())
                            published = date.fromisoformat(known)
                            if published < date.fromisoformat(day) or published > date.today():
                                raise ValueError('Availability ledger has an impossible publication date')
                            result, covered = weighted_mean(grid_values, weights)
                            row = results.setdefault(day, {'date': day, 'available_on': known})
                            if key in row:
                                raise ValueError(f'Duplicate meteorological value for {day}/{key}; remove overlapping archives')
                            row[key] = result
                            row['available_on'] = max(row['available_on'], known)
                            coverages.setdefault(day, []).append(covered)
    observations = []
    for day, row in sorted(results.items()):
        for key in ('tmin', 'tavg', 'tmax', 'prec', 'rad', 'et0', 'vpd'):
            row.setdefault(key, None)
        row['cwb'] = row['prec'] - row['et0'] if row['prec'] is not None and row['et0'] is not None else None
        observations.append(row)
    provenance = {'archives': hashes, 'cropMaskSha256': crop_mask['sha256'],
                  'crosswalkSource': region['crosswalkSource'], 'cropMaskSource': crop_mask['source'],
                  'cropMaskVersion': crop_mask['version'],
                  'weighting': 'Sum harvested area of source pixels whose centers fall in the administrative polygon; area-weighted AgERA5 mean',
                  'minimumValidCropAreaFraction': .95, 'minimumObservedCropAreaFraction': min(min(v) for v in coverages.values()),
                  'availability': 'audited ledger where supplied; otherwise actual first successful archive retrieval date'}
    return observations, provenance


def publish_regional_input(directory, region, crop, harvest_year, mode, as_of, observations, provenance):
    from shapely.geometry import shape
    if region.get('crosswalkVerified') is not True or not region.get('crosswalkSource'):
        raise ValueError('A source-verified administrative/CY-Bench crosswalk is required')
    if crop not in {'maize', 'wheat'} or mode not in {'pre_season', 'mid_season', 'mid_season_v2'}:
        raise ValueError('Regional AgERA5 models currently support wheat/maize and the documented issue modes')
    if region.get('cropMask', {}).get('cropId') != crop:
        raise ValueError('The installed crop mask must describe the requested crop')
    if len({row['date'] for row in observations}) != len(observations):
        raise ValueError('Regional weather contains duplicate dates')
    issue = date.fromisoformat(as_of)
    if issue > date.today():
        raise ValueError('Regional input as_of cannot be in the future')
    calendar_input = region.get('calendar')
    if not calendar_input or not calendar_input.get('source') or not calendar_input.get('seasons'):
        raise ValueError('Source-qualified dated seasonal calendars are required')
    current = next((season for season in calendar_input['seasons'] if season['harvest_year'] == harvest_year), None)
    if current is None:
        raise ValueError('Target harvest year is missing from the verified calendar')
    start, end = date.fromisoformat(current['start']), date.fromisoformat(current['end'])
    pre = start - timedelta(days=1)
    forecast_date = start + timedelta(days=(end-start).days//2) if mode != 'pre_season' else pre
    if issue < forecast_date:
        raise ValueError('The actual as_of date has not reached this model forecast issue date')
    past_seasons = [season for season in calendar_input['seasons'] if harvest_year-7 <= season['harvest_year'] < harvest_year]
    complete_past = 0
    for season in past_seasons:
        first, last = date.fromisoformat(season['start']), date.fromisoformat(season['end'])
        expected = (last-first).days+1
        count = sum(first <= date.fromisoformat(row['date']) <= last and row['available_on'] <= pre.isoformat()
                    and date.fromisoformat(row['date']) <= pre-timedelta(days=14)
                    and all(row.get(key) is not None for key in UNITS) for row in observations)
        complete_past += count >= .95 * expected and season['available_on'] <= pre.isoformat()
    if complete_past < 2:
        raise ValueError('Fewer than two historical seasons have complete weather with verified availability before the issue date')
    if mode != 'pre_season':
        cutoff = forecast_date - timedelta(days=14)
        expected = (cutoff-start).days+1
        count = sum(start <= date.fromisoformat(row['date']) <= cutoff and row['available_on'] <= forecast_date.isoformat()
                    and all(row.get(key) is not None for key in UNITS) for row in observations)
        if expected < 10 or count < .95*expected:
            raise ValueError('Mid-season weather is incomplete or was unavailable at the forecast issue date')
    raw = {'schema_version': '1.0', 'as_of': as_of, 'harvest_year': harvest_year,
           'region': {'country_code': region['countryCode'], 'adm_id': region['regionId'],
                      'boundary_source': region['boundarySource'], 'boundary_version': region['boundaryVersion'],
                      'match': 'cybench_verified', 'aggregation': 'administrative_crop_mask'},
           'calendar': calendar_input,
           'weather': {'product': 'AgERA5', 'version': '2.0', 'time_standard': 'LST', 'units': UNITS,
                       'observations': observations, 'source_reference': DATASET_URL,
                       'artifact_sha256': hashlib.sha256(json.dumps(provenance, sort_keys=True).encode()).hexdigest()}}
    centroid = shape(region['boundary']).centroid
    raw['region'].update(latitude=centroid.y, longitude=centroid.x)
    if region.get('soil'):
        raw['soil'] = region['soil']
    from jsonschema import Draft202012Validator, FormatChecker
    schema_path = Path(__file__).resolve().parents[1] / 'yield_prediction/src/yield_prediction/schemas/raw_environmental_input.schema.json'
    Draft202012Validator(json.loads(schema_path.read_text()), format_checker=FormatChecker()).validate(raw)
    directory = Path(directory)
    body = (json.dumps(raw, indent=2, allow_nan=False) + '\n').encode()
    sha = hashlib.sha256(body).hexdigest()
    relative = Path('inputs') / region['countryCode'] / region['regionId'] / f'{crop}-{harvest_year}-{mode}-{sha[:12]}.json'
    target = directory / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    atomic_json(target.with_suffix('.provenance.json'), provenance)
    registry_path = directory / 'registry.json'
    registry = json.loads(registry_path.read_text()) if registry_path.exists() else {'schemaVersion': '1.0', 'regions': []}
    if registry.get('schemaVersion') != '1.0':
        raise ValueError('Unsupported existing regional registry')
    entry = next((r for r in registry['regions'] if r['regionId'] == region['regionId'] and r['countryCode'] == region['countryCode']), None)
    if entry is None:
        entry = {'regionId': region['regionId'], 'countryCode': region['countryCode'], 'name': region.get('name'),
                 'boundary': region['boundary'], 'datasets': []}
        registry['regions'].append(entry)
    elif entry['boundary'] != region['boundary']:
        raise ValueError('Existing registered administrative geometry differs from this source')
    entry['datasets'] = [r for r in entry['datasets'] if (r['cropId'], r['harvestYear'], r['mode']) != (crop, harvest_year, mode)]
    entry['datasets'].append({'cropId': crop, 'harvestYear': harvest_year, 'mode': mode, 'path': relative.as_posix(), 'sha256': sha})
    atomic_json(registry_path, registry)
    return {'status': 'installed', 'path': str(target), 'sha256': sha, 'historicalCompleteSeasons': complete_past}
