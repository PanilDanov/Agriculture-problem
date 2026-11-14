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
