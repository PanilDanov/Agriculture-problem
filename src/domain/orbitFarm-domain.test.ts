import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Polygon } from 'geojson';
import {
  CROP_CATALOG, DEMO_BOUNDARY, PROVIDER_SETTINGS_KEY, STORAGE_KEY, addDemoDay, addFarmDays,
  buildAnalysisRequest, createApiProvider, createMockProvider, createScenarioState,
  farmReducer, getDueTasks, getEstimatedHarvestDate, getFarmDate, getGrowthStage, getLastWatering,
  loadFarm, loadProviderSettings, makeMockAnalysis, saveFarm, saveProviderSettings,
  validateAnalysisRequest, validateAnalysisResult, validateBoundary,
} from './orbitFarm-domain';
import type { StorageLike } from './orbitFarm-types';

const REQUEST_ID = '48c381f4-aa97-4163-9c81-1c0924462878';
const NEW_REQUEST_ID = '6fbe9921-d05b-4ba0-95d5-b4fa20ea6784';
const request = () => buildAnalysisRequest(createScenarioState('dry-week'), REQUEST_ID);
const polygon = (points: number[][]): Polygon => ({ type: 'Polygon', coordinates: [points] });

describe('geographic field validation', () => {
  it('calculates the demonstration field in hectares rather than map pixels', () => {
    const result = validateBoundary(DEMO_BOUNDARY);
    expect(result.valid).toBe(true);
    expect(result.areaHa).toBeGreaterThan(4.8);
    expect(result.areaHa).toBeLessThan(5.2);
  });
  it('rejects crossing edges even when the polygon encloses a nonzero signed area', () => {
    const result = validateBoundary(polygon([[0, 0], [3, 3], [0, 3], [2, 0], [0, 0]]));
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/crosses itself/);
  });
  it('rejects open rings, zero-area fields, invalid coordinates, and unsupported holes', () => {
    expect(validateBoundary(polygon([[0, 0], [1, 0], [0, 1]])).valid).toBe(false);
    expect(validateBoundary(polygon([[0, 0], [1, 0], [2, 0], [0, 0]])).valid).toBe(false);
    expect(validateBoundary(polygon([[34, 95], [35, 95], [35, 96], [34, 95]])).valid).toBe(false);
    expect(validateBoundary({ ...DEMO_BOUNDARY, coordinates: [...DEMO_BOUNDARY.coordinates, DEMO_BOUNDARY.coordinates[0]] }).valid).toBe(false);
  });
});

