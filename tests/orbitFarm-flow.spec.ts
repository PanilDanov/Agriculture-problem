import { expect, test as base, type Page } from '@playwright/test';
import { makeMockAnalysis } from '../src/domain/orbitFarm-fixtures';
import type { AnalysisRequest } from '../src/domain/orbitFarm-types';

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await use(errors);
    expect(errors, 'The application must not throw browser runtime errors.').toEqual([]);
  }, { auto: true }],
});

test.beforeEach(async ({ page }) => {
  // Basemap availability must not determine whether the farm workflow works.
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, (route) => route.abort());
  page.on('dialog', (dialog) => dialog.accept());
});

async function visit(page: Page, route: string) {
  await page.goto(`/#/${route}`);
  await expect(page.getByRole('main')).toBeVisible();
}

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name, exact: true }).click();
}

test('create a farm, analyze, plant, log care, and preserve it after reload', async ({ page }, testInfo) => {
  await visit(page, 'farm');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('orbitFarm-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create farm', exact: true }).click();
  await page.getByLabel('Farm name', { exact: true }).fill('Sunrise Test Farm');
  await page.getByRole('button', { name: 'Use demo boundary', exact: true }).click();
  await expect(page.getByLabel('Planting date', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Season end', { exact: true })).toHaveCount(0);
  await page.getByLabel('Soil pH', { exact: true }).fill('7.5');
  await page.getByRole('combobox', { name: 'Soil texture', exact: true }).click();
  await page.getByRole('option', { name: 'sandy loam', exact: true }).click();
  await page.getByRole('combobox', { name: 'Irrigation access', exact: true }).click();
  await page.getByRole('option', { name: 'Available', exact: true }).click();
  await page.getByLabel('Water budget (m³)', { exact: true }).fill('10000');
  await page.getByRole('combobox', { name: 'Irrigation method', exact: true }).click();
  await page.getByRole('option', { name: 'Drip', exact: true }).click();
  await page.getByRole('combobox', { name: 'Main priority', exact: true }).click();
  await page.getByRole('option', { name: 'Save water', exact: true }).click();
  await page.getByRole('button', { name: 'Analyze my farm', exact: true }).click();

  await expect(page).toHaveURL(/#\/plans$/);
  await expect(page.getByRole('heading', { name: 'Rotation plans', exact: true })).toBeVisible();
  await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Example current plan', exact: true }) })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Improve soil plan' })).toBeVisible();
  await page.getByRole('article', { name: 'Save water plan' })
    .getByRole('button', { name: 'Use this plan', exact: true }).click();

  await expect(page).toHaveURL(/#\/farm$/);
  await expect(page.getByTestId('farm-name')).toContainText('Sunrise Test Farm');
  await page.getByTestId('plot-slot-3').click();
  await page.getByRole('combobox', { name: 'Crop', exact: true }).click();
  await page.getByRole('option', { name: 'Chickpea', exact: true }).click();
  await page.getByLabel('Planting date', { exact: true }).fill('2026-11-01');
  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  await expect(page.getByTestId('plot-slot-3')).toHaveAccessibleName(/Chickpea/);

  await page.getByTestId('selected-task').getByRole('button', { name: 'Watered', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Irrigation logged' })
    .getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Advance 1 day', exact: true }).click();
  const clockNotice = page.getByRole('status').filter({ hasText: 'Demo date advanced by one day.' });
  await expect(clockNotice).toBeVisible();
  await expect(clockNotice.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  await navigate(page, 'Journal');
  await expect(page.getByTestId('journal-entry').filter({ hasText: 'Irrigation logged' })).toHaveCount(1);
  await expect(page.getByTestId('journal-entry').filter({ hasText: 'Irrigation logged' })
    .getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('journal-entry').filter({ hasText: 'Irrigation logged' })).toHaveCount(1);
  await navigate(page, 'Your farm');
  await expect(page.getByTestId('farm-name')).toContainText('Sunrise Test Farm');
  await expect(page.getByTestId('plot-slot-3')).toHaveAccessibleName(/Chickpea/);

  await page.getByRole('button', { name: 'Edit field information', exact: true }).click();
  await expect(page.getByLabel('Farm name', { exact: true })).toHaveValue('Sunrise Test Farm');
  await page.getByLabel('Farm name', { exact: true }).fill('Sunrise Updated Farm');
  await page.getByRole('button', { name: 'Analyze my farm', exact: true }).click();
  await page.getByRole('article', { name: 'Save water plan' })
    .getByRole('button', { name: 'Use this plan', exact: true }).click();
  await expect(page.getByTestId('farm-name')).toContainText('Sunrise Updated Farm');
  await expect(page.getByTestId('plot-slot-3')).toHaveAccessibleName(/Chickpea/);
  await navigate(page, 'Journal');
  await expect(page.getByTestId('journal-entry').filter({ hasText: 'Irrigation logged' })).toHaveCount(1);
});

test('an unavailable analysis remains an error and offers retry', async ({ page }) => {
  await visit(page, 'lab');
  await page.getByRole('button', { name: 'Load api-unavailable', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  await page.getByRole('button', { name: 'Analyze field', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Analysis unavailable');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/plans$/);
  await expect(page.getByRole('article', { name: 'Save water plan' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Analysis unavailable');
});

test('an explicitly selected API and its URL survive reload without a mock fallback', async ({ page, baseURL }) => {
  const apiBaseUrl = `${baseURL}/integration-analysis`;
  await page.route('**/integration-analysis/v1/analysis', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'unavailable', message: 'The integration test service is unavailable.' }),
  }));
  await visit(page, 'lab');
  await page.getByLabel('API base URL', { exact: true }).fill(apiBaseUrl);
  await page.getByRole('button', { name: 'Use API', exact: true }).click();
  await expect(page.getByText('Active provider: Connected API', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Active provider: Connected API', { exact: true })).toBeVisible();
  await expect(page.getByLabel('API base URL', { exact: true })).toHaveValue(apiBaseUrl);
  await navigate(page, 'Your farm');
  const request = page.waitForRequest((candidate) => candidate.method() === 'POST'
    && candidate.url() === `${apiBaseUrl}/v1/analysis`);
  await page.getByRole('button', { name: 'Analyze field', exact: true }).click();
  const sent = await request;
  const payload = sent.postDataJSON();
  expect(payload).toMatchObject({ schemaVersion: '1.0', boundaryVersion: 1 });
  expect(payload).not.toHaveProperty('season');
  expect(payload).not.toHaveProperty('farmTimeZone');
  expect(payload.localInputs.irrigation.waterBudget).toEqual({ volumeM3: 10000, basis: 'field_inlet' });
  await expect(page.getByRole('alert')).toContainText('Analysis unavailable');
  await expect(page.getByRole('article', { name: 'Save water plan' })).toHaveCount(0);
});

test('a new farm can be analyzed without entering a planting calendar', async ({ page }) => {
  await visit(page, 'farm');
  await page.getByRole('button', { name: 'Create farm', exact: true }).click();
  await page.getByLabel('Farm name', { exact: true }).fill('Server Calendar Farm');
  await page.getByRole('button', { name: 'Use demo boundary', exact: true }).click();
  await expect(page.getByLabel('Planting date', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Season end', { exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Analyze my farm', exact: true }).click();
  await expect(page).toHaveURL(/#\/plans$/);
  await expect(page.getByRole('article', { name: 'Save water plan' })).toBeVisible();
  const farm = await page.evaluate(() => JSON.parse(localStorage.getItem('orbitFarm.farm.v1')!));
  expect(farm.name).toBe('Server Calendar Farm');
  expect(farm.inputs).not.toHaveProperty('season');
});

for (const timezoneId of ['Pacific/Honolulu', 'Pacific/Kiritimati']) {
  test.describe(`server planting dates in ${timezoneId}`, () => {
    test.use({ timezoneId });
    test('preserves the recommended day in results, planting inputs, and saved plantings', async ({ page, baseURL }) => {
      const apiBaseUrl = `${baseURL}/calendar-analysis`;
      await page.route('**/calendar-analysis/v1/analysis', async (route) => {
        const response = makeMockAnalysis(route.request().postDataJSON() as AnalysisRequest, 'normal');
        response.cropOptions.find(option => option.cropId === 'wheat')!.recommendedPlantingDate = '2028-02-29';
        response.cropOptions.find(option => option.cropId === 'chickpea')!.recommendedPlantingDate = '2028-03-01';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
      });
      await visit(page, 'lab');
      await page.getByLabel('API base URL', { exact: true }).fill(apiBaseUrl);
      await page.getByRole('button', { name: 'Use API', exact: true }).click();
      await navigate(page, 'Your farm');
      await page.getByRole('button', { name: 'Analyze field', exact: true }).click();
      await expect(page.locator('.crop-option').filter({ has: page.getByRole('heading', { name: 'Wheat', exact: true }) }))
        .toContainText('Recommended planting: Feb 29, 2028');
      await page.getByRole('article', { name: 'Save water plan' })
        .getByRole('button', { name: 'Use this plan', exact: true }).click();
      await page.getByTestId('plot-slot-3').click();
      await page.getByRole('combobox', { name: 'Crop', exact: true }).click();
      await page.getByRole('option', { name: 'Wheat', exact: true }).click();
      await expect(page.getByLabel('Planting date', { exact: true })).toHaveValue('2028-02-29');
      await page.getByRole('combobox', { name: 'Crop', exact: true }).click();
      await page.getByRole('option', { name: 'Chickpea', exact: true }).click();
      await expect(page.getByLabel('Planting date', { exact: true })).toHaveValue('2028-03-01');
      await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
      await expect(page.locator('.plot-summary')).toContainText('Mar 1, 2028');
      await page.reload();
      const farm = await page.evaluate(() => JSON.parse(localStorage.getItem('orbitFarm.farm.v1')!));
      expect(farm.plots.find((plot: { slotId: number }) => plot.slotId === 3).plantedOn).toBe('2028-03-01');
    });
  });
}

test('manual boundary entry rejects a self-crossing field even without map tiles', async ({ page }) => {
  await visit(page, 'farm');
  await page.getByRole('button', { name: 'Create farm', exact: true }).click();
  await page.getByText('Enter coordinates instead', { exact: true }).click();
  for (const [latitude, longitude] of [
    ['30.850', '34.790'],
    ['30.852', '34.792'],
    ['30.850', '34.792'],
    ['30.852', '34.790'],
  ]) {
    await page.getByLabel('Latitude', { exact: true }).fill(latitude);
    await page.getByLabel('Longitude', { exact: true }).fill(longitude);
    await page.getByRole('button', { name: 'Add point', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Finish boundary', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The boundary crosses itself.' }).first()).toBeVisible();
  await expect(page).toHaveURL(/#\/setup$/);
});

test('@mobile farm actions and navigation fit the viewport', async ({ page }, testInfo) => {
  await visit(page, 'farm');
  await expect(page.getByTestId('plot-slot-0')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create farm', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyze field', exact: true })).toBeVisible();
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
  }));
  expect(widths.content, 'Primary screens must not overflow horizontally.').toBeLessThanOrEqual(widths.viewport + 1);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: testInfo.outputPath('orbitFarm-mobile.png'), fullPage: true });
  await navigate(page, 'Tasks');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await navigate(page, 'Journal');
  await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible();
});
