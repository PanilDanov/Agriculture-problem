import { expect, test as base, type Page } from '@playwright/test';
import { DEFAULT_INPUTS, DEMO_BOUNDARY, makeMockAnalysis } from '../src/domain/orbitFarm-fixtures';
import { buildAnalysisRequest, createScenarioState } from '../src/domain/orbitFarm-model';
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

  // Looking into the future must never turn a preview into a recorded harvest.
  await page.getByRole('slider', { name: 'Season preview' }).press('End');
  await expect(page.getByTestId('plot-slot-0')).toHaveAccessibleName(/Ready to harvest/);
  await expect(page.getByRole('button', { name: 'Harvest crop', exact: true })).toHaveCount(0);
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