describe('request and response meaning', () => {
  it('preserves unknown soil values and a known zero allocation', () => {
    const state = createScenarioState('dry-week');
    state.inputs.soil.ph = null;
    state.inputs.soil.texture = null;
    state.inputs.irrigation.volumeM3 = 0;
    const result = buildAnalysisRequest(state, REQUEST_ID);
    expect(result.localInputs.soil.ph).toBeNull();
    expect(result.localInputs.soil.texture).toBeNull();
    expect(result.localInputs.irrigation.waterBudget?.volumeM3).toBe(0);
  });
  it('keeps an unknown allocation as a null budget object', () => {
    const state = createScenarioState('dry-week');
    state.inputs.irrigation.volumeM3 = null;
    expect(buildAnalysisRequest(state, REQUEST_ID).localInputs.irrigation.waterBudget).toBeNull();
  });
  it('leaves the planting calendar and planning period to the analysis service', () => {
    const payload = request();
    expect(payload).not.toHaveProperty('season');
    expect(payload).not.toHaveProperty('farmTimeZone');
    expect(createScenarioState().inputs).not.toHaveProperty('season');
    expect(payload.localInputs.irrigation.waterBudget).toEqual({ volumeM3: 10000, basis: 'field_inlet' });
    expect(() => validateAnalysisRequest({ ...payload, season: { plantingDate: '2026-11-20', endDate: '2027-04-30' } })).toThrow();
    expect(() => validateAnalysisRequest({ ...payload, farmTimeZone: 'Asia/Jerusalem' })).toThrow();
    const datedBudget = structuredClone(payload);
    Object.assign(datedBudget.localInputs.irrigation.waterBudget!, { periodStartDate: '2026-11-20', periodEndDate: '2027-04-30' });
    expect(() => validateAnalysisRequest(datedBudget)).toThrow();
  });
  it('validates soil sampling dates as calendar dates without times or offsets', () => {
    for (const sampledOn of ['11-20', '2026-02-30', '2026-11-20T00:00:00Z']) {
      const payload = request();
      payload.localInputs.soil.sampledOn = sampledOn;
      expect(() => validateAnalysisRequest(payload)).toThrow(/date/i);
    }
    const payload = request();
    payload.localInputs.soil.sampledOn = '2028-02-29';
    expect(validateAnalysisRequest(payload).localInputs.soil.sampledOn).toBe('2028-02-29');
  });
  it('rejects contradictory irrigation access', () => {
    const noAccess = request();
    noAccess.localInputs.irrigation.availability = 'none';
    expect(() => validateAnalysisRequest(noAccess)).toThrow(/No irrigation access/);
  });
  it('does not accept browser-supplied weights or weather as authoritative data', () => {
    expect(() => validateAnalysisRequest({ ...request(), weights: { water: 1 } })).toThrow();
    expect(() => validateAnalysisRequest({ ...request(), temperature: 25 })).toThrow();
  });
  it('rejects incorrect units, absent provenance, and fabricated NASA origin', () => {
    const response = makeMockAnalysis(request(), 'dry-week');
    const wrongUnit = structuredClone(response);
    wrongUnit.signals[0].unit = 'mm';
    expect(() => validateAnalysisResult(wrongUnit)).toThrow(/unit/);
    const noSource = structuredClone(response);
    noSource.signals[0].source.dataset = '';
    expect(() => validateAnalysisResult(noSource)).toThrow();
    const falseNasa = structuredClone(response);
    falseNasa.signals[0].origin = 'nasa';
    expect(() => validateAnalysisResult(falseNasa)).toThrow();
  });
  it('withholds full scores when observations are missing, outdated, or soil inputs are unknown', () => {
    for (const scenario of ['missing-data', 'stale-data'] as const) {
      const response = makeMockAnalysis(request(), scenario);
      expect(response.cropOptions.every(c => c.score === null && c.scoreStatus === 'insufficient_data')).toBe(true);
    }
    const unknownSoil = request(); unknownSoil.localInputs.soil.ph = null;
    expect(makeMockAnalysis(unknownSoil, 'normal').cropOptions.every(c => c.score === null)).toBe(true);
  });
  it('does not silently reclassify an outdated response as a complete result', () => {
    const response = makeMockAnalysis(request(), 'stale-data');
    response.cropOptions[0] = { ...response.cropOptions[0], score: 90, scoreStatus: 'complete' };
    expect(() => validateAnalysisResult(response)).toThrow(/outdated/);
  });
  it('always identifies a generated baseline as an example', () => {
    const response = makeMockAnalysis(request(), 'normal');
    expect(response.rotationPlans).toHaveLength(3);
    expect(response.rotationPlans[0]).toMatchObject({ baselineOrigin: 'example', name: 'Example current plan' });
    expect(response.rotationPlans.every(p => p.sequence.length === 2)).toBe(true);
  });
  it('orders an entered plan by season index rather than transport array order', () => {
    const payload = request();
    payload.localInputs.currentPlan = [{ seasonIndex: 2, cropId: 'wheat' }, { seasonIndex: 1, cropId: 'chickpea' }];
    expect(makeMockAnalysis(payload, 'normal').rotationPlans[0]).toMatchObject({ sequence: ['chickpea', 'wheat'], baselineOrigin: 'farmer' });
  });
  it('validates backend dates for each season and keeps provisional dates nullable', () => {
    const response = makeMockAnalysis(request(), 'normal');
    response.rotationPlans[1] = {
      ...response.rotationPlans[1], planStatus: 'provisional', waterScreenMm: null,
      seasons: [
        { cropId: 'sorghum', recommendedPlantingDate: '2027-05-16', calendarHarvestDate: '2027-09-30', calendarSource: 'sacks-crop-calendar', calendarScope: 'sampled_grid_cell' },
        { cropId: 'chickpea', recommendedPlantingDate: null, calendarHarvestDate: null, calendarSource: null, calendarScope: null },
      ],
    };
    expect(validateAnalysisResult(response).rotationPlans[1].seasons?.[1].recommendedPlantingDate).toBeNull();
    const second = response.rotationPlans[1].seasons?.[1];
    if (!second) throw new Error('Missing test season');
    second.recommendedPlantingDate = '2027-09-25';
    expect(() => validateAnalysisResult(response)).toThrow(/after the first harvest/);
    second.recommendedPlantingDate = '2027-10-08';
    second.cropId = 'wheat';
    expect(() => validateAnalysisResult(response)).toThrow(/match the rotation sequence/);
  });
  it('preserves server planting recommendations as calendar dates and accepts absent recommendations', () => {
    const response = makeMockAnalysis(request(), 'normal');
    response.cropOptions[0].recommendedPlantingDate = '2028-02-29';
    expect(validateAnalysisResult(response).cropOptions[0].recommendedPlantingDate).toBe('2028-02-29');
    for (const invalidDate of ['2026-02-30', '11-20', '2026-11-20T00:00:00Z', '2026-11-20T23:00:00-07:00']) {
      response.cropOptions[0].recommendedPlantingDate = invalidDate;
      expect(() => validateAnalysisResult(response)).toThrow(/date/i);
    }
    response.cropOptions[0].recommendedPlantingDate = null;
    expect(validateAnalysisResult(response).cropOptions[0].recommendedPlantingDate).toBeNull();
    delete response.cropOptions[0].recommendedPlantingDate;
    expect(validateAnalysisResult(response).cropOptions[0]).not.toHaveProperty('recommendedPlantingDate');
  });
  it('accepts documented additional response metadata while still validating used fields', () => {
    const response = { ...makeMockAnalysis(request(), 'normal'), modelVersion: 'backend-v1', planningPeriod: { startDate: '2026-11-20', endDate: '2027-04-30' }, missingFields: [] };
    expect(validateAnalysisResult(response)).toMatchObject({ modelVersion: 'backend-v1' });
    const invalid = structuredClone(response); invalid.signals[0].unit = 'mm';
    expect(() => validateAnalysisResult(invalid)).toThrow(/unit/);
  });
});

