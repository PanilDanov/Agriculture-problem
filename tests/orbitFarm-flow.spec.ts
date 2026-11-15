import { expect, test as base, type Page } from '@playwright/test';
import { makeMockAnalysis } from '../src/domain/orbitFarm-fixtures';
import type { AnalysisRequest } from '../src/domain/orbitFarm-types';
import { createScenarioState, daysBetweenFarmDates } from '../src/domain/orbitFarm-model';
import { STORAGE_KEY } from '../src/domain/orbitFarm-storage';

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

test('the season slider previews every growth stage on the same planting', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T12:00:00Z'));
  const farm = { ...createScenarioState(), demoToday: '2026-12-17' };
  await page.addInitScript(({ key, farm }) => localStorage.setItem(key, JSON.stringify(farm)), { key: STORAGE_KEY, farm });
  await visit(page, 'farm');
  const wheat = page.getByTestId('plot-slot-0');
  const artwork = wheat.locator('[data-crop-id="wheat"]').first();
  const card = page.getByTestId('plot-card');
  const slider = page.getByRole('slider', { name: 'Season preview' });
  const satellite = page.locator('.season-flight-satellite');
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(satellite).toBeVisible();
  await expect(artwork).toHaveAttribute('data-growth-stage', 'Seedling');
  await expect(artwork.locator('image')).toHaveAttribute('href', /wheat-seedling-v1\.png$/);

  const satelliteProgress = () => satellite.evaluate(element => {
    const sprite = element.getBoundingClientRect();
    const line = element.closest('.season-flight-line')!.getBoundingClientRect();
    return (sprite.left + sprite.width / 2 - line.left) / line.width;
  });

  await slider.press('Home');
  await expect.poll(satelliteProgress).toBeCloseTo(0);
  await expect(wheat).toHaveAccessibleName(/Wheat.*Planned/);
  await expect(artwork).toHaveCount(0);
  await expect(card).toContainText('Estimated stagePlanned');

  await slider.press('PageUp');
  await slider.press('PageUp');
  await expect(artwork).toHaveAttribute('data-growth-stage', 'Growing');
  await expect(artwork.locator('image')).toHaveAttribute('href', /wheat-growing-v1\.png$/);
  await expect(card).toContainText('Estimated stageGrowing');

  await slider.press('PageUp');
  await expect(artwork).toHaveAttribute('data-growth-stage', 'Growing');
  await expect(page.getByTestId('plot-slot-1')).toHaveAccessibleName('Plot B · Chickpea · Ready to harvest');

  await slider.press('End');
  await expect.poll(satelliteProgress).toBeCloseTo(1);
  await expect(artwork).toHaveAttribute('data-growth-stage', 'Ready to harvest');
  await expect(artwork.locator('image')).toHaveAttribute('href', /wheat-field-v2\.png$/);
  await expect(card.getByRole('button', { name: 'Watered', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Current day', exact: true }).click();
  await expect(slider).toHaveAttribute('aria-valuetext', 'Nov 14, 2026');
  await expect.poll(satelliteProgress).toBeLessThan(.1);
  await expect(artwork).toHaveAttribute('data-growth-stage', 'Seedling');
  await expect(card.getByRole('button', { name: 'Watered', exact: true })).toBeVisible();
});

test('the landscape blends across all four seasons in the demo year', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await visit(page, 'farm');
  const slider = page.getByRole('slider', { name: 'Season preview' });
  const landscape = page.locator('.of-season-terrain');
  const plants = landscape.locator('canvas[data-seasonal-plants]');
  const dateLabel = page.locator('.season-preview-heading time');
  const shortcuts = page.getByRole('group', { name: 'Season shortcuts' });
  await expect(landscape).toHaveAttribute('data-terrain-ready', 'true');
  expect(Number(await slider.getAttribute('max'))).toBeGreaterThanOrEqual(365);
  await expect(shortcuts.getByRole('button')).toHaveText(['Winter', 'Spring', 'Summer', 'Autumn']);

  async function seek(date: string) {
    await slider.evaluate((input, offset) => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, String(offset));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, daysBetweenFarmDates('2026-11-01', date));
    await expect(dateLabel).toHaveAttribute('datetime', date);
  }

  async function sampleOrchard() {
    return plants.evaluate(element => {
      const area = (element as HTMLCanvasElement).getContext('2d')!.getImageData(169, 15, 100, 47);
      const pixels = area.data;
      let apple = 0, olive = 0, translucent = 0, gap = 0, exposedTwigs = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (!pixels[i]) continue;
        const pixel = (i - 3) / 4;
        const x = 169 + pixel % area.width;
        const y = 15 + Math.floor(pixel / area.width);
        if (x < 214) apple++;
        else if (x >= 221) olive++;
        else gap++;
        const isTwig = (pixels[i - 3] === 89 && pixels[i - 2] === 67 && pixels[i - 1] === 42)
          || (pixels[i - 3] === 120 && pixels[i - 2] === 86 && pixels[i - 1] === 51);
        if (x < 214 && y < 48 && isTwig) exposedTwigs++;
        if (pixels[i] > 0 && pixels[i] < 255) translucent++;
      }

      // Trace the visible apple tree from its trunk through the branch and leaf pixels.
      const trunk = (area.height - 1) * area.width + 25;
      const connected = new Set([trunk]);
      const pending = [trunk];
      for (let index = 0; index < pending.length; index++) {
        const x = pending[index] % area.width;
        const y = Math.floor(pending[index] / area.width);
        for (let row = Math.max(0, y - 1); row <= Math.min(area.height - 1, y + 1); row++) {
          for (let col = Math.max(0, x - 1); col <= Math.min(44, x + 1); col++) {
            const pixel = row * area.width + col;
            if (!pixels[pixel * 4 + 3] || connected.has(pixel)) continue;
            connected.add(pixel);
            pending.push(pixel);
          }
        }
      }
      return { apple, olive, gap, translucent, exposedTwigs, attached: connected.size === apple };
    });
  }

  const lawnColors = new Set<string>();
  const shrubDetails = new Set<string>();
  const periods = [
    ['winter', '2027-01-15'], ['spring', '2027-04-15'],
    ['summer', '2027-07-15'], ['autumn', '2027-10-15'],
  ];
  for (const [season, date] of periods) {
    const marker = shortcuts.getByRole('button', { name: new RegExp('^' + season + ',', 'i') });
    await marker.click();
    await expect(dateLabel).toHaveAttribute('datetime', date);
    await expect(marker).toHaveAttribute('aria-current', 'date');
    const frame = landscape.locator(`canvas[data-season="${season}"]`);
    await expect(frame).toHaveCSS('opacity', '1');
    const pixel = await frame.evaluate(element =>
      Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(210, 138, 1, 1).data));
    expect(pixel[3]).toBe(255);
    lawnColors.add(pixel.join(','));
    shrubDetails.add(await plants.evaluate(element =>
      Array.from((element as HTMLCanvasElement).getContext('2d')!.getImageData(359, 100, 20, 15).data).join(',')));
  }
  expect(lawnColors.size).toBe(4);
  expect(shrubDetails.size).toBe(4);

  const winter = landscape.locator('canvas[data-season="winter"]');
  const matureOrchard = await sampleOrchard();
  await seek('2026-11-30');
  const lateAutumnOrchard = await sampleOrchard();
  await seek('2026-12-09');
  const earlyWinterOrchard = await sampleOrchard();
  await seek('2026-12-18');
  const lastLeaves = await sampleOrchard();
  await seek('2026-12-31');
  await expect(winter).toHaveCSS('opacity', '1');
  const bareOrchard = await sampleOrchard();
  expect(lateAutumnOrchard.apple).toBeLessThan(matureOrchard.apple);
  expect(earlyWinterOrchard.apple).toBeLessThan(lateAutumnOrchard.apple);
  expect(earlyWinterOrchard.apple).toBeGreaterThan(bareOrchard.apple);
  expect(matureOrchard.exposedTwigs).toBe(0);
  expect(bareOrchard.exposedTwigs).toBeGreaterThan(0);
  expect(bareOrchard.olive).toBeGreaterThan(500);
  for (const orchard of [matureOrchard, lateAutumnOrchard, earlyWinterOrchard, lastLeaves, bareOrchard]) {
    expect(orchard.olive).toBe(bareOrchard.olive);
    expect(orchard.gap).toBe(0);
    expect(orchard.translucent).toBe(0);
    expect(orchard.attached).toBe(true);
  }
  await seek('2027-01-01');
  await expect(winter).toHaveCSS('opacity', '1');
  await seek('2027-02-09');
  expect(await sampleOrchard()).toMatchObject({ attached: true, gap: 0, translucent: 0 });
  await seek('2027-03-20');
  expect(await sampleOrchard()).toMatchObject({ gap: 0, exposedTwigs: 0, translucent: 0 });
  const gapsInCrown = await plants.evaluate(element => {
    const width = 45;
    const height = 28;
    const pixels = (element as HTMLCanvasElement).getContext('2d')!.getImageData(169, 21, width, height).data;
    let gaps = 0;
    for (let row = 0; row < height; row++) {
      const alpha = [];
      for (let x = 0; x < width; x++) alpha.push(pixels[(row * width + x) * 4 + 3]);
      const first = alpha.indexOf(255);
      if (first >= 0) gaps += alpha.slice(first, alpha.lastIndexOf(255)).filter(value => value === 0).length;
    }
    return gaps;
  });
  expect(gapsInCrown).toBeLessThanOrEqual(2);
  await seek('2027-05-30');
  const midpoint = await landscape.locator('canvas[data-season]').evaluateAll(frames => Object.fromEntries(
    frames.map(frame => [frame.getAttribute('data-season')!, Number(getComputedStyle(frame).opacity)])));
  expect(midpoint.spring).toBeCloseTo(.5, 1);
  expect(midpoint.summer).toBeCloseTo(.5, 1);
  expect(Object.values(midpoint).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await shortcuts.getByRole('button', { name: 'Winter, Jan 15, 2027' }).click();
  await expect(dateLabel).toHaveAttribute('datetime', '2027-01-15');
  await expect(plants).toHaveCSS('opacity', '1');
  expect(await sampleOrchard()).toMatchObject({ gap: 0, translucent: 0 });
  await expect(winter).toHaveCSS('opacity', '1');
});

