import { expect, test as base, type Page } from '@playwright/test';
import { DEFAULT_INPUTS, DEMO_BOUNDARY, makeMockAnalysis } from '../src/domain/orbitFarm-fixtures';
import { buildAnalysisRequest, createScenarioState, daysBetweenFarmDates } from '../src/domain/orbitFarm-model';
import { STORAGE_KEY } from '../src/domain/orbitFarm-storage';

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'Planting and harvesting must not throw browser runtime errors.').toEqual([]);
  }, { auto: true }],
});

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.abort());
  page.on('dialog', dialog => dialog.accept());
});

async function openRotation(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
  const farm = {
    ...createScenarioState('empty-farm'),
    farmId: 'rotation-browser-farm',
    boundary: structuredClone(DEMO_BOUNDARY),
    inputs: structuredClone(DEFAULT_INPUTS),
  };
  farm.analysis = makeMockAnalysis(buildAnalysisRequest(farm, '5c865f8a-927e-482a-9345-717aab564913'), 'normal');
  const plan = farm.analysis.rotationPlans.find(item => item.planId === 'improve-soil')!;
  plan.seasons = [
    { cropId: 'chickpea', recommendedPlantingDate: '2026-11-01', calendarHarvestDate: '2026-11-15', calendarSource: 'Synthetic browser test calendar', calendarScope: 'test fixture' },
    { cropId: 'wheat', recommendedPlantingDate: '2026-11-20', calendarHarvestDate: '2027-02-01', calendarSource: 'Synthetic browser test calendar', calendarScope: 'test fixture' },
  ];
  await page.addInitScript(({ key, farm }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(farm));
  }, { key: STORAGE_KEY, farm });
  await page.goto('/#/plans');
  await page.getByRole('article', { name: 'Improve soil plan', exact: true })
    .getByRole('button', { name: 'Use this plan', exact: true }).click();
  await expect(page).toHaveURL(/#\/farm$/);
  await expect(page.getByTestId('rotation-guide')).toContainText('Improve soil');
  await expect(page.getByRole('combobox', { name: 'Crop', exact: true })).toContainText('Chickpea');
  await expect(page.getByLabel('Planting date', { exact: true })).toHaveValue('2026-11-01');
}

async function readFarm(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

async function advanceTo(page: Page, date: string) {
  await page.clock.setFixedTime(new Date(`${date}T12:00:00Z`));
  await page.reload();
  await expect(page.getByRole('main')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) }));
  expect(widths.content, 'Rotation guidance and actions must fit the viewport.').toBeLessThanOrEqual(widths.viewport + 1);
}

