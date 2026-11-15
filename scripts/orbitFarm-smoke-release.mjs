import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const staleEtag = '"c6e39d374b170c1e45c5bd4ec8616573"';
const futureModifiedSince = 'Fri, 01 Jan 2100 00:00:00 GMT';
const htmlRequests = [
  { name: 'unconditional', headers: {} },
  { name: 'stale ETag', headers: { 'If-None-Match': staleEtag } },
  { name: 'future modification date', headers: { 'If-Modified-Since': futureModifiedSince } },
  { name: 'both cache validators', headers: { 'If-None-Match': staleEtag, 'If-Modified-Since': futureModifiedSince } },
];

async function request(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${url} returned HTTP ${response.status}; expected 200.`);
  return response;
}

function contentType(response) {
  return (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

function collectAssets(html, pageUrl, assets) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)];
  const stylesheets = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter(([tag]) => /\brel\s*=\s*["']stylesheet["']/i.test(tag))
    .map(([tag]) => tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1])
    .filter(Boolean);
  assert(scripts.length > 0, `${pageUrl} has no external script reference.`);
  assert(stylesheets.length > 0, `${pageUrl} has no stylesheet reference.`);
  for (const [, src] of scripts) assets.set(new URL(src, pageUrl).href, 'script');
  for (const href of stylesheets) assets.set(new URL(href, pageUrl).href, 'stylesheet');
}

async function verifyRelease(baseUrl) {
  const healthUrl = new URL('/health', baseUrl);
  const healthResponse = await request(healthUrl);
  assert.equal(contentType(healthResponse), 'application/json', `${healthUrl} must return JSON.`);
  assert.equal((await healthResponse.json()).status, 'ok', `${healthUrl} did not report status "ok".`);
  process.stdout.write('PASS /health: HTTP 200 and status ok.\n');

  const assets = new Map();
  for (const path of ['/', '/index.html']) {
    const pageUrl = new URL(path, baseUrl);
    const results = await Promise.allSettled(htmlRequests.map(async ({ name, headers }) => {
      const response = await request(pageUrl, headers);
      assert.equal(contentType(response), 'text/html', `${path} (${name}) must return HTML.`);
      assert(/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('cache-control') ?? ''),
        `${path} (${name}) must send Cache-Control: no-store.`);
      const html = await response.text();
      assert(/<html\b/i.test(html), `${path} (${name}) returned an invalid HTML document.`);
      collectAssets(html, pageUrl, assets);
    }));
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    process.stdout.write(`PASS ${path}: HTML uses no-store; stale and future validators still return HTTP 200.\n`);
  }

  const results = await Promise.allSettled([...assets].map(async ([url, type]) => {
    const response = await request(url);
    const mime = contentType(response);
    const valid = type === 'stylesheet' ? mime === 'text/css'
      : ['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(mime);
    assert(valid, `${url} returned ${mime || 'no Content-Type'}; expected ${type} MIME type.`);
    await response.arrayBuffer();
    process.stdout.write(`PASS ${type}: ${new URL(url).pathname}\n`);
  }));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  process.stdout.write(`Release smoke check passed for ${baseUrl.origin} (${assets.size} assets).\n`);
}

export async function verifyReleaseWithRetry(baseUrl, { attempts = 6, delayMs = 5_000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await verifyRelease(baseUrl);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Release smoke attempt ${attempt}/${attempts} failed: ${message} Retrying in ${delayMs / 1_000}s.\n`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.length, 3, 'Usage: node scripts/orbitFarm-smoke-release.mjs <base-url>');
    const baseUrl = new URL(process.argv[2]);
    assert(['http:', 'https:'].includes(baseUrl.protocol), 'The base URL must use HTTP or HTTPS.');
    await verifyReleaseWithRetry(baseUrl);
  } catch (error) {
    process.stderr.write(`Release smoke check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