test('the bed card records watering with or without a reminder', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-14T12:00:00Z'));
  await visit(page, 'farm');
  const card = page.getByTestId('plot-card');
  const wheat = page.getByTestId('plot-slot-0');
  const chickpea = page.getByTestId('plot-slot-1');
  await expect(card.getByTestId('selected-task')).toContainText('Check soil moisture');
  await card.getByRole('button', { name: 'Watered', exact: true }).click();
  await expect(card).toContainText('Last wateredToday');
  await expect(wheat).toHaveAccessibleName('Plot A · Wheat · Seedling');
  await expect(page.getByTestId('farm-scene').locator('[data-care-kind]')).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(card.getByTestId('selected-task')).toBeVisible();
  await card.getByRole('button', { name: 'Remind me tomorrow', exact: true }).click();
  await expect(card.getByTestId('selected-task')).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'));
  await page.reload();
  await expect(card.getByTestId('selected-task')).toBeVisible();

  await chickpea.click();
  await expect(card.getByTestId('selected-task')).toHaveCount(0);
  await card.getByRole('button', { name: 'Watered', exact: true }).click();
  await expect(card).toContainText('Last wateredToday');
  await navigate(page, 'Journal');
  const manualEntry = page.getByTestId('journal-entry').filter({ hasText: /Plot B.*Chickpea/ });
  await expect(manualEntry).toContainText('Irrigation logged');
  await page.reload();
  await expect(manualEntry.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
});

