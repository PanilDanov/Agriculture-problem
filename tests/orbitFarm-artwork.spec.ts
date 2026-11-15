import { expect, test, type Page } from '@playwright/test';
import { createScenarioState } from '../src/domain/orbitFarm-model';
import { STORAGE_KEY } from '../src/domain/orbitFarm-storage';

// These are presentation fixtures, not inference or source-data validation.
async function loadFixture(page: Page, hasAnalysis = true) {
  const farm = createScenarioState('normal');
  if (!hasAnalysis) farm.analysis = null;
  await page.addInitScript(({ farm, key }) => localStorage.setItem(key, JSON.stringify(farm)), { farm, key: STORAGE_KEY });
  await page.goto(hasAnalysis ? '/#/farm' : '/#/plans');
}

async function checkMark(page: Page, selector: string) {
  const mark = page.locator(selector).getByText('AI-generated artwork', { exact: true });
  await expect(mark).toBeVisible();
  const result = await mark.evaluate(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const luminance = (color: string) => {
      const rgb = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(v => v / 255)
        .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    };
    const a = luminance(style.color), b = luminance(style.backgroundColor);
    return { fontSize: parseFloat(style.fontSize), contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
      pointerEvents: style.pointerEvents, left: rect.left, right: rect.right, width: rect.width };
  });
  expect(result.fontSize).toBeGreaterThanOrEqual(10);
  expect(result.contrast).toBeGreaterThanOrEqual(4.5);
  expect(result.pointerEvents).toBe('none');
  expect(result.left).toBeGreaterThanOrEqual(0);
  expect(result.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(result.width).toBeGreaterThan(100);
}

async function checkArtworkViews(page: Page, screenshot: (name: string) => string) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await loadFixture(page);
  await checkMark(page, '[data-testid="farm-scene"]');
  const art = await page.locator('.of-farm-canvas').boundingBox();
  const mark = await page.locator('[data-testid="farm-scene"] [data-ai-generated-artwork]').boundingBox();
  expect(art).not.toBeNull();
  expect(mark).not.toBeNull();
  expect(mark!.y + mark!.height).toBeLessThanOrEqual(art!.y + art!.height);
  expect(mark!.x + mark!.width).toBeLessThanOrEqual(art!.x + art!.width);
  await page.getByTestId('plot-slot-1').click();
  await expect(page.getByTestId('plot-card')).toBeVisible();
  await page.getByTestId('farm-scene').screenshot({ path: screenshot('artwork-farm.png'), animations: 'disabled' });
  await page.goto('/#/plans');
  await expect(page.locator('.rotation-card').first().getByText('AI-generated artwork', { exact: true })).toBeVisible();
  await expect(page.locator('.crop-option').first().getByText('AI-generated artwork', { exact: true })).toBeVisible();
  await expect(page.locator('.of-yield-card').first().getByText('AI-generated artwork', { exact: true })).toBeVisible();
  await page.locator('.rotation-grid').screenshot({ path: screenshot('artwork-rotations.png'), animations: 'disabled' });
  await page.goto('/#/lab');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await checkMark(page, '[data-testid="orbit-scanner"]');
  await page.getByRole('button', { name: 'Show completion', exact: true }).click();
  await checkMark(page, '[data-testid="orbit-scanner"]');
  await page.getByTestId('orbit-scanner').screenshot({ path: screenshot('artwork-scanner.png'), animations: 'disabled' });
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(errors).toEqual([]);
}

test('generated artwork is visibly marked without blocking bed selection or scanner controls', async ({ page }, info) => {
  await checkArtworkViews(page, name => info.outputPath(name));
});

test('@mobile artwork marks stay readable across farm, rotations and reduced-motion scanner views', async ({ page }, info) => {
  await checkArtworkViews(page, name => info.outputPath(name));
});

test('the standalone satellite carries a visible generation mark', async ({ page }, info) => {
  await loadFixture(page, false);
  await checkMark(page, '.of-satellite-figure');
  await page.locator('.empty-state').screenshot({ path: info.outputPath('artwork-standalone-satellite.png'), animations: 'disabled' });
});
