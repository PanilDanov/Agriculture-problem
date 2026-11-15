import { expect, test as base, type Page } from '@playwright/test';
import { makeMockAnalysis } from '../src/domain/orbitFarm-fixtures';
import { createScenarioState } from '../src/domain/orbitFarm-model';
import { PROVIDER_SETTINGS_KEY, STORAGE_KEY } from '../src/domain/orbitFarm-storage';
import type { AnalysisRequest, AnalysisResult, CropId } from '../src/domain/orbitFarm-types';

// Contract fixtures exercise presentation and serialization; actual model inference
// and NASA calculations are checked by the Python integration suite.
const CROPS = [
  ['wheat', 'Wheat'], ['barley', 'Barley'], ['maize', 'Maize'], ['sorghum', 'Sorghum'],
  ['chickpea', 'Chickpea'], ['lentil', 'Lentil'], ['faba-bean', 'Faba bean'],
  ['sunflower', 'Sunflower'], ['potato', 'Potato'], ['tomato', 'Open-field tomato'],
] as const;

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'Analysis and evidence forms must not throw runtime errors.').toEqual([]);
  }, { auto: true }],
});

function responseFixture(request: AnalysisRequest, partial = false): AnalysisResult {
  const base = makeMockAnalysis(request, 'normal');
  const harvestYear = request.yieldForecast?.harvestYear ?? 2026;
  const nasa = { dataset: 'NASA POWER Daily', url: 'https://power.larc.nasa.gov/docs/services/api/temporal/daily/', version: 'browser-test' };
  return {
    ...base, dataMode: 'nasa-api', modelVersion: 'integrated-field-analysis-test',
    signals: base.signals.map(signal => ({ ...signal, origin: 'nasa', source: nasa })),
    cropOptions: CROPS.map(([cropId, name]) => ({ cropId, name, score: null, scoreStatus: 'insufficient_data',
      evaluationStatus: cropId === 'potato' ? 'excluded' : 'insufficient_data',
      componentScores: { temperature: 85, soilPh: cropId === 'potato' ? 0 : 100, water: null, soilTexture: 100 },
      knownWeight: .7, missingFields: ['water'], exclusionReasons: cropId === 'potato' ? ['Known soil pH is outside the crop reference range.'] : [],
      scoringModelVersion: 'crop-reference-screen-v1', recommendedPlantingDate: null,
      reasons: ['Historical NASA temperature and supplied soil evidence were evaluated.'] })),
    yieldForecasts: CROPS.map(([cropId], index) => partial && cropId === 'lentil'
      ? { cropId, status: 'unavailable', harvestYear, mode: 'annual_history', reason: 'No observed lentil yield history is available for this country.' }
      : { cropId, status: 'available', harvestYear, mode: partial && cropId === 'wheat' ? 'mid_season' : 'annual_history',
        forecast: { crop: cropId, mode: partial && cropId === 'wheat' ? 'mid_season' : 'annual_history',
          predicted_yield_t_ha: cropId === 'tomato' ? 52.4 : 2.5 + index / 2,
          spatial_level: partial && cropId === 'wheat' ? 'administrative_region' : 'country',
          model_version: `browser-test-${cropId}-v1`, country_code: 'FR', country_name: 'France', harvest_year: harvestYear, data_through: '2024',
          forecast_date: partial && cropId === 'wheat' ? '2026-04-14' : '2026-11-15', calculated_at: '2026-11-15T12:00:00Z',
          is_replay: partial && cropId === 'wheat', temporal_status: partial && cropId === 'wheat' ? 'retrospective_estimate' : 'current_forecast',
          target_product: cropId === 'tomato' ? 'Tomatoes' : cropId === 'faba-bean' ? 'Broad beans and horse beans, dry' : CROPS[index][1],
          prediction_interval_t_ha: null, quality_status: cropId === 'barley' ? 'experimental' : 'beats_last_yield_on_holdout',
          validation: { holdout_years: [2022, 2023, 2024], holdout: { mae_t_ha: .8, last_yield_baseline_mae_t_ha: cropId === 'barley' ? .7 : 1.1 } },
          source: { dataset: 'FAOSTAT QCL integration fixture', url: 'https://www.fao.org/faostat/en/#data/QCL', published_on: '2026-11-15' },
          warnings: ['The model is a national or regional estimate; field-level accuracy has not been validated.',
            ...(cropId === 'tomato' ? ['Tomato data combine production systems; the model is not specific to open-field tomato.'] : [])] } }),
    recentWeather: { status: partial ? 'partial' : 'available', periodStart: '2026-10-16', periodEnd: '2026-11-14',
      meanTemperatureC: 18.4, precipitationMm: 0, latestEt0MmDay: partial ? null : 4.1, observedOn: '2026-11-14', source: nasa.url },
    irrigationAssessment: request.localInputs.fieldObservations ? {
      status: 'ready', observedOn: request.localInputs.fieldObservations.observedOn,
      observationSource: request.localInputs.fieldObservations.source, thresholdReached: false,
      calculation: { etcStandardMmDay: 3.5, totalAvailableWaterMm: 45, readilyAvailableWaterMm: 25.2, rootZoneDepletionMm: 24 },
      netRefillM3: 24 * base.areaHa * 10, grossRefillM3: 30 * base.areaHa * 10,
      allocationContext: { canDeliverGrossRefill: true }, missingFields: [],
      limitations: ['A measured storage deficit is not an automatic watering instruction.'],
    } : { status: 'needs_observations', missingFields: ['fieldObservations'], calculation: null, netRefillM3: null, grossRefillM3: null },
    assumptions: ['The browser integration fixture preserves source and model metadata.'],
    limitations: ['National and regional estimates do not establish individual-field accuracy.'],
  };
}