async function completeRotation(page: Page) {
  await openRotation(page);
  await expect(page.getByTestId('farm-scene').locator('[data-testid^="plot-slot-"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Whole field.*Chickpea.*Seedling/);
  await expect(page.getByRole('button', { name: 'Harvest crop', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('rotation-guide')).toContainText('Chickpea');
  await expectNoHorizontalOverflow(page);

  // Scrubbing alone never records a harvest; the dated action is explicit.
  await page.getByRole('slider', { name: 'Season preview' }).press('End');
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Ready to harvest/);
  await expect(page.getByRole('button', { name: 'Harvest crop', exact: true })).toBeVisible();
  expect((await readFarm(page)).harvests).toHaveLength(0);
  await page.getByRole('button', { name: 'Current day', exact: true }).click();
  await page.getByTestId('selected-task').getByRole('button', { name: 'Watered', exact: true }).click();

  await advanceTo(page, '2026-11-15');
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Whole field.*Chickpea.*Ready to harvest/);
  await page.getByRole('button', { name: 'Harvest crop', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Crop', exact: true })).toContainText('Wheat');
  await expect(page.getByLabel('Planting date', { exact: true })).toHaveValue('2026-11-20');
  const first = await readFarm(page);
  expect(first.harvests).toHaveLength(1);
  expect(first.harvests[0]).toMatchObject({ cropId: 'chickpea', harvestedOn: '2026-11-15', bedName: 'Whole field', rotation: { planId: 'improve-soil', seasonIndex: 0 } });
  expect(first.plots).toHaveLength(0);
  expect(first.tasks).toHaveLength(0);
  expect(first.journal.filter((entry: { action: string }) => entry.action === 'watered')).toHaveLength(1);

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Crop', exact: true })).toContainText('Wheat');
  await expect(page.getByLabel('Planting date', { exact: true })).toHaveValue('2026-11-20');
  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Whole field.*Wheat.*Planned/);
  const secondPlot = (await readFarm(page)).plots[0];
  expect(secondPlot.id).not.toBe(first.harvests[0].plotId);
  expect(secondPlot.rotation).toMatchObject({ planId: 'improve-soil', seasonIndex: 1 });

  await advanceTo(page, '2027-02-01');
  await page.getByRole('button', { name: 'Harvest crop', exact: true }).click();
  await expect(page.getByTestId('rotation-guide')).toContainText(/complete/i);
  const complete = await readFarm(page);
  expect(complete.harvests.map((harvest: { cropId: string }) => harvest.cropId)).toEqual(['chickpea', 'wheat']);
  expect(complete.plots).toHaveLength(0);
  expect(complete.tasks).toHaveLength(0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Journal', exact: true }).click();
  await expect(page.getByTestId('harvest-entry')).toHaveCount(2);
  await expect(page.getByTestId('journal-entry').filter({ hasText: 'Irrigation logged' })).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('harvest-entry')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
}

test('a selected rotation survives two harvests, replanting, and reloads without restarting', async ({ page }) => {
  await completeRotation(page);
});

test('@mobile the plan, harvest, and next planting remain usable through a complete rotation', async ({ page }) => {
  await completeRotation(page);
});

async function previewDate(page: Page, date: string) {
  const slider = page.getByRole('slider', { name: 'Season preview' });
  // The fixture's actual day and first planting are Nov 1; its range starts a day earlier.
  await slider.evaluate((element, offset) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(element, String(offset));
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, daysBetweenFarmDates('2026-10-31', date));
  await expect(page.locator('.season-preview-heading time')).toHaveAttribute('datetime', date);
}

async function completePreviewRotation(page: Page, screenshotPath: string) {
  await openRotation(page);
  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  await page.getByTestId('selected-task').getByRole('button', { name: 'Watered', exact: true }).click();

  await previewDate(page, '2026-11-15');
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Chickpea.*Ready to harvest/);
  await expect(page.getByRole('button', { name: 'Harvest crop', exact: true })).toBeVisible();
  await expect(page.getByLabel('Harvest date', { exact: true })).toHaveValue('2026-11-15');
  expect((await readFarm(page)).harvests).toHaveLength(0);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.getByRole('button', { name: 'Harvest crop', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Crop', exact: true })).toContainText('Wheat');
  await expect(page.getByLabel('Planting date', { exact: true })).toHaveValue('2026-11-20');
  await expect(page.getByTestId('rotation-guide')).toContainText('1/2 harvested');
  const first = await readFarm(page);
  expect(first.demoToday).toBe('2026-11-01');
  expect(first.harvests).toHaveLength(1);
  expect(first.harvests[0]).toMatchObject({ cropId: 'chickpea', harvestedOn: '2026-11-15', rotation: { seasonIndex: 0 } });

  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Wheat.*Planned/);
  const second = await readFarm(page);
  expect(second.plots[0]).toMatchObject({ cropId: 'wheat', plantedOn: '2026-11-20', rotation: { seasonIndex: 1 } });
  await page.getByRole('button', { name: 'Edit planting', exact: true }).click();
  await expect(page.getByLabel('Planting date', { exact: true })).toHaveValue('2026-11-20');
  await page.getByRole('button', { name: 'Save planting', exact: true }).click();
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Wheat.*Planned/);
  expect((await readFarm(page)).plots[0]).toMatchObject({ id: second.plots[0].id, cropId: 'wheat', plantedOn: '2026-11-20' });

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Tasks', exact: true }).click();
  const wheatTask = page.locator('.task-card').filter({ hasText: 'Wheat' });
  await expect(wheatTask).toHaveCount(1);
  await expect(wheatTask.locator('.task-plot')).toContainText('Whole field · Wheat');
  await expect(wheatTask).not.toContainText('Past planting');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Your farm', exact: true }).click();

  await previewDate(page, '2027-02-01');
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Wheat.*Ready to harvest/);
  await expect(page.getByLabel('Harvest date', { exact: true })).toHaveValue('2027-02-01');
  await page.getByRole('button', { name: 'Harvest crop', exact: true }).click();
  await expect(page.getByTestId('rotation-guide')).toContainText(/complete/i);
  await expect(page.getByRole('button', { name: 'Harvest crop', exact: true })).toHaveCount(0);
  const complete = await readFarm(page);
  expect(complete.demoToday).toBe('2026-11-01');
  expect(complete.harvests.map((harvest: { cropId: string; harvestedOn: string }) => [harvest.cropId, harvest.harvestedOn])).toEqual([
    ['chickpea', '2026-11-15'], ['wheat', '2027-02-01'],
  ]);
  expect(complete.plots).toHaveLength(0);

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Journal', exact: true }).click();
  await expect(page.getByTestId('harvest-entry')).toHaveCount(2);
  await expect(page.getByTestId('harvest-entry').filter({ hasText: /Planned harvest/i })).toHaveCount(2);
  await page.reload();
  await expect(page.getByTestId('harvest-entry')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Your farm', exact: true }).click();
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Chickpea.*Seedling/);
  await expect(page.getByRole('button', { name: 'Harvest crop', exact: true })).toHaveCount(0);
  await previewDate(page, '2027-02-01');
  await expect(page.getByTestId('rotation-guide')).toContainText(/complete/i);
  await expect(page.getByRole('button', { name: 'Harvest crop', exact: true })).toHaveCount(0);
  expect((await readFarm(page)).harvests).toHaveLength(2);
  await expectNoHorizontalOverflow(page);
}

test('future season dates support explicit harvests, replanting, and persistent planned history', async ({ page }, testInfo) => {
  await completePreviewRotation(page, testInfo.outputPath('dated-harvest-desktop.png'));
});

test('@mobile a ready crop can be harvested and replanted on the selected season date', async ({ page }, testInfo) => {
  await completePreviewRotation(page, testInfo.outputPath('dated-harvest-mobile.png'));
});

test('planting a different crop requires an explicit acknowledgement and does not advance the plan', async ({ page }) => {
  await openRotation(page);
  await page.getByRole('combobox', { name: 'Crop', exact: true }).click();
  await page.getByRole('option', { name: /^Barley/ }).click();
  const acknowledgement = page.getByRole('checkbox', { name: 'Plant outside the selected plan', exact: true });
  await expect(acknowledgement).toBeVisible();
  await page.getByLabel('Planting date', { exact: true }).fill('2026-11-01');
  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  expect((await readFarm(page)).plots).toHaveLength(0);
  await acknowledgement.check();
  await page.getByRole('button', { name: 'Plant crop', exact: true }).click();
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Barley/);
  const farm = await readFarm(page);
  expect(farm.selectedPlanId).toBe('improve-soil');
  expect(farm.plots[0]).not.toHaveProperty('rotation');
  expect(farm.harvests).toHaveLength(0);
  await expect(page.getByTestId('rotation-guide')).toContainText(/outside|off.plan/i);
});
