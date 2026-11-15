import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, (route) => route.abort());
  page.on('dialog', (dialog) => dialog.accept());
});

async function freezeProviderClock(page: Page) {
  await page.clock.install({ time: new Date('2026-11-14T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-14T12:01:00Z'));
}

test('the scanner follows the analysis request through success and failure', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await freezeProviderClock(page);
  await page.goto('/#/farm');
  await page.getByRole('button', { name: 'Analyze field', exact: true }).click();

  const scanner = page.getByTestId('orbit-scanner');
  await expect(page).toHaveURL(/#\/plans$/);
  await expect(scanner).toBeVisible();
  await expect(scanner).toHaveAttribute('data-state', 'scanning');
  await expect(page.getByRole('button', { name: 'Use this plan', exact: true })).toHaveCount(0);

  // Complete the mock provider's timer, independently of animation durations.
  await page.clock.runFor(1_000);
  await expect(scanner).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Use this plan', exact: true }).first()).toBeVisible();

  await page.goto('/#/lab');
  await page.getByRole('button', { name: 'Load api-unavailable', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze field', exact: true }).click();
  await expect(scanner).toBeVisible();
  await page.clock.runFor(1_000);
  await expect(scanner).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Analysis unavailable');
  await page.getByRole('button', { name: /^(?:Retry|Try again)$/ }).click();
  await expect(scanner).toBeVisible();
  await page.clock.runFor(1_000);
  await expect(scanner).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Analysis unavailable');
  expect(runtimeErrors).toEqual([]);
});

test('reduced motion keeps scanner status and preview controls usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/lab');
  const scanner = page.getByTestId('orbit-scanner');
  await expect(scanner).toBeVisible();
  await expect(scanner).toHaveAttribute('data-state', 'scanning');
  await expect.poll(() => scanner.locator('img').evaluate((element) =>
    element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
  await expect.poll(() => scanner.evaluate((element) => element.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === 'running').length)).toBe(0);

  await page.getByRole('button', { name: 'Show completion', exact: true }).click();
  await expect(scanner).toHaveAttribute('data-state', 'complete');
  await page.getByRole('button', { name: 'Replay arrival', exact: true }).click();
  await expect(scanner).toHaveAttribute('data-state', 'scanning');
  await expect.poll(() => scanner.evaluate((element) => element.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === 'running').length)).toBe(0);
});

test('@mobile the scanner preview and completion fit narrow screens', async ({ page }) => {
  await page.goto('/#/lab');
  const scanner = page.getByTestId('orbit-scanner');
  await scanner.scrollIntoViewIfNeeded();
  await expect(scanner).toBeVisible();
  await expect(scanner.getByTestId('orbit-scanner-craft')).toBeVisible();
  await expect.poll(() => scanner.locator('img').evaluate((element) =>
    element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);

  const widths = () => page.evaluate(() => ({
    viewport: window.innerWidth,
    content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  }));
  let measured = await widths();
  expect(measured.content).toBeLessThanOrEqual(measured.viewport + 1);

  await page.getByRole('button', { name: 'Show completion', exact: true }).click();
  await expect(scanner).toHaveAttribute('data-state', 'complete');
  measured = await widths();
  expect(measured.content).toBeLessThanOrEqual(measured.viewport + 1);
});

const scannerSpritePattern = '**/assets/orbit-1/orbit-1-scanner-v1.png*';

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function holdAnalysis(page: Page) {
  const pending = deferred();
  await page.addInitScript(() => {
    localStorage.setItem('orbitFarm.provider.v1', JSON.stringify({ mode: 'api', baseUrl: location.origin }));
  });
  await page.route('**/v1/analysis', async route => {
    await pending.promise;
    const { makeMockAnalysis } = await import('../src/domain/orbitFarm-fixtures');
    const result = makeMockAnalysis(route.request().postDataJSON(), 'normal');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return pending;
}

test('opening the farm warms every crop stage and the scene artwork before analysis', async ({ page }) => {
  const { CROP_IDS } = await import('../src/domain/orbitFarm-crop-catalog');
  const requested = new Set<string>();
  page.on('request', request => requested.add(new URL(request.url()).pathname));
  await page.goto('/#/farm', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Your farm', exact: true })).toBeVisible();
  const expected = [
    '/assets/orbit-1/orbit-1-scanner-v1.png',
    '/assets/farm/orbitFarm-meadow-v2.png',
    '/assets/farm/orbitFarm-dog-astronaut-v1.png',
    ...CROP_IDS.flatMap(crop => ['seedling-v1', 'growing-v1', 'field-v2'].map(stage => `/assets/farm/crops/${crop}-${stage}.png`)),
  ];
  await expect.poll(() => expected.filter(path => !requested.has(path)), {
    message: 'All local farm artwork should begin loading when the site opens, before an analysis or a crop-stage change.',
  }).toEqual([]);
  await expect(page.getByTestId('orbit-scanner')).toHaveCount(0);
});

test('a delayed satellite has a visible fallback during analysis and swaps to its loaded sprite', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  const image = deferred();
  const analysis = await holdAnalysis(page);
  let imageRequests = 0;
  await page.route(scannerSpritePattern, async route => {
    imageRequests++;
    await image.promise;
    await route.continue();
  });
  try {
    await page.goto('/#/farm', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => imageRequests).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Analyze field', exact: true }).click();
    const scanner = page.getByTestId('orbit-scanner');
    await expect(scanner).toBeVisible();
    await expect(scanner.getByTestId('orbit-scanner-fallback')).toBeVisible();
    await expect(scanner.getByTestId('orbit-scanner-craft')).toHaveAttribute('data-asset-state', 'loading');
    await page.screenshot({ path: testInfo.outputPath('scanner-delayed-image-fallback.png'), fullPage: true });
    image.release();
    await expect(scanner.getByTestId('orbit-scanner-craft')).toHaveAttribute('data-asset-state', 'ready');
    await expect.poll(() => scanner.locator('img').evaluate(element =>
      element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
    await expect(scanner.getByTestId('orbit-scanner-fallback')).toBeHidden();
    analysis.release();
    await expect(scanner).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use this plan', exact: true }).first()).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  } finally {
    image.release();
    analysis.release();
  }
});

test('a transient satellite download failure is retried and recovers the original artwork', async ({ page }) => {
  let attempts = 0;
  await page.route(scannerSpritePattern, route => {
    attempts++;
    return attempts === 1
      ? route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary image outage' })
      : route.continue();
  });
  await page.goto('/#/lab', { waitUntil: 'domcontentloaded' });
  const scanner = page.getByTestId('orbit-scanner');
  await expect(scanner).toBeVisible();
  await expect.poll(() => attempts).toBeGreaterThan(1);
  await expect(scanner.getByTestId('orbit-scanner-craft')).toHaveAttribute('data-asset-state', 'ready');
  await expect.poll(() => scanner.locator('img').evaluate(element =>
    element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
  await expect(scanner.getByTestId('orbit-scanner-fallback')).toBeHidden();
});

test('a missing satellite keeps the fallback visible and never blocks the analysis result', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  const analysis = await holdAnalysis(page);
  let attempts = 0;
  await page.route(scannerSpritePattern, route => {
    attempts++;
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Artwork unavailable in this test' });
  });
  try {
    await page.goto('/#/farm', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Analyze field', exact: true }).click();
    const scanner = page.getByTestId('orbit-scanner');
    await expect(scanner.getByTestId('orbit-scanner-fallback')).toBeVisible();
    await expect(scanner.getByTestId('orbit-scanner-craft')).toHaveAttribute('data-asset-state', 'error');
    await expect.poll(() => attempts).toBeGreaterThan(1);
    analysis.release();
    await expect(scanner).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Use this plan', exact: true }).first()).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  } finally {
    analysis.release();
  }
});

test('@mobile a missing scanner image still shows the craft and keeps preview controls usable', async ({ page }) => {
  await page.route(scannerSpritePattern, route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Missing test artwork' }));
  await page.goto('/#/lab', { waitUntil: 'domcontentloaded' });
  const scanner = page.getByTestId('orbit-scanner');
  await scanner.scrollIntoViewIfNeeded();
  await expect(scanner.getByTestId('orbit-scanner-fallback')).toBeVisible();
  const measured = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) }));
  expect(measured.content).toBeLessThanOrEqual(measured.viewport + 1);
  await page.getByRole('button', { name: 'Show completion', exact: true }).click();
  await expect(scanner).toHaveAttribute('data-state', 'complete');
  await expect(scanner.getByTestId('orbit-scanner-fallback')).toBeVisible();
});