test('the astronaut dog stays on its path and honors reduced motion', async ({ page }) => {
  const state = createScenarioState('dry-week');
  state.layout.beds = [{
    ...state.layout.beds[0],
    points: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 }, { x: 0, y: 12 }],
  }];
  state.plots = state.plots.slice(0, 1);
  state.tasks = state.tasks.filter(task => task.plotId === state.plots[0].id);
  await page.addInitScript(({ key, farm }) => localStorage.setItem(key, JSON.stringify(farm)), { key: STORAGE_KEY, farm: state });
  await page.clock.install();
  await visit(page, 'farm');

  const dog = page.getByTestId('farm-dog');
  await expect(dog.locator('image')).toHaveAttribute('href', /dog-astronaut-v1\.png$/);
  const positions = [];
  for (let sample = 0; sample < 24; sample++) {
    await page.clock.runFor(500);
    positions.push(await dog.evaluate(element => {
      const bed = document.querySelector('.of-bed-ground');
      const pose = element.querySelector('svg');
      if (!bed || !pose) throw new Error('The astronaut and field should render.');
      const box = pose.getBoundingClientRect();
      return {
        clearance: box.top - bed.getBoundingClientRect().bottom,
        left: box.left,
        action: element.getAttribute('data-dog-action'),
      };
    }));
  }
  expect(positions.every(position => position.clearance > 0)).toBe(true);
  expect(Math.max(...positions.map(position => position.left)) - Math.min(...positions.map(position => position.left))).toBeGreaterThan(60);
  expect(positions.some(position => position.action === 'sniff' || position.action === 'sit')).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(dog).toHaveAttribute('data-dog-action', 'stand');
  const stopped = await dog.getAttribute('transform');
  await page.clock.runFor(2000);
  await expect(dog).toHaveAttribute('transform', stopped!);
});

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
  const slider = page.getByRole('slider', { name: 'Season preview' });
  await expect(slider).toBeVisible();
  await expect(page.locator('.season-flight-satellite')).toBeVisible();
  await slider.press('End');
  await expect(page.getByRole('button', { name: 'Current day', exact: true })).toBeEnabled();
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