async function setupApi(page: Page, baseURL: string, partial = false) {
  await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'));
  await page.route(/^https:\/\/(?:[abc]\.)?tile\.openstreetmap\.org\//, route => route.abort());
  const farm = createScenarioState('normal');
  farm.name = 'Analysis Integration Test Farm';
  farm.boundary = { type: 'Polygon', coordinates: [[[2, 48], [2.001, 48], [2.001, 48.001], [2, 48.001], [2, 48]]] };
  farm.analysis = null;
  await page.addInitScript(({ farm, baseURL, storageKey, providerKey }) => {
    localStorage.setItem(storageKey, JSON.stringify(farm));
    localStorage.setItem(providerKey, JSON.stringify({ mode: 'api', baseUrl: `${baseURL}/analysis-integration` }));
  }, { farm, baseURL, storageKey: STORAGE_KEY, providerKey: PROVIDER_SETTINGS_KEY });
  await page.route('**/analysis-integration/v1/analysis', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseFixture(route.request().postDataJSON() as AnalysisRequest, partial)) });
  });
  await page.goto('/#/farm');
  await expect(page.getByRole('main')).toBeVisible();
}

async function choose(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('listbox').getByRole('option', { name: option, exact: true }).click();
}

async function expectNoOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, content: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) }));
  expect(widths.content, 'Forecast cards, long source names and evidence fields must fit the viewport.').toBeLessThanOrEqual(widths.viewport + 1);
}

