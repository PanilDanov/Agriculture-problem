import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const staleEtag = '"c6e39d374b170c1e45c5bd4ec8616573"';
const futureModifiedSince = 'Fri, 01 Jan 2100 00:00:00 GMT';
const htmlRequests = [
  { name: 'unconditional', headers: {} },
  { name: 'stale ETag', headers: { 'If-None-Match': staleEtag } },
  { name: 'future modification date', headers: { 'If-Modified-Since': futureModifiedSince } },
  { name: 'both cache validators', headers: { 'If-None-Match': staleEtag, 'If-Modified-Since': futureModifiedSince } },
];

export function verificationHeaders(url, baseUrl, headers = {}, bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  return { ...headers, ...(bypass && new URL(url).origin === new URL(baseUrl).origin
    ? { 'x-vercel-protection-bypass': bypass } : {}) };
}

async function request(url, headers, baseUrl) {
  const response = await fetch(url, { headers: verificationHeaders(url, baseUrl, headers), redirect: 'error', signal: AbortSignal.timeout(30_000) });
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
  const healthResponse = await request(healthUrl, {}, baseUrl);
  assert.equal(contentType(healthResponse), 'application/json', `${healthUrl} must return JSON.`);
  assert.equal((await healthResponse.json()).status, 'ok', `${healthUrl} did not report status "ok".`);
  process.stdout.write('PASS /health: HTTP 200 and status ok.\n');
  const readyResponse = await request(new URL('/ready', baseUrl), {}, baseUrl);
  const ready = await readyResponse.json();
  assert.equal(ready.status, 'ready', 'The field API must report actual ML readiness.');
  const models = ready.yieldService?.details;
  assert.equal(models?.regionalModels?.length, 8);
  assert(models.regionalModels.every(row => row.status === 'ready'));
  assert.equal(models?.nationalModels?.readyModels, 10);
  assert.equal(models?.provinceModels?.readyModels, 20);
  process.stdout.write('PASS /ready: field API and all packaged ML models are ready.\n');

  const assets = new Map();
  for (const path of ['/', '/index.html']) {
    const pageUrl = new URL(path, baseUrl);
    const results = await Promise.allSettled(htmlRequests.map(async ({ name, headers }) => {
      const response = await request(pageUrl, headers, baseUrl);
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
    const response = await request(url, {}, baseUrl);
    const mime = contentType(response);
    const valid = type === 'stylesheet' ? mime === 'text/css'
      : ['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(mime);
    assert(valid, `${url} returned ${mime || 'no Content-Type'}; expected ${type} MIME type.`);
    await response.arrayBuffer();
    process.stdout.write(`PASS ${type}: ${new URL(url).pathname}\n`);
  }));
  for (const result of results) if (result.status === 'rejected') throw result.reason;

  const payload = JSON.parse(await readFile(new URL('../deployment/smoke-field.json', import.meta.url), 'utf8'));
  const analysisUrl = new URL('/v1/analysis', baseUrl);
  const analysisResponse = await fetch(analysisUrl, {
    method: 'POST',
    redirect: 'error',
    headers: verificationHeaders(analysisUrl, baseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(55_000),
  });
  assert.equal(analysisResponse.status, 200, `Real field analysis returned HTTP ${analysisResponse.status}.`);
  const analysis = await analysisResponse.json();
  assert(['nasa-api', 'nasa-cache'].includes(analysis.dataMode), 'Release analysis must use actual NASA observations.');
  assert.equal(analysis.cropOptions?.length, 10, 'All ten crop options must be present.');
  assert.equal(analysis.rotationPlans?.length, 3, 'All three rotation plans must be present.');
  assert.equal(analysis.yieldForecasts?.length, 10, 'All ten yield model results must be present.');
  for (const row of analysis.yieldForecasts) {
    assert.equal(row.status, 'available', `${row.cropId} forecast is unavailable: ${row.reason ?? row.code ?? 'unknown reason'}`);
    assert.equal(row.forecast?.spatial_level, 'country', 'National forecasts must preserve their actual spatial scope.');
    assert(Number.isFinite(row.forecast.predicted_yield_t_ha) && row.forecast.predicted_yield_t_ha > 0,
      `${row.cropId} must return a finite, positive actual model forecast.`);
    assert(row.forecast.model_version, `${row.cropId} must identify its model version.`);
    assert.equal(row.usesNasaWeather, false, 'Annual yield-history models must not claim NASA weather as a predictor.');
  }
  process.stdout.write('PASS /v1/analysis: real NASA field context and ten actual country ML forecasts.\n');

  const provincePayload = JSON.parse(await readFile(new URL('../deployment/smoke-province-field.json', import.meta.url), 'utf8'));
  for (const mode of ['pre_season', 'mid_season']) {
    provincePayload.yieldForecast = { mode, harvestYear: 2026 };
    const response = await fetch(analysisUrl, { method: 'POST', redirect: 'error',
      headers: verificationHeaders(analysisUrl, baseUrl, { 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify(provincePayload), signal: AbortSignal.timeout(55_000) });
    assert.equal(response.status, 200, `Province ${mode} returned HTTP ${response.status}.`);
    const result = await response.json();
    assert(['nasa-api', 'nasa-cache'].includes(result.dataMode), 'Province analysis must use real NASA context.');
    assert.equal(result.yieldForecasts?.length, 10);
    for (const row of result.yieldForecasts) {
      assert.equal(row.status, 'available', `${row.cropId}/${mode}: ${row.reason ?? row.code}`);
      const forecast = row.forecast;
      assert.equal(forecast?.crop, row.cropId);
      assert.equal(forecast?.mode, mode);
      assert.equal(forecast?.harvest_year, 2026);
      assert.equal(forecast?.country_code, 'ES');
      assert.equal(forecast?.region_id, '50');
      assert.equal(forecast?.spatial_level, 'administrative_region');
      assert.equal(forecast?.weather_support, 'representative_point');
      assert.equal(forecast?.release_status, 'experimental');
      assert.equal(forecast?.is_replay, true);
      assert(forecast.model_version && forecast.forecast_date && forecast.calculated_at);
      assert(forecast.forecast_date < forecast.calculated_at.slice(0, 10));
      assert(Number.isFinite(forecast.predicted_yield_t_ha) && forecast.predicted_yield_t_ha >= 0);
      assert.equal(row.usesNasaWeather, true);
    }
    process.stdout.write(`PASS /v1/analysis ${mode}: ten real NASA/MAPA forecasts with province/point/replay scope.\n`);
  }
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