describe('farm state transitions', () => {
  it('ignores results for an older request or changed field boundary', () => {
    const original = createScenarioState('dry-week');
    let state = farmReducer(original, { type: 'analysis_started', requestId: NEW_REQUEST_ID });
    const old = makeMockAnalysis(buildAnalysisRequest(original, REQUEST_ID), 'normal');
    expect(farmReducer(state, { type: 'analysis_received', analysis: old })).toBe(state);
    state = farmReducer(state, { type: 'set_boundary', boundary: DEMO_BOUNDARY });
    expect(state.boundaryVersion).toBe(original.boundaryVersion + 1);
    expect(state.analysis).toBeNull();
    const pendingOldBoundary = { ...old, requestId: NEW_REQUEST_ID };
    expect(farmReducer(state, { type: 'analysis_received', analysis: pendingOldBoundary })).toBe(state);
  });
  it('accepts a response only for the pending request and current field version', () => {
    const original = createScenarioState('dry-week');
    const response = makeMockAnalysis(buildAnalysisRequest(original, REQUEST_ID), 'normal');
    const state = farmReducer(original, { type: 'analysis_started', requestId: REQUEST_ID });
    const received = farmReducer(state, { type: 'analysis_received', analysis: response });
    expect(received.analysis).toEqual(response);
    expect(received.pendingRequestId).toBeNull();
  });
  it('prevents occupied or out-of-bounds slots and impossible planting dates', () => {
    const state = createScenarioState('dry-week');
    expect(farmReducer(state, { type: 'plant', slotId: 0, cropId: 'wheat', plantedOn: '2026-11-14' })).toBe(state);
    expect(farmReducer(state, { type: 'plant', slotId: 6, cropId: 'wheat', plantedOn: '2026-11-14' })).toBe(state);
    expect(farmReducer(state, { type: 'plant', slotId: 2, cropId: 'wheat', plantedOn: '2026-02-30' })).toBe(state);
    const planted = farmReducer(state, { type: 'plant', slotId: 2, cropId: 'wheat', plantedOn: '2026-11-14' });
    expect(planted.plots).toHaveLength(4);
    expect(planted.tasks).toHaveLength(4);
  });
  it('completes a task once without changing measured moisture and can Undo it', () => {
    const state = createScenarioState('dry-week');
    const taskId = getDueTasks(state)[0].id;
    const done = farmReducer(state, { type: 'complete_task', taskId });
    expect(done.journal).toHaveLength(1);
    expect(done.analysis).toBe(state.analysis);
    expect(farmReducer(done, { type: 'complete_task', taskId })).toBe(done);
    expect(getDueTasks(done).some(t => t.id === taskId)).toBe(false);
    const undone = farmReducer(done, { type: 'undo_action', entryId: done.journal[0].id });
    expect(getDueTasks(undone).some(t => t.id === taskId)).toBe(true);
    expect(undone.journal[0].undone).toBe(true);
    expect(farmReducer(undone, { type: 'undo_action', entryId: done.journal[0].id })).toBe(undone);
  });
  it('marks a task due on its calendar date', () => {
    const state = createScenarioState('dry-week');
    expect(getDueTasks({ ...state, demoToday: '2026-11-13' })).toHaveLength(0);
    expect(getDueTasks({ ...state, demoToday: '2026-11-14' })).toHaveLength(1);
  });
  it('keeps reminders hidden until their snooze date and preserves a skipped action across days', () => {
    const state = createScenarioState('dry-week');
    const taskId = getDueTasks(state)[0].id;
    const snoozed = farmReducer(state, { type: 'snooze_task', taskId });
    expect(getDueTasks({ ...snoozed, demoToday: '2026-11-14' }).some(t => t.id === taskId)).toBe(false);
    expect(getDueTasks(farmReducer(snoozed, { type: 'advance_day' })).some(t => t.id === taskId)).toBe(true);
    const skipped = farmReducer(state, { type: 'skip_task', taskId });
    expect(getDueTasks(farmReducer(skipped, { type: 'advance_day' })).some(t => t.id === taskId)).toBe(false);
  });
  it('does not let Undo of an older action overwrite a newer reminder', () => {
    let state = createScenarioState('dry-week');
    const taskId = getDueTasks(state)[0].id;
    state = farmReducer(state, { type: 'snooze_task', taskId });
    state = farmReducer(state, { type: 'advance_day' });
    state = farmReducer(state, { type: 'complete_task', taskId });
    expect(farmReducer(state, { type: 'undo_action', entryId: state.journal[0].id })).toBe(state);
  });
  it('does not claim to restore a task after its planting area was removed', () => {
    let state = createScenarioState('dry-week');
    const task = getDueTasks(state)[0];
    state = farmReducer(state, { type: 'complete_task', taskId: task.id });
    const entryId = state.journal[0].id;
    state = farmReducer(state, { type: 'remove_plot', plotId: task.plotId });
    expect(farmReducer(state, { type: 'undo_action', entryId })).toBe(state);
    expect(state.journal[0].undone).toBe(false);
  });
  it('records confirmed soil values as farmer-reported rather than synthetic fixtures', () => {
    const state = createScenarioState('dry-week');
    expect(buildAnalysisRequest(state, REQUEST_ID).localInputs.soil.source).toBe('synthetic');
    const inputs = structuredClone(state.inputs); inputs.soil.ph = 6.9;
    const edited = farmReducer(state, { type: 'set_inputs', inputs });
    expect(buildAnalysisRequest(edited, REQUEST_ID).localInputs.soil.source).toBe('farmer_reported');
  });
  it('preserves plantings, care history, and tasks when field information is edited', () => {
    const initial = createScenarioState('dry-week');
    const completed = farmReducer(initial, { type: 'complete_task', taskId: getDueTasks(initial)[0].id });
    const pending = farmReducer(completed, { type: 'analysis_started', requestId: REQUEST_ID });
    const inputs = structuredClone(pending.inputs);
    inputs.soil.ph = 6.9;
    inputs.irrigation.volumeM3 = 8000;
    const edited = farmReducer(pending, { type: 'set_inputs', inputs });
    expect(edited.plots).toEqual(completed.plots);
    expect(edited.tasks).toEqual(completed.tasks);
    expect(edited.journal).toEqual(completed.journal);
    expect(edited.analysis).toBeNull();
    expect(edited.pendingRequestId).toBeNull();
    const boundaryEdited = farmReducer(edited, { type: 'set_boundary', boundary: DEMO_BOUNDARY });
    expect(boundaryEdited.plots).toEqual(completed.plots);
    expect(boundaryEdited.journal).toEqual(completed.journal);
  });
  it('does not invent a regional dry spell for normal or missing-observation reminders', () => {
    expect(createScenarioState('normal').tasks[0].reason).not.toMatch(/dry spell/);
    expect(createScenarioState('missing-data').tasks[0].reason).not.toMatch(/dry spell/);
  });
  it('never brings an upcoming task forward when it is snoozed before its due date', () => {
    const state = createScenarioState('dry-week');
    const futureTask = state.tasks[2];
    const snoozed = farmReducer(state, { type: 'snooze_task', taskId: futureTask.id });
    expect(getDueTasks(farmReducer(snoozed, { type: 'advance_day' })).some(t => t.id === futureTask.id)).toBe(false);
  });
  it('advances calendar days without timezone or daylight-saving adjustments', () => {
    expect(getFarmDate('2026-10-24T23:30:00-07:00')).toBe('2026-10-24');
    expect(getFarmDate('2026-10-24T00:30:00+14:00')).toBe('2026-10-24');
    expect(getFarmDate('2026-10-24')).toBe('2026-10-24');
    expect(addDemoDay('2026-10-24')).toBe('2026-10-25');
    expect(addDemoDay('2026-10-25')).toBe('2026-10-26');
    expect(addDemoDay('2028-02-28')).toBe('2028-02-29');
    expect(addDemoDay('2028-02-29')).toBe('2028-03-01');
    expect(addDemoDay('2026-12-31')).toBe('2027-01-01');
  });
  it.each(CROP_CATALOG)('shows three stages by planting date for $name', ({ id, daysToGrowing, daysToHarvest }) => {
    const plot = { id: 'a', slotId: 0, cropId: id, plantedOn: '2026-11-20' };
    expect(getGrowthStage(plot, addFarmDays(plot.plantedOn, -1))).toBe('Planned');
    expect(getGrowthStage(plot, plot.plantedOn)).toBe('Seedling');
    expect(getGrowthStage(plot, addFarmDays(plot.plantedOn, daysToGrowing - 1))).toBe('Seedling');
    expect(getGrowthStage(plot, addFarmDays(plot.plantedOn, daysToGrowing))).toBe('Growing');
    expect(getGrowthStage(plot, addFarmDays(plot.plantedOn, daysToHarvest - 1))).toBe('Growing');
    expect(getEstimatedHarvestDate(plot)).toBe(addFarmDays(plot.plantedOn, daysToHarvest));
    expect(getGrowthStage(plot, getEstimatedHarvestDate(plot))).toBe('Ready to harvest');
  });
});

