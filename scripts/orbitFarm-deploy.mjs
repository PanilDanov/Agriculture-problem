import { appendFile, readFile, stat } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
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
  return ['--yes', 'vercel@65.16.0', 'deploy', '--json', '--yes', '--env', 'PORT=8000',
    '--meta', `orbitFarmCommit=${revision}`, ...(production ? ['--prod'] : []),
    ...(token ? ['--token', token] : [])];
}

function immutableUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.startsWith('https://') ? value : `https://${value}`);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        url.pathname === '/' && !url.search && !url.hash &&
        /^[a-z0-9-]+-[a-z0-9]{9}(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(url.hostname)) return url;
  } catch { /* Not a deployment origin. */ }
  return null;
}

export function deploymentUrl(stdout = '', stderr = '') {
  const streams = [stdout, stderr].map(value => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim());
  // CLI 65.16 supports --json. Read the deployment's url, never its aliases.
  for (const stream of streams) {
    for (const document of [stream, ...stream.split(/\r?\n/)]) {
      try {
        const data = JSON.parse(document);
        const url = immutableUrl(data?.deployment?.url ?? data?.url);
        if (url) return url;
      } catch { /* Human-readable output is handled below. */ }
    }
  }
  const labelled = new Set();
  for (const line of streams.flatMap(value => value.split(/[\r\n]+/))) {
    if (/\b(?:Aliased|Inspect):/i.test(line)) continue;
    const match = line.match(/\b(?:Production|Preview):\s*(https:\/\/[^\s]+)/i);
    const url = match && immutableUrl(match[1]);
    if (url) labelled.add(url.origin);
  }
  if (labelled.size === 1) return new URL([...labelled][0]);
  if (labelled.size > 1) throw new Error('The Vercel CLI returned conflicting deployment URLs.');
  // Older CLI versions can print only the immutable URL to stdout.
  const bare = new Set(streams[0].split(/[\r\n]+/).map(value => immutableUrl(value.trim())?.origin).filter(Boolean));
  if (bare.size === 1) return new URL([...bare][0]);
  throw new Error('The Vercel CLI did not return an unambiguous immutable deployment URL.');
}

export function runCli(command, args, { cwd = root, env = process.env,
  writeStdout = value => process.stdout.write(value), writeStderr = value => process.stderr.write(value) } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
    const output = { stdout: '', stderr: '' };
    const secrets = [env.VERCEL_TOKEN, env.VERCEL_AUTOMATION_BYPASS_SECRET].filter(Boolean);
    const redact = value => secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value);
    for (const [name, write] of [['stdout', writeStdout], ['stderr', writeStderr]]) {
      let pending = '';
      child[name].setEncoding('utf8');
      child[name].on('data', chunk => {
        output[name] = (output[name] + chunk).slice(-8 * 1024 * 1024);
        pending += chunk;
        let end;
        while ((end = pending.search(/[\r\n]/)) !== -1) {
          write(redact(pending.slice(0, end + 1)));
          pending = pending.slice(end + 1);
        }
      });
      child[name].on('end', () => { if (pending) write(redact(pending)); });
    }
    child.once('error', () => reject(new Error('The Vercel CLI could not be started.')));
    child.once('close', (status, signal) => resolve({ ...output, status, signal }));
  });
}

export async function verifyDeploymentResult(result, verify = verifyReleaseWithRetry) {
  if (result.status !== 0 || result.signal) throw new Error('Vercel deployment failed; inspect the CLI diagnostics above.');
  const url = deploymentUrl(result.stdout, result.stderr);
  await verify(url);
  return url;
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
  const result = await runCli(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    deploymentArguments({ ...options, revision, token: process.env.VERCEL_TOKEN }),
    { cwd: root, env: process.env });
  const url = await verifyDeploymentResult(result);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `url=${url.origin}\n`);
  process.stdout.write(`Verified deployment: ${url.origin} (commit ${revision}).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
