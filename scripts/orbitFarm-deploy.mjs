import { appendFile, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyReleaseWithRetry } from './orbitFarm-smoke-release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function parseOptions(argv) {
  if (argv.some(value => !['--prod', '--dry-run'].includes(value))) {
    throw new Error('Usage: npm run deploy:preview|deploy:production -- [--dry-run]');
  }
  return { production: argv.includes('--prod'), dryRun: argv.includes('--dry-run') };
}

export function deploymentArguments({ production, revision, token }) {
  return ['--yes', 'vercel@65.16.0', 'deploy', '--yes', '--env', 'PORT=8000',
    '--meta', `orbitFarmCommit=${revision}`, ...(production ? ['--prod'] : []),
    ...(token ? ['--token', token] : [])];
}

export function deploymentUrl(stdout) {
  const lines = stdout.replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\s+/);
  const url = lines.findLast(value => /^https:\/\/[a-z0-9-]+\.vercel\.app\/?$/i.test(value));
  if (!url) throw new Error('The Vercel CLI did not return a deployment URL.');
  return new URL(url);
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Deployment requires a readable Git checkout.');
  return result.stdout.trim();
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Deployment requires Node.js 22.12 or newer.');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  if (config.framework !== 'container' || !(await stat(new URL('../Dockerfile.vercel', import.meta.url))).isFile()) {
    throw new Error('The canonical Container Runtime configuration and Dockerfile are required.');
  }
  const revision = git(['rev-parse', 'HEAD']);
  const dirty = Boolean(git(['status', '--porcelain']));
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ revision, production: options.production, dirty,
      command: ['npx', ...deploymentArguments({ ...options, revision })],
      verification: 'HTML/assets, 38-model readiness, NASA context, 10 national and 20 seasonal forecasts' }, null, 2)}\n`);
    return;
  }
  if (dirty) throw new Error('Commit or isolate local changes before deploying a reviewed revision.');
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    deploymentArguments({ ...options, revision, token: process.env.VERCEL_TOKEN }),
    { cwd: root, env: process.env, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  if (result.error || result.status !== 0) throw new Error('Vercel deployment failed; inspect the CLI diagnostics above.');
  const url = deploymentUrl(result.stdout);
  await verifyReleaseWithRetry(url);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `url=${url.origin}\n`);
  process.stdout.write(`Verified deployment: ${url.origin} (commit ${revision}).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
