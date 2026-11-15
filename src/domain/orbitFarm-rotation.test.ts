import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEY, buildAnalysisRequest, createDefaultLayout, createScenarioState, farmReducer, getBedPlanProgress,
  getCareTasksAtDate, getDueTasks, getEstimatedHarvestDate, getGrowthStage, getLastWatering, getPlotsAtDate, getSelectedRotationPlan, loadFarm, makeMockAnalysis, saveFarm,
} from './orbitFarm-domain';
import type { FarmState, StorageLike } from './orbitFarm-types';

function preparedFarm(): FarmState {
  const state = createScenarioState('normal');
  state.plots = [];
  state.tasks = [];
  const plan = state.analysis!.rotationPlans.find(item => item.planId === 'improve-soil')!;
  plan.seasons = [
    { cropId: 'chickpea', recommendedPlantingDate: '2026-11-20', calendarHarvestDate: '2027-03-15', calendarSource: 'test-calendar', calendarScope: 'country' },
    { cropId: 'wheat', recommendedPlantingDate: '2027-10-01', calendarHarvestDate: '2028-04-20', calendarSource: 'test-calendar', calendarScope: 'country' },
  ];
  return farmReducer(state, { type: 'select_plan', planId: plan.planId });
}

function firstPlanting(state = preparedFarm(), slotId = 0) {
  return farmReducer(state, { type: 'plant', slotId, cropId: 'chickpea', plantedOn: '2026-11-20' });
}

