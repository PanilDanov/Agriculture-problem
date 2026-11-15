import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentArguments, deploymentUrl, parseOptions } from './orbitFarm-deploy.mjs';
import { verificationHeaders } from './orbitFarm-smoke-release.mjs';

test('deployment options are explicit and reject unknown arguments', () => {
  assert.deepEqual(parseOptions([]), { production: false, dryRun: false });
  assert.deepEqual(parseOptions(['--prod', '--dry-run']), { production: true, dryRun: true });
  assert.throws(() => parseOptions(['--force']), /Usage/);
});

test('the pinned Container deployment uses one origin and records its revision', () => {
  const args = deploymentArguments({ production: true, revision: 'test-sha', token: 'fixture-token' });
  assert(args.includes('vercel@65.16.0'));
  assert(args.includes('PORT=8000'));
  assert(args.includes('orbitFarmCommit=test-sha'));
  assert(args.includes('--prod'));
  assert.deepEqual(args.slice(-2), ['--token', 'fixture-token']);
  assert(!deploymentArguments({ production: false, revision: 'test-sha' }).includes('--token'));
});

test('only the immutable HTTPS deployment URL is accepted from CLI output', () => {
  assert.equal(deploymentUrl('Inspect: https://vercel.com/team/project\nhttps://orbitfarm-example.vercel.app\n').origin,
    'https://orbitfarm-example.vercel.app');
  for (const value of ['http://orbitfarm-example.vercel.app', 'https://example.com', 'https://secret@orbitfarm-example.vercel.app']) {
    assert.throws(() => deploymentUrl(value), /deployment URL/);
  }
});

test('preview protection credentials stay on the verified deployment origin', () => {
  assert.deepEqual(verificationHeaders('https://app.vercel.app/ready', 'https://app.vercel.app', {}, 'fixture-secret'),
    { 'x-vercel-protection-bypass': 'fixture-secret' });
  assert.deepEqual(verificationHeaders('https://assets.example/script.js', 'https://app.vercel.app', {}, 'fixture-secret'), {});
});
