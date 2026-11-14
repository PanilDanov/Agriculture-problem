import { cp, lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const output = fileURLToPath(new URL('../.vercel/output/', import.meta.url));
const staticOutput = fileURLToPath(new URL('../.vercel/output/static/', import.meta.url));

try {
  const index = await lstat(fileURLToPath(new URL('../dist/index.html', import.meta.url)));
  if (!index.isFile()) throw new Error('dist/index.html must be a regular file.');

  await mkdir(output, { recursive: true });
  await rm(staticOutput, { recursive: true, force: true });
  await cp(dist, staticOutput, { recursive: true, preserveTimestamps: true });
  await writeFile(`${output}/config.json`, `${JSON.stringify({ version: 3 }, null, 2)}\n`);
  process.stdout.write('Prepared .vercel/output from the existing dist files. No build was run.\n');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown packaging error.';
  process.stderr.write(`Vercel packaging failed: ${message}\nRun npm run verify successfully before npm run deploy:prepare.\n`);
  process.exitCode = 1;
}