function harvestFirst(state = firstPlanting(), slotId = 0) {
  return farmReducer({ ...state, demoToday: '2027-03-15' }, { type: 'harvest', plotId: state.plots.find(plot => plot.slotId === slotId)!.id });
}

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('selected rotation and harvest cycles', () => {
  it('uses plan calendar dates for aligned plantings and keeps a moved date an illustrative estimate', () => {
    const planted = firstPlanting();
    const plot = planted.plots[0];
    expect(plot.rotation).toMatchObject({ planId: 'improve-soil', planName: 'Improve soil', seasonIndex: 0 });
    expect(getEstimatedHarvestDate(plot)).toBe('2027-03-15');
    expect(getGrowthStage(plot, '2027-03-14')).toBe('Growing');
    expect(getGrowthStage(plot, '2027-03-15')).toBe('Ready to harvest');
    const edited = farmReducer(planted, { type: 'edit_plot', plotId: plot.id, cropId: 'chickpea', plantedOn: '2026-11-21' });
    expect(edited.plots[0].estimatedHarvestOn).toBeUndefined();
    expect(edited.plots[0].rotation?.seasonIndex).toBe(0);
  });

  it('frees the harvested bed, retains history and care records, and recommends its second crop', () => {
    let planted = firstPlanting();
    planted = farmReducer({ ...planted, demoToday: '2026-11-20' }, { type: 'complete_task', taskId: planted.tasks[0].id });
    const harvested = harvestFirst(planted);
    expect(harvested.plots).toHaveLength(0);
    expect(harvested.tasks).toHaveLength(0);
    expect(harvested.journal).toEqual(planted.journal);
    expect(harvested.analysis).toBe(planted.analysis);
    expect(harvested.harvests).toEqual([expect.objectContaining({ plotId: planted.plots[0].id, slotId: 0, cropId: 'chickpea', harvestedOn: '2027-03-15', plantedOn: '2026-11-20', bedName: 'Plot A' })]);
    expect(getBedPlanProgress(harvested, 0)).toMatchObject({ status: 'ready', completedSeasons: 1, seasonIndex: 1, nextCropId: 'wheat', recommendedPlantingDate: '2027-10-01' });
    expect(farmReducer(harvested, { type: 'harvest', plotId: planted.plots[0].id })).toBe(harvested);
    expect(farmReducer(harvested, { type: 'undo_action', entryId: harvested.journal[0].id })).toBe(harvested);
  });

  it('tracks harvest progress separately for each bed', () => {
    const planted = firstPlanting(firstPlanting(), 1);
    const harvested = harvestFirst(planted);
    expect(getBedPlanProgress(harvested, 0)).toMatchObject({ completedSeasons: 1, nextCropId: 'wheat', status: 'ready' });
    expect(getBedPlanProgress(harvested, 1)).toMatchObject({ completedSeasons: 0, nextCropId: 'chickpea', status: 'growing' });
    expect(getBedPlanProgress(harvested, 2)).toMatchObject({ completedSeasons: 0, nextCropId: 'chickpea', status: 'ready' });
  });

  it('finishes after two harvested crops without repeating the returned plan', () => {
    let state = harvestFirst();
    state = farmReducer(state, { type: 'plant', slotId: 0, cropId: 'wheat', plantedOn: '2027-10-01' });
    expect(state.plots[0].rotation?.seasonIndex).toBe(1);
    state = farmReducer({ ...state, demoToday: '2028-04-20' }, { type: 'harvest', plotId: state.plots[0].id });
    expect(getBedPlanProgress(state, 0)).toMatchObject({ status: 'complete', completedSeasons: 2, seasonIndex: null, nextCropId: null, recommendedPlantingDate: null });
    const plantedAgain = farmReducer(state, { type: 'plant', slotId: 0, cropId: 'chickpea', plantedOn: '2028-04-20' });
    expect(plantedAgain.plots[0].rotation).toBeUndefined();
  });

  it('rejects premature harvests and planting dates before the previous harvest', () => {
    const planted = firstPlanting();
    expect(farmReducer(planted, { type: 'harvest', plotId: planted.plots[0].id })).toBe(planted);
    const harvested = harvestFirst(planted);
    expect(farmReducer(harvested, { type: 'plant', slotId: 0, cropId: 'wheat', plantedOn: '2027-03-14' })).toBe(harvested);
    expect(farmReducer(harvested, { type: 'plant', slotId: 0, cropId: 'wheat', plantedOn: '2027-03-15' }).plots).toHaveLength(1);
  });

  it('keeps an off-plan crop visible without advancing the selected plan at harvest', () => {
    const selected = preparedFarm();
    const planted = farmReducer(selected, { type: 'plant', slotId: 0, cropId: 'barley', plantedOn: '2026-11-20' });
    expect(planted.plots[0].rotation).toBeUndefined();
    expect(getBedPlanProgress(planted, 0)).toMatchObject({ status: 'off-plan', nextCropId: 'chickpea', recommendedPlantingDate: '2026-11-20' });
    const harvested = farmReducer({ ...planted, demoToday: '2027-10-01' }, { type: 'harvest', plotId: planted.plots[0].id });
    expect(getBedPlanProgress(harvested, 0)).toMatchObject({ status: 'ready', completedSeasons: 0, nextCropId: 'chickpea' });
  });

  it('does not count removed or crop-edited plantings as harvested plan seasons', () => {
    const planted = firstPlanting();
    const removed = farmReducer(planted, { type: 'remove_plot', plotId: planted.plots[0].id });
    expect(getBedPlanProgress(removed, 0)?.completedSeasons).toBe(0);
    const edited = farmReducer(planted, { type: 'edit_plot', plotId: planted.plots[0].id, cropId: 'barley', plantedOn: '2026-11-20' });
    expect(edited.plots[0].rotation).toBeUndefined();
    expect(getBedPlanProgress(edited, 0)?.status).toBe('off-plan');
    const harvested = farmReducer({ ...edited, demoToday: '2027-10-01' }, { type: 'harvest', plotId: edited.plots[0].id });
    expect(getBedPlanProgress(harvested, 0)?.completedSeasons).toBe(0);
  });

  it('links an existing matching crop when choosing a plan and preserves each plan history when switching', () => {
    let state = createScenarioState('normal');
    state = farmReducer(state, { type: 'select_plan', planId: 'improve-soil' });
    expect(getBedPlanProgress(state, 1)).toMatchObject({ status: 'growing', nextCropId: 'chickpea' });
    expect(getBedPlanProgress(state, 0)).toMatchObject({ status: 'off-plan', nextCropId: 'chickpea' });
    let harvested = harvestFirst();
    harvested = farmReducer(harvested, { type: 'select_plan', planId: 'save-water' });
    expect(getBedPlanProgress(harvested, 0)).toMatchObject({ completedSeasons: 0, nextCropId: 'sorghum' });
    harvested = farmReducer(harvested, { type: 'select_plan', planId: 'improve-soil' });
    expect(getBedPlanProgress(harvested, 0)).toMatchObject({ completedSeasons: 1, nextCropId: 'wheat' });
  });

  it('clears selection on a fresh analysis and keeps the old planting and harvest snapshots', () => {
    let state = harvestFirst(firstPlanting(firstPlanting(), 1));
    const requestId = '92ba7b1d-0d6b-4f28-bde2-20ca7905c97b';
    const analysis = makeMockAnalysis(buildAnalysisRequest(state, requestId), 'normal');
    state = farmReducer(state, { type: 'analysis_started', requestId });
    state = farmReducer(state, { type: 'analysis_received', analysis });
    expect(getSelectedRotationPlan(state)).toBeNull();
    expect(state.plots[0].rotation?.planName).toBe('Improve soil');
    expect(state.harvests[0].rotation?.planName).toBe('Improve soil');
    state = farmReducer(state, { type: 'select_plan', planId: 'improve-soil' });
    expect(getBedPlanProgress(state, 0)?.completedSeasons).toBe(0);
  });

  it('uses whole-field harvest history for reanalysis without inventing another two-season plan', () => {
    const requestId = '92ba7b1d-0d6b-4f28-bde2-20ca7905c97b';
    const wholeField = farmReducer(preparedFarm(), { type: 'set_layout', layout: createDefaultLayout() });
    expect(buildAnalysisRequest(wholeField, requestId).localInputs.currentPlan).toEqual([
      { seasonIndex: 1, cropId: 'chickpea' }, { seasonIndex: 2, cropId: 'wheat' },
    ]);
    const harvested = harvestFirst(firstPlanting(wholeField));
    expect(harvested.inputs.previousCropId).toBe('chickpea');
    expect(harvested.inputs.currentPlan).toBeNull();
    expect(buildAnalysisRequest(harvested, requestId).localInputs).toMatchObject({ previousCropId: 'chickpea', currentPlan: null });
    expect(getBedPlanProgress(harvested, 0)).toMatchObject({ seasonIndex: 1, nextCropId: 'wheat' });
  });

  it('does not label one partial bed or one of several beds as the whole field previous crop', () => {
    const original = preparedFarm();
    original.inputs.previousCropId = 'maize';
    const harvested = harvestFirst(firstPlanting(original));
    expect(harvested.inputs.previousCropId).toBe('maize');
    const partial = farmReducer(original, { type: 'set_layout', layout: { ...original.layout, beds: [original.layout.beds[0]] } });
    const partialHarvest = harvestFirst(firstPlanting(partial));
    expect(partialHarvest.inputs.previousCropId).toBe('maize');
  });
});

