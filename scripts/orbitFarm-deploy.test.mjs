import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentArguments, deploymentUrl, parseOptions, runCli, verifyDeploymentResult } from './orbitFarm-deploy.mjs';
import { verificationHeaders } from './orbitFarm-smoke-release.mjs';

const immutable = 'https://orbitfarm-14jycox6c-lu1dgys-projects.vercel.app';
const realOutput = [
  'Vercel CLI 65.16.0',
  'Inspect: https://vercel.com/lu1dgys-projects/orbitfarm/8fXa4YcUL29Qq7LARPWDNFkzdUxS [2s]',
  `Production: ${immutable} [2m]`,
  'Aliased: https://orbitfarm.vercel.app [2m]',
].join('\n');

test('deployment options are explicit and reject unknown arguments', () => {
  assert.deepEqual(parseOptions([]), { production: false, dryRun: false });
  assert.deepEqual(parseOptions(['--prod', '--dry-run']), { production: true, dryRun: true });
  assert.throws(() => parseOptions(['--force']), /Usage/);
});

test('the pinned Container deployment uses one origin and records its revision', () => {
  const args = deploymentArguments({ production: true, revision: 'test-sha', token: 'fixture-token' });
  assert(args.includes('vercel@65.16.0'));
  assert(args.includes('--json'));
  assert(args.includes('PORT=8000'));
  assert(args.includes('orbitFarmCommit=test-sha'));
  assert(args.includes('--prod'));
  assert.deepEqual(args.slice(-2), ['--token', 'fixture-token']);
  assert(!deploymentArguments({ production: false, revision: 'test-sha' }).includes('--token'));
});

test('only the immutable HTTPS deployment URL is accepted from CLI output', () => {
  assert.equal(deploymentUrl(`Inspect: https://vercel.com/team/project\n${immutable}\n`).origin, immutable);
  for (const value of ['http://orbitfarm-example.vercel.app', 'https://example.com',
    'https://orbitfarm.vercel.app', `https://secret@${new URL(immutable).hostname}`, `${immutable}/?token=fixture`]) {
    assert.throws(() => deploymentUrl(value), /deployment URL/);
  }
});

test('actual CLI stderr Production wins over the later root alias and Inspect page', () => {
  assert.equal(deploymentUrl('', realOutput).origin, immutable);
  assert.equal(deploymentUrl('', realOutput.replace('Production:', '\x1b[32mPreview:\x1b[0m')).origin, immutable);
  assert.throws(() => deploymentUrl('', realOutput.split('\n').filter(line => !line.startsWith('Production:')).join('\n')),
    /deployment URL/);
  assert.throws(() => deploymentUrl('', `Aliased: ${immutable}`), /deployment URL/);
});

test('JSON deployment url is normalized without reading its aliases', () => {
  const document = JSON.stringify({ id: 'dpl_8fXa4YcUL29Qq7LARPWDNFkzdUxS',
    url: new URL(immutable).hostname, readyState: 'READY', aliases: ['orbitfarm.vercel.app'] });
  assert.equal(deploymentUrl(document, realOutput).origin, immutable);
  assert.equal(deploymentUrl('', JSON.stringify({ deployment: JSON.parse(document) })).origin, immutable);
  assert.throws(() => deploymentUrl(JSON.stringify({ aliases: [immutable] })), /deployment URL/);
});

test('conflicting labelled deployment URLs fail closed', () => {
  assert.throws(() => deploymentUrl('', `${realOutput}\nProduction: https://orbitfarm-abcdefghi-team.vercel.app`), /conflicting/);
});

test('both child streams are captured and streamed, with split credentials redacted', async () => {
  let stdout = '', stderr = '';
  const code = `process.stdout.write('fixture-'); setTimeout(() => {
    process.stdout.write('token\\n'); process.stderr.write(${JSON.stringify(realOutput + '\n')});
  }, 10);`;
  const result = await runCli(process.execPath, ['-e', code], {
    env: { ...process.env, VERCEL_TOKEN: 'fixture-token' },
    writeStdout: value => { stdout += value; }, writeStderr: value => { stderr += value; },
  });
  assert.equal(result.status, 0);
  assert(result.stdout.includes('fixture-token'));
  assert(result.stderr.includes('Production:'));
  assert(!stdout.includes('fixture-token'));
  assert(stdout.includes('[REDACTED]'));
  assert(stderr.includes('Inspect:') && stderr.includes('Aliased:'));
  assert.equal(deploymentUrl(result.stdout, result.stderr).origin, immutable);
});

test('only successful deployments reach verification, always at the immutable origin', async () => {
  const verified = [];
  const verify = async url => { verified.push(url.origin); };
  const url = await verifyDeploymentResult({ status: 0, stdout: '', stderr: realOutput }, verify);
  assert.equal(url.origin, immutable);
  assert.deepEqual(verified, [immutable]);
  await assert.rejects(verifyDeploymentResult({ status: 1, stdout: immutable, stderr: realOutput }, verify), /deployment failed/);
  await assert.rejects(verifyDeploymentResult({ status: 0, stdout: '', stderr: 'Aliased: https://orbitfarm.vercel.app' }, verify), /deployment URL/);
  assert.deepEqual(verified, [immutable]);
  await assert.rejects(verifyDeploymentResult({ status: 0, stdout: immutable, stderr: '' },
    async () => { throw new Error('fixture verification failed'); }), /fixture verification failed/);
});

test('preview protection credentials stay on the verified deployment origin', () => {
  assert.deepEqual(verificationHeaders('https://app.vercel.app/ready', 'https://app.vercel.app', {}, 'fixture-secret'),
    { 'x-vercel-protection-bypass': 'fixture-secret' });
  assert.deepEqual(verificationHeaders('https://assets.example/script.js', 'https://app.vercel.app', {}, 'fixture-secret'), {});
});