describe('persistent state', () => {
  function memoryStorage(): StorageLike {
    const values = new Map<string, string>();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  }
  it('persists manual watering on an active planting without adding a task', () => {
    const storage = memoryStorage();
    const initial = createScenarioState('dry-week');
    const plot = initial.plots[1];
    const action = { type: 'record_watering', plotId: plot.id } as const;
    const watered = farmReducer(initial, action);

    expect(watered.tasks).toBe(initial.tasks);
    expect(watered.journal[0]).toMatchObject({ taskId: null, plotId: plot.id, action: 'watered' });
    expect(farmReducer(watered, action)).toBe(watered);
    expect(saveFarm(watered, storage)).toBeNull();
    const restored = loadFarm(storage).state;
    expect(getLastWatering(restored, plot.id)).toBe(initial.demoToday);
    const undone = farmReducer(restored, { type: 'undo_action', entryId: restored.journal[0].id });
    expect(getLastWatering(undone, plot.id)).toBeUndefined();
  });
  it('round-trips the completed care state without resurrecting the task', () => {
    const storage = memoryStorage();
    const initial = createScenarioState('dry-week');
    const taskId = getDueTasks(initial)[0].id;
    const done = farmReducer(initial, { type: 'complete_task', taskId });
    expect(saveFarm(done, storage)).toBeNull();
    const loaded = loadFarm(storage);
    expect(loaded.error).toBeNull();
    expect(loaded.state.journal).toHaveLength(1);
    expect(getDueTasks(loaded.state).some(t => t.id === taskId)).toBe(false);
  });
  it('reports corrupted or unsupported saved data without overwriting it', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{broken');
    expect(loadFarm(storage).error).toMatch(/storage|damaged/i);
    expect(storage.getItem(STORAGE_KEY)).toBe('{broken');
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...createScenarioState(), version: 999 }));
    expect(loadFarm(storage).error).toMatch(/saved farm/);
  });
  it('reports quota/write failures rather than claiming a save succeeded', () => {
    const storage: StorageLike = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(saveFarm(createScenarioState(), storage)).toMatch(/could not be saved/);
  });
  it('rejects a saved Undo snapshot that would restore a hidden invalid reminder', () => {
    const storage = memoryStorage();
    const initial = createScenarioState('dry-week');
    const completed = farmReducer(initial, { type: 'complete_task', taskId: getDueTasks(initial)[0].id });
    completed.journal[0].previousStatus = 'snoozed';
    completed.journal[0].previousSnoozedUntil = null;
    storage.setItem(STORAGE_KEY, JSON.stringify(completed));
    expect(loadFarm(storage).error).toMatch(/saved farm/);
  });
  it('leaves the provider unselected when no saved settings exist', () => {
    expect(loadProviderSettings(memoryStorage())).toEqual({ settings: null, error: null });
  });
  it('restores the selected API and endpoint without altering saved farm data', () => {
    const storage = memoryStorage();
    const farm = createScenarioState('dry-week');
    expect(saveFarm(farm, storage)).toBeNull();
    const savedFarm = storage.getItem(STORAGE_KEY);
    const settings = { mode: 'api' as const, baseUrl: 'https://analysis.example.test/backend' };
    expect(saveProviderSettings(settings, storage)).toBeNull();
    expect(loadProviderSettings(storage)).toEqual({ settings, error: null });
    expect(storage.getItem(STORAGE_KEY)).toBe(savedFarm);
    expect(loadFarm(storage).state.farmId).toBe(farm.farmId);
  });
  it('supports a local HTTP analysis service for development', () => {
    const storage = memoryStorage();
    const settings = { mode: 'api' as const, baseUrl: 'http://localhost:8000' };
    expect(saveProviderSettings(settings, storage)).toBeNull();
    expect(loadProviderSettings(storage).settings).toEqual(settings);
  });
  it.each([
    'not a service URL', '/relative/service', 'ftp://analysis.example.test',
    'javascript:alert(1)', 'https://user:secret@analysis.example.test',
    'https://user@analysis.example.test', 'http://:8000',
  ])('rejects an invalid or credential-bearing provider URL: %s', (baseUrl) => {
    const storage = memoryStorage();
    const original = JSON.stringify({ mode: 'api', baseUrl: 'https://valid.example.test' });
    storage.setItem(PROVIDER_SETTINGS_KEY, original);
    expect(saveProviderSettings({ mode: 'api', baseUrl }, storage)).toMatch(/could not be saved/);
    expect(storage.getItem(PROVIDER_SETTINGS_KEY)).toBe(original);
    storage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify({ mode: 'api', baseUrl }));
    const loaded = loadProviderSettings(storage);
    expect(loaded.settings).toBeNull();
    expect(loaded.error).toMatch(/damaged or unsupported/);
  });
  it.each([
    '{broken', '',
    JSON.stringify({ mode: 'automatic', baseUrl: 'https://analysis.example.test' }),
    JSON.stringify({ mode: 'api', baseUrl: 'https://analysis.example.test', version: 99 }),
    JSON.stringify({ mode: 'mock' }),
  ])('reports corrupt or unsupported provider settings without selecting demo or overwriting data: %s', (saved) => {
    const storage = memoryStorage();
    storage.setItem(PROVIDER_SETTINGS_KEY, saved);
    const loaded = loadProviderSettings(storage);
    expect(loaded.settings).toBeNull();
    expect(loaded.error).toMatch(/demo mode has not been selected/);
    expect(storage.getItem(PROVIDER_SETTINGS_KEY)).toBe(saved);
  });
  it('returns a visible provider-settings error when browser storage reads are denied', () => {
    const storage: StorageLike = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => undefined };
    expect(loadProviderSettings(storage)).toEqual({ settings: null, error: expect.stringMatching(/could not be read/) });
  });
  it('returns a visible provider-settings error when browser storage writes are denied', () => {
    const storage: StorageLike = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(saveProviderSettings({ mode: 'api', baseUrl: 'https://analysis.example.test' }, storage)).toMatch(/could not be saved/);
  });
});