describe('harvest persistence', () => {
  it('restores completed rotation steps, snapshots and unique replanting identities', () => {
    const storage = memoryStorage();
    const harvested = harvestFirst();
    expect(saveFarm(harvested, storage)).toBeNull();
    const loaded = loadFarm(storage);
    expect(loaded.error).toBeNull();
    expect(loaded.state).toEqual(harvested);
    expect(getBedPlanProgress(loaded.state, 0)?.seasonIndex).toBe(1);
    const replanted = farmReducer(loaded.state, { type: 'plant', slotId: 0, cropId: 'wheat', plantedOn: '2027-10-01' });
    expect(replanted.plots[0].id).not.toBe(harvested.harvests[0].plotId);
    expect(saveFarm(replanted, storage)).toBeNull();
  });

  it('loads pre-harvest version-three saves without losing custom layouts or plantings', () => {
    const storage = memoryStorage();
    const original = createScenarioState('normal');
    original.layout.beds[0].name = 'My preserved bed';
    const { harvests: _harvests, ...oldSave } = original;
    const saved = JSON.stringify(oldSave);
    storage.setItem(STORAGE_KEY, saved);
    expect(loadFarm(storage)).toEqual({ state: original, error: null });
    expect(storage.getItem(STORAGE_KEY)).toBe(saved);
  });

  it.each([false, true])('links matching old selected-plan crops while preserving off-plan crops and activity (harvests present: %s)', includesHarvests => {
    const storage = memoryStorage();
    let original = createScenarioState('normal');
    original = farmReducer(original, { type: 'complete_task', taskId: original.tasks[0].id });
    original.layout.beds[0].name = 'My preserved bed';
    original.selectedPlanId = 'current';
    const { harvests: _harvests, ...oldSave } = original;
    const saved = JSON.stringify(includesHarvests ? { ...oldSave, harvests: [] } : oldSave);
    storage.setItem(STORAGE_KEY, saved);

    const loaded = loadFarm(storage);
    expect(loaded.error).toBeNull();
    expect(loaded.state.layout).toEqual(original.layout);
    expect(loaded.state.tasks).toEqual(original.tasks);
    expect(loaded.state.journal).toEqual(original.journal);
    expect(loaded.state.inputs).toEqual(original.inputs);
    expect(loaded.state.analysis).toEqual(original.analysis);
    expect(loaded.state.plots.map(({ rotation: _rotation, ...plot }) => plot)).toEqual(original.plots);
    expect(loaded.state.plots[0].rotation).toMatchObject({ planId: 'current', seasonIndex: 0 });
    expect(loaded.state.plots[1].rotation).toBeUndefined();
    expect(getBedPlanProgress(loaded.state, 0)).toMatchObject({ status: 'growing', completedSeasons: 0 });
    expect(getBedPlanProgress(loaded.state, 1)?.status).toBe('off-plan');
    expect(storage.getItem(STORAGE_KEY)).toBe(saved);

    const mature = { ...loaded.state, demoToday: getEstimatedHarvestDate(loaded.state.plots[0]) };
    const harvested = farmReducer(mature, { type: 'harvest', plotId: mature.plots[0].id });
    expect(getBedPlanProgress(harvested, 0)).toMatchObject({ completedSeasons: 1, seasonIndex: 1, nextCropId: 'wheat' });
    expect(saveFarm(harvested, storage)).toBeNull();
    expect(getBedPlanProgress(loadFarm(storage).state, 0)?.completedSeasons).toBe(1);
  });

  it('preserves existing rotation and calendar snapshots when reconciling a missing plan link', () => {
    const storage = memoryStorage();
    const state = firstPlanting(firstPlanting(), 1);
    state.plots[0].estimatedHarvestOn = '2027-03-16';
    delete state.plots[1].rotation;
    expect(saveFarm(state, storage)).toBeNull();
    const loaded = loadFarm(storage);
    expect(loaded.error).toBeNull();
    expect(loaded.state.plots[0]).toEqual(state.plots[0]);
    expect(loaded.state.plots[1].rotation).toMatchObject({ planId: 'improve-soil', seasonIndex: 0 });
    expect(getBedPlanProgress(loaded.state, 0)?.status).toBe('growing');
    expect(getBedPlanProgress(loaded.state, 1)?.status).toBe('growing');
  });

  it('rejects duplicate or impossible harvest records without overwriting stored data', () => {
    const storage = memoryStorage();
    const state = harvestFirst();
    expect(saveFarm({ ...state, harvests: [...state.harvests, state.harvests[0]] }, storage)).toMatch(/invalid/);
    const damaged = { ...state, harvests: [{ ...state.harvests[0], harvestedOn: '2026-11-01' }] };
    const saved = JSON.stringify(damaged);
    storage.setItem(STORAGE_KEY, saved);
    expect(loadFarm(storage).error).toMatch(/saved farm/);
    expect(storage.getItem(STORAGE_KEY)).toBe(saved);
  });
});


