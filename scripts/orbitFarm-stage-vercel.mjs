import { createHash } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { extractRpmFiles } from './orbitFarm-rpm.mjs';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const backend = resolve(process.argv[2] ?? frontend);
const stagingParent = join(frontend, '.vercel');
const template = join(frontend, 'deployment/vercel');
const backendFiles = [
  'AgroWise_crop_requirements_clean.csv',
  'data_pipeline.py',
  ...(await readdir(join(backend, 'agronomy'), { withFileTypes: true }))
    .filter(file => file.isFile() && /\.(py|json)$/.test(file.name))
    .map(file => join('agronomy', file.name)),
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

  const native = join(staging, 'native');
  await mkdir(native);
  const contents = extractRpmFiles(rpm, [expat.library, expat.license]);
  await Promise.all([
    [expat.library, 'libexpat.so.1'],
    [expat.license, 'expat-COPYING'],
  ].map(async ([member, file], index) => {
    if (!contents[index].length) throw new Error(`Empty Expat archive member: ${member}.`);
    await writeFile(join(native, file), contents[index]);
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
  cp(join(backend, 'agronomy/regional_inputs'), join(staging, 'agronomy/regional_inputs'), { recursive: true }),
  cp(join(backend, 'agronomy/province_inputs'), join(staging, 'agronomy/province_inputs'), { recursive: true }),
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