test('all ten yield forecasts retain their national scale, quality and source evidence', async ({ page, baseURL }, info) => {
  await setupApi(page, baseURL!);
  await page.getByRole('button', { name: 'Analyze field', exact: true }).click();
  await expect(page).toHaveURL(/#\/plans$/);
  await expect(page.getByRole('heading', { name: 'Yield forecasts', exact: true })).toBeVisible();
  await expect(page.locator('.of-yield-card')).toHaveCount(10);
  await expect(page.getByText('10 / 10 available', { exact: true })).toBeVisible();
  for (const [, name] of CROPS) await expect(page.getByRole('article', { name: `${name} yield forecast`, exact: true })).toContainText('National estimate');
  const wheat = page.getByRole('article', { name: 'Wheat yield forecast', exact: true });
  await wheat.getByText('Model & evidence', { exact: true }).click();
  await expect(wheat).toContainText('browser-test-wheat-v1');
  await expect(wheat).toContainText('2024');
  await expect(wheat).toContainText('Last-yield baseline MAE');
  await expect(wheat.getByRole('link', { name: 'FAOSTAT QCL integration fixture' })).toHaveAttribute('href', 'https://www.fao.org/faostat/en/#data/QCL');
  await expect(page.getByRole('article', { name: 'Barley yield forecast', exact: true })).toContainText('Experimental');
  await expect(page.getByRole('article', { name: 'Open-field tomato yield forecast', exact: true })).toContainText('data combine production systems');
  await expect(page.getByRole('heading', { name: 'Recent NASA conditions', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Field water assessment', exact: true })).toContainText('Add field measurements');
  await wheat.screenshot({ path: info.outputPath('orbitFarm-yield-evidence-desktop.png'), animations: 'disabled' });
  await wheat.getByText('Model & evidence', { exact: true }).click();
  await expectNoOverflow(page);
  await page.screenshot({ path: info.outputPath('orbitFarm-analysis-desktop.png'), fullPage: true, animations: 'disabled' });
});

test('advanced field evidence reaches the API with measured water, dates and both planned crops', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  await setupApi(page, baseURL!);
  await page.getByRole('button', { name: 'Edit field information', exact: true }).click();
  await page.getByText('Forecast settings & existing plan', { exact: true }).click();
  await choose(page, 'Forecast mode', 'Annual yield history · all crops');
  await page.getByLabel('Harvest year', { exact: true }).fill('2027');
  await page.getByRole('checkbox', { name: 'Compare my existing two-season plan' }).check();
  await choose(page, 'Existing plan · season 1', 'Wheat');
  await choose(page, 'Existing plan · season 2', 'Chickpea');
  await page.getByText('Water allocation & soil evidence', { exact: true }).click();
  await choose(page, 'Soil information source', 'Soil test');
  await page.getByLabel('Soil test / sample date', { exact: true }).fill('2026-11-14');
  await page.getByLabel('Application efficiency (%)', { exact: true }).fill('80');
  await page.getByLabel('Water allocation starts', { exact: true }).fill('2026-11-15');
  await page.getByLabel('Water allocation ends', { exact: true }).fill('2027-06-30');
  await page.getByText('Measured water needs & root zone', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Add field water observations' }).check();
  await page.getByLabel('Observation date', { exact: true }).fill('2026-11-15');
  await choose(page, 'Measured crop', 'Wheat');
  await page.getByLabel('Observation source', { exact: true }).fill('Field sensor, integration fixture');
  await choose(page, 'Measured growth stage', 'Initial stage');
  await choose(page, 'Crop / harvest variant', 'Common winter wheat, harvested at low grain moisture');
  await page.getByLabel('Reference evapotranspiration (mm/day)', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Add measured soil layer', exact: true }).click();
  await page.getByLabel('Layer thickness (m)', { exact: true }).fill('0.3');
  await page.getByLabel('Water content at field capacity', { exact: true }).fill('0.30');
  await page.getByLabel('Water content at wilting point', { exact: true }).fill('0.15');
  await page.getByLabel('Current measured water content', { exact: true }).fill('0.22');
  await page.getByText('Seasonal crop water balance', { exact: true }).click();
  await page.getByRole('button', { name: 'Add seasonal water assessment', exact: true }).click();
  await choose(page, 'Seasonal water crop', 'Wheat');
  await page.getByLabel('Season starts', { exact: true }).fill('2026-11-15');
  await page.getByLabel('Season ends', { exact: true }).fill('2027-06-30');
  await page.getByLabel('Net irrigation requirement (mm)', { exact: true }).fill('100');
  await page.getByLabel('Water balance source', { exact: true }).fill('Local water balance, integration fixture');
  await page.getByLabel('Water balance method', { exact: true }).fill('Measured effective rainfall and root-zone storage');
  await expectNoOverflow(page);
  await page.screenshot({ path: info.outputPath('orbitFarm-evidence-fields-desktop.png'), fullPage: true, animations: 'disabled' });
  const outgoing = page.waitForRequest(request => request.url().endsWith('/analysis-integration/v1/analysis') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Analyze my farm', exact: true }).click();
  const request = (await outgoing).postDataJSON() as AnalysisRequest;
  expect(request.yieldForecast).toEqual({ mode: 'annual_history', harvestYear: 2027 });
  expect(request.localInputs.currentPlan).toEqual([{ seasonIndex: 1, cropId: 'wheat' }, { seasonIndex: 2, cropId: 'chickpea' }]);
  expect(request.localInputs.irrigation.applicationEfficiency).toBe(.8);
  expect(request.localInputs.irrigation.waterBudget).toMatchObject({ periodStart: '2026-11-15', periodEnd: '2027-06-30' });
  expect(request.localInputs.soil).toMatchObject({ source: 'soil_test', sampledOn: '2026-11-14' });
  expect(request.localInputs.fieldObservations).toMatchObject({ observedOn: '2026-11-15', cropId: 'wheat', variant: 'common-winter-dry-grain', et0MmDay: 5,
    rootZoneLayers: [{ thicknessM: .3, thetaFc: .3, thetaWp: .15, thetaNow: .22 }] });
  expect(request.localInputs.seasonalWaterBalance).toEqual([{ cropId: 'wheat', periodStart: '2026-11-15', periodEnd: '2027-06-30', netIrrigationRequirementMm: 100,
    source: 'Local water balance, integration fixture', method: 'Measured effective rainfall and root-zone storage' }]);
  await expect(page.getByRole('region', { name: 'Field water assessment', exact: true })).toContainText('Measured water assessment');
  await expect(page.getByRole('region', { name: 'Field water assessment', exact: true })).toContainText('below the reference threshold');
});

test('seasonal planning water balance does not require daily measurements or a growth stage', async ({ page, baseURL }) => {
  await setupApi(page, baseURL!);
  await page.getByRole('button', { name: 'Edit field information', exact: true }).click();
  await page.getByText('Seasonal crop water balance', { exact: true }).click();
  await page.getByRole('button', { name: 'Add seasonal water assessment', exact: true }).click();
  await choose(page, 'Seasonal water crop', 'Wheat');
  await page.getByLabel('Season starts', { exact: true }).fill('2027-03-01');
  await page.getByLabel('Season ends', { exact: true }).fill('2027-08-01');
  await page.getByLabel('Net irrigation requirement (mm)', { exact: true }).fill('125');
  await page.getByLabel('Water balance source', { exact: true }).fill('Local seasonal planning assessment');
  await page.getByLabel('Water balance method', { exact: true }).fill('Effective rain and active-root storage');
  await expect(page.getByLabel('Observation date', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Measured growth stage', exact: true })).toHaveCount(0);
  const outgoing = page.waitForRequest(request => request.url().endsWith('/analysis-integration/v1/analysis') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Analyze my farm', exact: true }).click();
  const request = (await outgoing).postDataJSON() as AnalysisRequest;
  expect(request.localInputs).not.toHaveProperty('fieldObservations');
  expect(request.localInputs.seasonalWaterBalance).toEqual([{ cropId: 'wheat', periodStart: '2027-03-01', periodEnd: '2027-08-01', netIrrigationRequirementMm: 125,
    source: 'Local seasonal planning assessment', method: 'Effective rain and active-root storage' }]);
  await expect(page.getByRole('heading', { name: 'Yield forecasts', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Field water assessment', exact: true })).toContainText('Add field measurements');
});

test('@mobile ten forecasts show unavailable data and regional scale without horizontal overflow', async ({ page, baseURL }, info) => {
  await setupApi(page, baseURL!, true);
  await page.getByRole('button', { name: 'Analyze field', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Yield forecasts', exact: true })).toBeVisible();
  await expect(page.locator('.of-yield-card')).toHaveCount(10);
  await expect(page.getByText('9 / 10 available', { exact: true })).toBeVisible();
  const wheat = page.getByRole('article', { name: 'Wheat yield forecast', exact: true });
  await expect(wheat).toContainText('Regional estimate');
  await expect(wheat).toContainText('Mid-season');
  await expect(wheat).toContainText('Historical replay');
  await expect(wheat).toContainText('this estimate was not issued on that date');
  await wheat.getByText('Model & evidence', { exact: true }).click();
  await expect(wheat.locator('.of-analysis-dl')).toContainText('Forecast date14 Apr 2026');
  await expect(wheat.locator('.of-analysis-dl')).toContainText('Calculated at15 Nov 2026, 12:00:00 UTC');
  const lentil = page.getByRole('article', { name: 'Lentil yield forecast', exact: true });
  await expect(lentil).toContainText('No observed lentil yield history is available');
  await expect(lentil.locator('.of-yield-value')).toHaveCount(0);
  await expectNoOverflow(page);
  await page.screenshot({ path: info.outputPath('orbitFarm-analysis-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByText('Crop suitability evidence', { exact: true }).click();
  await expect(page.locator('.of-component-card').filter({ has: page.getByRole('heading', { name: 'Potato', exact: true }) })).toContainText('Outside a known reference constraint');
  await expectNoOverflow(page);
});

test('@mobile evidence controls preserve unknown measurements and remain usable on narrow screens', async ({ page, baseURL }, info) => {
  await setupApi(page, baseURL!);
  await page.getByRole('button', { name: 'Edit field information', exact: true }).click();
  await page.getByText('Measured water needs & root zone', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Add field water observations' }).check();
  await choose(page, 'Measured crop', 'Maize');
  await choose(page, 'Measured growth stage', 'Mid-season');
  await choose(page, 'Crop / harvest variant', 'Maize harvested at low grain moisture');
  await page.getByRole('button', { name: 'Add measured soil layer', exact: true }).click();
  await expect(page.getByLabel('Layer thickness (m)', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Current measured water content', { exact: true })).toHaveValue('');
  await expectNoOverflow(page);
  await page.screenshot({ path: info.outputPath('orbitFarm-evidence-fields-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Remove root-zone layer 1', exact: true }).click();
  await expect(page.getByText('Root-zone layer 1', { exact: true })).toHaveCount(0);
  await expectNoOverflow(page);
});