describe('harvesting on a selected farm date', () => {
  it('records a future date without moving today, keeps crop history, and survives reload', () => {
    const planted = firstPlanting();
    const plot = planted.plots[0];
    const harvested = farmReducer(planted, { type: 'harvest', plotId: plot.id, harvestedOn: '2027-03-15' });
    expect(harvested.demoToday).toBe(planted.demoToday);
    expect(harvested.plots).toHaveLength(0);
    expect(harvested.harvests[0]).toMatchObject({ harvestedOn: '2027-03-15', estimatedHarvestOn: '2027-03-15', cropId: 'chickpea' });
    expect(getBedPlanProgress(harvested, 0)).toMatchObject({ completedSeasons: 1, nextCropId: 'wheat' });
    expect(getBedPlanProgress(harvested, 0, '2027-03-14')).toMatchObject({ completedSeasons: 0, status: 'growing' });
    expect(getBedPlanProgress(harvested, 0, '2027-03-15')).toMatchObject({ completedSeasons: 1, status: 'ready' });
    const storage = memoryStorage();
    expect(saveFarm(harvested, storage)).toBeNull();
    expect(loadFarm(storage)).toEqual({ state: harvested, error: null });
    expect(farmReducer(harvested, { type: 'harvest', plotId: plot.id, harvestedOn: '2027-03-15' })).toBe(harvested);
  });

  it.each(['2026-11-19', '2027-03-14', '2027-02-30', 'not-a-date'])('rejects an invalid or immature harvest date: %s', harvestedOn => {
    const planted = firstPlanting();
    expect(farmReducer(planted, { type: 'harvest', plotId: planted.plots[0].id, harvestedOn })).toBe(planted);
  });

  it('accepts a mature historical date independently of the current day', () => {
    const planted = { ...firstPlanting(), demoToday: '2027-04-01' };
    const harvested = farmReducer(planted, { type: 'harvest', plotId: planted.plots[0].id, harvestedOn: '2027-03-15' });
    expect(harvested.harvests[0].harvestedOn).toBe('2027-03-15');
    expect(harvested.tasks).toHaveLength(0);
  });

  it('reconstructs the earlier crop before harvest and the next planting afterwards', () => {
    const planted = firstPlanting();
    const original = planted.plots[0];
    let state = farmReducer(planted, { type: 'harvest', plotId: original.id, harvestedOn: '2027-03-15' });
    state = farmReducer(state, { type: 'plant', slotId: 0, cropId: 'wheat', plantedOn: '2027-10-01' });
    const next = state.plots[0];
    expect(getPlotsAtDate(state, '2026-11-19')).toEqual([original]);
    expect(getGrowthStage(getPlotsAtDate(state, '2026-11-19')[0], '2026-11-19')).toBe('Planned');
    expect(getPlotsAtDate(state, '2027-03-14')).toEqual([original]);
    expect(getPlotsAtDate(state, '2027-03-15')).toEqual([next]);
    expect(getGrowthStage(getPlotsAtDate(state, '2027-03-15')[0], '2027-03-15')).toBe('Planned');
    state = farmReducer(state, { type: 'harvest', plotId: next.id, harvestedOn: '2028-04-20' });
    expect(getPlotsAtDate(state, '2027-11-01')).toEqual([next]);
    expect(getPlotsAtDate(state, '2028-04-20')).toEqual([]);
    expect(getPlotsAtDate(state, '2026-11-19')).toEqual([original]);
    expect(getPlotsAtDate({ ...state, layout: { ...state.layout, beds: [] } }, '2027-03-14')).toEqual([]);
  });

  it('preserves current crop care until the selected harvest date, including watering and undo', () => {
    const planted = { ...firstPlanting(), demoToday: '2026-11-21' };
    const plot = planted.plots[0];
    let state = farmReducer(planted, { type: 'harvest', plotId: plot.id, harvestedOn: '2027-03-15' });
    expect(state.tasks).toEqual(planted.tasks);
    expect(getDueTasks(state)).toEqual(planted.tasks);
    state = farmReducer(state, { type: 'record_watering', plotId: plot.id });
    expect(getLastWatering(state, plot.id)).toBe('2026-11-21');
    state = farmReducer(state, { type: 'undo_action', entryId: state.journal[0].id });
    expect(getLastWatering(state, plot.id)).toBeUndefined();
    expect(getDueTasks(state)).toHaveLength(1);
    const storage = memoryStorage();
    expect(saveFarm(state, storage)).toBeNull();
    expect(loadFarm(storage).error).toBeNull();
    const afterHarvest = { ...state, demoToday: '2027-03-15' };
    expect(getCareTasksAtDate(afterHarvest)).toEqual([]);
    expect(getDueTasks(afterHarvest)).toEqual([]);
    expect(farmReducer(afterHarvest, { type: 'record_watering', plotId: plot.id })).toBe(afterHarvest);
    expect(farmReducer(afterHarvest, { type: 'complete_task', taskId: planted.tasks[0].id })).toBe(afterHarvest);
  });

  it('does not send a future planned harvest as the previous crop in a current field analysis', () => {
    const wholeField = farmReducer(preparedFarm(), { type: 'set_layout', layout: createDefaultLayout() });
    wholeField.inputs.previousCropId = 'maize';
    const planted = firstPlanting(wholeField);
    const harvested = farmReducer(planted, { type: 'harvest', plotId: planted.plots[0].id, harvestedOn: '2027-03-15' });
    expect(harvested.inputs.previousCropId).toBe('maize');
    const requestId = '92ba7b1d-0d6b-4f28-bde2-20ca7905c97b';
    expect(buildAnalysisRequest(harvested, requestId).localInputs).toMatchObject({ previousCropId: 'maize', currentPlan: [
      { seasonIndex: 1, cropId: 'chickpea' }, { seasonIndex: 2, cropId: 'wheat' },
    ] });
    expect(buildAnalysisRequest({ ...harvested, demoToday: '2027-03-15' }, requestId).localInputs).toMatchObject({ previousCropId: 'chickpea', currentPlan: null });
  });
});
