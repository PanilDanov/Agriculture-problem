import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const backend = resolve(process.argv[2] ?? join(frontend, '../Agriculture-problem'));
const stagingParent = join(frontend, '.vercel');
const template = join(frontend, 'deployment/vercel');
const run = promisify(execFile);
const backendFiles = [
  'AgroWise_crop_requirements_clean.csv',
  'data_pipeline.py',
  'agronomy/api.py',
  'agronomy/assessment.py',
  'agronomy/crop_profiles.json',
  'agronomy/field_calendars.py',
  'agronomy/field_context.py',
  'agronomy/field_geometry.py',
  'agronomy/field_providers.py',
  'agronomy/field_sources.json',
  'agronomy/rotation_planner.py',
  'agronomy/water_screen.py',
];

async function stageExpat(staging) {
  const expat = JSON.parse(await readFile(join(template, 'expat.json'), 'utf8'));
  const rpmPath = join(stagingParent, basename(new URL(expat.url).pathname));
  let rpm = await readFile(rpmPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  const cached = rpm !== null;
  if (!cached) {
    const response = await fetch(expat.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Expat download failed (HTTP ${response.status}).`);
    rpm = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(rpm).digest('hex') !== expat.sha256) {
    throw new Error(`Unexpected checksum for ${rpmPath}.`);
  }
  if (!cached) await writeFile(rpmPath, rpm);

  const tar = process.platform === 'win32' ? 'tar.exe' : 'bsdtar';
  const native = join(staging, 'native');
  await mkdir(native);
  await Promise.all([
    [expat.library, 'libexpat.so.1'],
    [expat.license, 'expat-COPYING'],
  ].map(async ([member, file]) => {
    const { stdout } = await run(tar, ['-xOf', rpmPath, member], { encoding: 'buffer' });
    if (!stdout.length) throw new Error(`Empty Expat archive member: ${member}.`);
    await writeFile(join(native, file), stdout);
  }));
}

await mkdir(stagingParent, { recursive: true });
const staging = await mkdtemp(join(stagingParent, 'release-'));
await mkdir(join(staging, 'agronomy'));
const [fieldRequirements, serviceRequirements] = await Promise.all([
  readFile(join(backend, 'agronomy/requirements-field-data.txt'), 'utf8'),
  readFile(join(backend, 'agronomy/requirements-service.txt'), 'utf8'),
]);
const requirements = serviceRequirements.replace(/^\s*-r requirements-field-data\.txt\r?$/m, () => fieldRequirements.trimEnd());
await Promise.all([
  ...backendFiles.map(file => copyFile(join(backend, file), join(staging, file))),
  ...['app.py', '.python-version', '.vercelignore', 'vercel.json']
    .map(file => copyFile(join(template, file), join(staging, file))),
  writeFile(join(staging, 'requirements.txt'), `${requirements.trimEnd()}\n`),
  stageExpat(staging),
]);

await build({
  root: frontend,
  configLoader: 'native',
  define: {
    'import.meta.env.VITE_ORBITFARM_LIVE_API': JSON.stringify('1'),
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(''),
  },
  build: { outDir: join(staging, 'dist'), emptyOutDir: false },
});

if (!(await lstat(join(staging, 'dist/index.html'))).isFile()) {
  throw new Error('The Vercel release needs a built dist/index.html.');
}
process.stdout.write(`Vercel release directory: ${staging}\n`);
