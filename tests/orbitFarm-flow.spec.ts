import { expect, test as base, type Page } from '@playwright/test';

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
  await page.getByLabel('Planting date', { exact: true }).fill('2026-11-01');
  await page.getByLabel('Season end', { exact: true }).fill('2027-04-30');
  await page.getByLabel('Soil pH', { exact: true }).fill('7.5');
  await page.getByRole('combobox', { name: 'Soil texture', exact: true }).selectOption('sandy_loam');
  await page.getByRole('combobox', { name: 'Irrigation access', exact: true }).selectOption('available');
  await page.getByLabel('Water budget (m³)', { exact: true }).fill('10000');
  await page.getByRole('combobox', { name: 'Irrigation method', exact: true }).selectOption('drip');
  await page.getByRole('combobox', { name: 'Main priority', exact: true }).selectOption('save_water');
  await page.getByRole('button', { name: 'Analyze my farm', exact: true }).click();

  await expect(page).toHaveURL(/#\/plans$/);
  await expect(page.getByRole('heading', { name: 'A good plan grows with you.', exact: true })).toBeVisible();
  await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Example current plan', exact: true }) })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Improve soil plan' })).toBeVisible();
  await page.getByRole('article', { name: 'Save water plan' })
    .getByRole('button', { name: 'Use this plan', exact: true }).click();

  await expect(page).toHaveURL(/#\/farm$/);
  await expect(page.getByTestId('farm-name')).toContainText('Sunrise Test Farm');
  await page.getByTestId('plot-slot-3').click();
  await page.getByRole('combobox', { name: 'Crop', exact: true }).selectOption('chickpea');
  await page.getByLabel('Planting date', { exact: true }).fill('2026-11-01');
  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  await expect(page.getByTestId('plot-slot-3')).toHaveAccessibleName(/Chickpea/);

  await page.getByTestId('selected-task').getByRole('button', { name: 'Watered', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Irrigation logged' })
    .getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Advance 1 day', exact: true }).click();
  const clockNotice = page.getByRole('status').filter({ hasText: 'Demo time advanced by one day.' });
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
  expect(sent.postDataJSON()).toMatchObject({ schemaVersion: '1.0', boundaryVersion: 1 });
  await expect(page.getByRole('alert')).toContainText('Analysis unavailable');
  await expect(page.getByRole('article', { name: 'Save water plan' })).toHaveCount(0);
});

test('a reversed season is rejected without losing the form', async ({ page }) => {
  await visit(page, 'farm');
  await page.getByRole('button', { name: 'Create farm', exact: true }).click();
  await page.getByLabel('Farm name', { exact: true }).fill('Invalid Date Farm');
  await page.getByRole('button', { name: 'Use demo boundary', exact: true }).click();
  await page.getByLabel('Planting date', { exact: true }).fill('2027-05-01');
  await page.getByLabel('Season end', { exact: true }).fill('2027-04-30');
  await page.getByRole('button', { name: 'Analyze my farm', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/season end|end date/i);
  await expect(page.getByLabel('Farm name', { exact: true })).toHaveValue('Invalid Date Farm');
  await expect(page).toHaveURL(/#\/setup$/);
});

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
  await expect(page.getByRole('heading', { name: 'Your farm tasks', exact: true })).toBeVisible();
  await navigate(page, 'Journal');
  await expect(page.getByRole('heading', { name: 'Your care journal', exact: true })).toBeVisible();
});
