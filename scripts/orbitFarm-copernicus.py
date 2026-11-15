#!/usr/bin/env python3
"""Configure CDS safely and install verified crop-mask AgERA5 regional inputs."""
import argparse
from datetime import date
from getpass import getpass
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agronomy.copernicus import (
    aggregate_archives, build_requests, configure_credentials, credential_status,
    download_jobs, publish_regional_input,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    configure = commands.add_parser('configure', help='Save a token with private permissions; token is never a command argument')
    configure.add_argument('--config', type=Path)
    configure.add_argument('--replace', action='store_true')
    status = commands.add_parser('status', help='Print masked local configuration readiness')
    status.add_argument('--config', type=Path)
    for name in ('plan', 'download'):
        command = commands.add_parser(name)
        command.add_argument('--start', required=True)
        command.add_argument('--end', required=True)
        command.add_argument('--area', type=float, nargs=4, metavar=('NORTH', 'WEST', 'SOUTH', 'EAST'), required=True)
        if name == 'download':
            command.add_argument('--directory', type=Path, default=Path('.data/copernicus'))
            command.add_argument('--max-jobs', type=int, default=10)
    install = commands.add_parser('install')
    install.add_argument('--directory', type=Path, required=True)
    install.add_argument('--region-manifest', type=Path, required=True)
    install.add_argument('--crop', choices=('maize', 'wheat'), required=True)
    install.add_argument('--harvest-year', type=int, required=True)
    install.add_argument('--mode', choices=('pre_season', 'mid_season', 'mid_season_v2'), required=True)
    install.add_argument('--as-of', default=date.today().isoformat())
    install.add_argument('--regional-directory', type=Path, default=Path('.data/regional'))
    install.add_argument('--availability-ledger', type=Path)
    args = parser.parse_args()
    if args.command == 'configure':
        token = getpass('CDS Personal Access Token (hidden): ')
        result = configure_credentials(token, args.config, overwrite=args.replace)
        del token
    elif args.command == 'status':
        result = credential_status(args.config)
    elif args.command in {'plan', 'download'}:
        jobs = build_requests(args.start, args.end, args.area)
        result = {'dataset': 'sis-agrometeorological-indicators', 'jobs': jobs, 'jobCount': len(jobs)}
        if args.command == 'download':
            result = download_jobs(jobs, args.directory, max_jobs=args.max_jobs)
    else:
        region = json.loads(args.region_manifest.read_text(encoding='utf-8'))
        crop_mask = Path(region['cropMask']['path'])
        if not crop_mask.is_absolute():
            region['cropMask']['path'] = str((args.region_manifest.parent / crop_mask).resolve())
        availability = json.loads(args.availability_ledger.read_text()) if args.availability_ledger else None
        observations, provenance = aggregate_archives(args.directory, region, availability=availability)
        result = publish_regional_input(args.regional_directory, region, args.crop,
                 args.harvest_year, args.mode, args.as_of, observations, provenance)
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Credentials and provider exception text can contain secrets. Report
        # only local validation errors; never echo an authenticated HTTP error.
        if isinstance(error, (ValueError, FileNotFoundError, ImportError)):
            print(json.dumps({'status': 'unavailable', 'error': str(error)}), file=sys.stderr)
        else:
            print(json.dumps({'status': 'unavailable', 'errorType': type(error).__name__,
                             'error': 'Copernicus retrieval failed. Check account, accepted dataset licence and service availability.'}), file=sys.stderr)
        sys.exit(1)
