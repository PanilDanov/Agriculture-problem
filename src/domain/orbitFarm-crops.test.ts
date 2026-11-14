import { describe, expect, it } from 'vitest';
import manifest from '../../brand/sprites/crops-v1/manifest.json';
import { CROP_CATALOG, CROP_IDS } from './orbitFarm-crop-catalog';
import { buildAnalysisRequest, createScenarioState, farmReducer } from './orbitFarm-model';
import { makeMockAnalysis } from './orbitFarm-fixtures';
import { loadFarm, saveFarm } from './orbitFarm-storage';
import { cropIdSchema, validateAnalysisRequest, validateAnalysisResult } from './orbitFarm-validation';
import type { CropId, StorageLike } from './orbitFarm-types';

const REQUEST_ID = '48c381f4-aa97-4163-9c81-1c0924462878';

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}

describe('the complete plantable crop catalog', () => {
  it('includes every crop in the artwork pack exactly once', () => {
    const artworkIds = [...new Set(manifest.sprites.map(sprite => sprite.cropId))].sort();
    expect(artworkIds).toHaveLength(10);
    expect([...CROP_IDS].sort()).toEqual(artworkIds);
    expect(CROP_CATALOG.map(crop => crop.id).sort()).toEqual(artworkIds);
    for (const crop of CROP_CATALOG) {
      expect(crop.name).toBe(manifest.sprites.find(sprite => sprite.cropId === crop.id)?.cropName);
      expect(cropIdSchema.safeParse(crop.id).success).toBe(true);
    }
  });

  it.each(CROP_CATALOG)('plants, edits, logs care, and restores $name without losing existing plots', crop => {
    const original = createScenarioState('dry-week');
    const planted = farmReducer(original, { type: 'plant', slotId: 2, cropId: crop.id, plantedOn: '2026-11-01' });
    const plot = planted.plots.find(item => item.slotId === 2)!;
    expect(plot).toMatchObject({ cropId: crop.id, plantedOn: '2026-11-01' });
    expect(planted.plots.filter(item => item.slotId !== 2)).toEqual(original.plots);

    const edited = farmReducer(planted, { type: 'edit_plot', plotId: original.plots[0].id, cropId: crop.id, plantedOn: '2026-11-02' });
    expect(edited.plots.find(item => item.id === original.plots[0].id)?.cropId).toBe(crop.id);
    const task = edited.tasks.find(item => item.plotId === plot.id)!;
    expect(task).toBeDefined();
    const completed = farmReducer(edited, { type: 'complete_task', taskId: task.id });
    expect(completed.tasks.find(item => item.id === task.id)?.status).toBe('done');
    expect(completed.journal.at(-1)).toMatchObject({ plotId: plot.id, action: 'watered' });

    const storage = memoryStorage();
    expect(saveFarm(completed, storage)).toBeNull();
    const restored = loadFarm(storage);
    expect(restored.error).toBeNull();
    expect(restored.state.plots).toEqual(completed.plots);
    expect(restored.state.tasks).toEqual(completed.tasks);
    expect(restored.state.journal).toEqual(completed.journal);
  });

  it('accepts all catalog IDs in history, submitted plans, and analysis responses', () => {
    for (const crop of CROP_CATALOG) {
      const state = createScenarioState('dry-week');
      state.inputs.previousCropId = crop.id;
      const request = buildAnalysisRequest(state, REQUEST_ID);
      request.localInputs.currentPlan = [{ seasonIndex: 1, cropId: crop.id }, { seasonIndex: 2, cropId: 'wheat' }];
      expect(validateAnalysisRequest(request).localInputs.previousCropId).toBe(crop.id);
      const response = makeMockAnalysis(request, 'normal');
      response.cropOptions = [{ cropId: crop.id, name: crop.name, score: null, scoreStatus: 'insufficient_data', reasons: ['Test response without a validated crop profile.'] }];
      response.rotationPlans[1].sequence = [crop.id, 'wheat'];
      expect(validateAnalysisResult(response).cropOptions[0].cropId).toBe(crop.id);
    }
  });

  it('keeps mock recommendations limited to the three existing synthetic profiles', () => {
    const request = buildAnalysisRequest(createScenarioState('dry-week'), REQUEST_ID);
    for (const scenario of ['normal', 'dry-week', 'missing-data', 'stale-data'] as const) {
      const result = makeMockAnalysis(request, scenario);
      expect(result.cropOptions.map(option => option.cropId).sort()).toEqual(['chickpea', 'sorghum', 'wheat']);
      expect(result.cropOptions.every(option => option.score === null || Number.isFinite(option.score))).toBe(true);
    }
  });

  it('continues rejecting unknown crop IDs rather than saving unsupported plantings', () => {
    const state = createScenarioState('dry-week');
    expect(cropIdSchema.safeParse('unknown-crop').success).toBe(false);
    expect(farmReducer(state, { type: 'plant', slotId: 2, cropId: 'unknown-crop' as CropId, plantedOn: '2026-11-01' })).toBe(state);
    const request = buildAnalysisRequest(state, REQUEST_ID);
    expect(() => validateAnalysisRequest({ ...request, localInputs: { ...request.localInputs, previousCropId: 'unknown-crop' } })).toThrow();
  });
});