describe('analysis providers', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('returns deterministic observations for a fixture and refuses the unavailable fixture', async () => {
    const provider = createMockProvider('normal', { latencyMs: 0 });
    expect(await provider.analyze(request())).toEqual(await provider.analyze(request()));
    await expect(createMockProvider('api-unavailable', { latencyMs: 0 }).analyze(request())).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('posts the real request and never swaps a failed API for mock success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createApiProvider('https://api.example.test').analyze(request())).rejects.toMatchObject({ code: 'unavailable' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/v1/analysis');
    expect(JSON.parse(options.body)).toMatchObject({ requestId: REQUEST_ID, schemaVersion: '1.0' });
  });
  it('rejects mismatched response correlation identifiers', async () => {
    const response = makeMockAnalysis(request(), 'normal'); response.requestId = NEW_REQUEST_ID;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 })));
    await expect(createApiProvider('https://api.example.test').analyze(request())).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('distinguishes no coverage from a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'NO_COVERAGE' }), { status: 422 })));
    await expect(createApiProvider('https://api.example.test').analyze(request())).rejects.toMatchObject({ code: 'no_coverage' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(createApiProvider('https://api.example.test').analyze(request())).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('times out a pending API request and propagates cancellation', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string | URL | Request, options: RequestInit) => new Promise((_resolve, reject) => { options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))); })));
    const timeout = expect(createApiProvider('https://api.example.test', { timeoutMs: 50 }).analyze(request())).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(51); await timeout;
    const controller = new AbortController(); controller.abort();
    await expect(createMockProvider('normal').analyze(request(), controller.signal)).rejects.toMatchObject({ code: 'aborted' });
  });
});
