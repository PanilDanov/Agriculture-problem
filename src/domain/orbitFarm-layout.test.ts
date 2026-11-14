import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEY, createDefaultLayout, createScenarioState, farmReducer, getBedName, getDueTasks,
  getPlotLabel, loadFarm, polygonsOverlap, saveFarm, validateBedPolygon, validateFarmLayout,
} from './orbitFarm-domain';
import type { FarmLayout, LayoutPoint, StorageLike } from './orbitFarm-types';

const points = (values: number[][]): LayoutPoint[] => values.map(([x, y]) => ({ x, y }));
const rectangle = (x: number, y: number, width: number, height: number) => points([[x, y], [x + width, y], [x + width, y + height], [x, y + height]]);
const layoutWith = (...polygons: LayoutPoint[][]): FarmLayout => ({ width: 24, height: 12, beds: polygons.map((polygon, slotId) => ({ slotId, name: getPlotLabel(slotId), points: polygon })) });
const memoryStorage = (): StorageLike => {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
};

describe('custom bed geometry', () => {
  it('keeps the default six-bed layout valid while allowing triangles and concave beds', () => {
    expect(validateFarmLayout(createDefaultLayout())).toEqual({ valid: true, errors: [] });
    expect(validateBedPolygon(points([[0, 0], [4, 0], [0, 4]]))).toMatchObject({ valid: true, area: 8 });
    const concave = points([[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]]);
    expect(validateBedPolygon(concave)).toMatchObject({ valid: true, area: 20 });
    expect(validateBedPolygon([...concave].reverse())).toMatchObject({ valid: true, area: 20 });
  });
  it('supports fractional corners and accepts a bed exactly one planning square in area', () => {
    expect(validateBedPolygon(rectangle(.25, .5, 1, 1))).toMatchObject({ valid: true, area: 1 });
    expect(validateBedPolygon(rectangle(.25, .5, .9, 1)).valid).toBe(false);
  });
  it('rejects a self-crossing shape even when its signed area is nonzero', () => {
    expect(validateBedPolygon(points([[0, 0], [5, 5], [0, 5], [4, 0]])).errors.join()).toMatch(/crosses/);
  });
  it.each([
    ['a repeated closing corner', points([[0, 0], [4, 0], [0, 4], [0, 0]])],
    ['a repeated interior corner', points([[0, 0], [4, 0], [4, 4], [4, 0], [0, 4]])],
    ['a corner touching a nonadjacent edge', points([[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]])],
    ['an edge doubling back', points([[0, 0], [4, 0], [2, 0], [4, 4], [0, 4]])],
    ['a zero-area shape', points([[0, 0], [2, 0], [4, 0]])],
    ['an outside corner', points([[-.1, 0], [4, 0], [0, 4]])],
    ['an unsupported coordinate', [{ x: Number.NaN, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }]],
  ])('rejects %s', (_description, polygon) => {
    expect(validateBedPolygon(polygon).valid).toBe(false);
  });
  it('does not confuse a concave notch with occupied bed area', () => {
    const cornerBed = points([[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]]);
    expect(polygonsOverlap(cornerBed, rectangle(2, 2, 4, 4))).toBe(false);
    expect(validateFarmLayout(layoutWith(cornerBed, rectangle(2, 2, 4, 4))).valid).toBe(true);
    expect(polygonsOverlap(cornerBed, rectangle(1, 3, 3, 2))).toBe(true);
  });
  it.each([
    ['a shared edge', rectangle(4, 0, 4, 4), false],
    ['a shared corner', rectangle(4, 4, 4, 4), false],
    ['a separated bed', rectangle(5, 5, 4, 4), false],
    ['partial collinear boundaries and a shared interior', rectangle(2, 0, 4, 4), true],
    ['containment without edge crossings', rectangle(1, 1, 2, 2), true],
    ['an identical shape', rectangle(0, 0, 4, 4), true],
    ['crossing edges without contained original corners', rectangle(1, 0, 2, 6), true],
  ])('handles %s', (_description, other, expected) => {
    const first = rectangle(0, 0, 4, 4);
    expect(polygonsOverlap(first, other)).toBe(expected);
    expect(polygonsOverlap(other, first)).toBe(expected);
    expect(polygonsOverlap([...first].reverse(), [...other].reverse())).toBe(expected);
  });
  it('accepts harmless collinear corners without losing overlap detection', () => {
    const polygon = points([[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]]);
    expect(validateBedPolygon(polygon).valid).toBe(true);
    expect(polygonsOverlap(polygon, rectangle(1, 1, 2, 2))).toBe(true);
    expect(polygonsOverlap(polygon, rectangle(4, 1, 2, 2))).toBe(false);
  });
  it('rejects duplicate identifiers, missing names, invalid dimensions, and excessive beds', () => {
    const layout = createDefaultLayout();
    layout.beds[1].slotId = layout.beds[0].slotId;
    expect(validateFarmLayout(layout).errors.join()).toMatch(/identifiers/);
    expect(validateFarmLayout({ ...createDefaultLayout(), width: 25 }).valid).toBe(false);
    const unnamed = createDefaultLayout(); unnamed.beds[0].name = '   ';
    expect(validateFarmLayout(unnamed).valid).toBe(false);
    const excessive = layoutWith(...Array.from({ length: 25 }, (_, index) => rectangle(index % 12 * 2, Math.floor(index / 12) * 2, 1, 1)));
    expect(validateFarmLayout(excessive).errors.join()).toMatch(/at most 24/);
  });
  it('supports more than six independent beds and names beyond the first alphabet', () => {
    const layout = layoutWith(...Array.from({ length: 12 }, (_, index) => rectangle(index * 2, 1, 1, 8)));
    expect(validateFarmLayout(layout).valid).toBe(true);
    expect(getPlotLabel(25)).toBe('Plot Z');
    expect(getPlotLabel(26)).toBe('Plot AA');
    expect(getBedName({ ...layout, beds: [{ ...layout.beds[0], name: 'North bed' }] }, 0)).toBe('North bed');
  });
});

describe('custom layouts preserve farm activity', () => {
  it('can plant an added bed whose stable identifier is outside the legacy six slots', () => {
    const original = createScenarioState();
    const layout = createDefaultLayout();
    layout.beds.push({ slotId: 40, name: 'Corner bed', points: rectangle(0, 0, 1, 1) });
    const edited = farmReducer(original, { type: 'set_layout', layout });
    const planted = farmReducer(edited, { type: 'plant', slotId: 40, cropId: 'chickpea', plantedOn: '2026-11-14' });
    expect(planted.plots.find(plot => plot.slotId === 40)).toMatchObject({ cropId: 'chickpea' });
    expect(planted.tasks).toHaveLength(original.tasks.length + 1);
    expect(farmReducer(planted, { type: 'plant', slotId: 40, cropId: 'wheat', plantedOn: '2026-11-14' })).toBe(planted);
    expect(farmReducer(planted, { type: 'plant', slotId: 41, cropId: 'wheat', plantedOn: '2026-11-14' })).toBe(planted);
  });
  it('keeps planting, tasks, history, and field analysis when a planted bed changes shape or name', () => {
    const original = createScenarioState();
    const completed = farmReducer(original, { type: 'complete_task', taskId: getDueTasks(original)[0].id });
    const layout = createDefaultLayout();
    layout.beds[0] = { slotId: 0, name: 'North bed', points: points([[1, 1], [7, 1], [7, 3], [4, 3], [4, 5], [1, 5]]) };
    const edited = farmReducer(completed, { type: 'set_layout', layout });
    expect(edited.layout.beds[0].points).toHaveLength(6);
    expect(edited.plots).toEqual(completed.plots);
    expect(edited.tasks).toEqual(completed.tasks);
    expect(edited.journal).toEqual(completed.journal);
    expect(edited.analysis).toBe(completed.analysis);
    expect(edited.boundaryVersion).toBe(completed.boundaryVersion);
    layout.beds[0].name = 'Changed outside the reducer';
    expect(edited.layout.beds[0].name).toBe('North bed');
  });
  it('removes only the deleted bed planting and tasks while preserving its journal', () => {
    const original = createScenarioState();
    const task = getDueTasks(original)[0];
    const completed = farmReducer(original, { type: 'complete_task', taskId: task.id });
    const layout = createDefaultLayout(); layout.beds = layout.beds.filter(bed => bed.slotId !== 0);
    const edited = farmReducer(completed, { type: 'set_layout', layout });
    expect(edited.plots).toEqual(completed.plots.filter(plot => plot.id !== task.plotId));
    expect(edited.tasks).toEqual(completed.tasks.filter(item => item.plotId !== task.plotId));
    expect(edited.journal).toEqual(completed.journal);
    expect(farmReducer(edited, { type: 'undo_action', entryId: edited.journal[0].id })).toBe(edited);
    expect(edited.analysis).toBe(completed.analysis);
  });
  it('rejects an invalid edit atomically and supports an intentionally empty layout', () => {
    const original = createScenarioState();
    const layout = createDefaultLayout(); layout.beds[1].points = structuredClone(layout.beds[0].points);
    expect(farmReducer(original, { type: 'set_layout', layout })).toBe(original);
    const cleared = farmReducer(original, { type: 'set_layout', layout: { width: 24, height: 12, beds: [] } });
    expect(cleared.layout.beds).toHaveLength(0);
    expect(cleared.plots).toHaveLength(0);
    expect(cleared.tasks).toHaveLength(0);
    expect(cleared.analysis).toBe(original.analysis);
  });
});

describe('layout persistence and legacy farm migration', () => {
  it('loads version-one farms with the familiar default layout and all activity intact', () => {
    const storage = memoryStorage();
    const original = createScenarioState();
    const completed = farmReducer(original, { type: 'complete_task', taskId: getDueTasks(original)[0].id });
    const { layout: _layout, ...previous } = completed;
    const legacy = { ...previous, version: 1 };
    const saved = JSON.stringify(legacy);
    storage.setItem(STORAGE_KEY, saved);
    const result = loadFarm(storage);
    expect(result.error).toBeNull();
    expect(result.state).toEqual({ ...completed, version: 2, layout: createDefaultLayout() });
    expect(storage.getItem(STORAGE_KEY)).toBe(saved);
    expect(saveFarm(result.state, storage)).toBeNull();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toMatchObject({ version: 2, layout: createDefaultLayout() });
    expect(loadFarm(storage).state.journal).toEqual(completed.journal);
  });
  it('round-trips a custom polygon, name, and nonlegacy bed identifier', () => {
    const storage = memoryStorage();
    const original = createScenarioState();
    const layout = createDefaultLayout();
    layout.beds[0] = { slotId: 51, name: 'Triangle bed', points: points([[1, 1], [7, 1], [1, 5]]) };
    let edited = farmReducer(original, { type: 'set_layout', layout });
    edited = farmReducer(edited, { type: 'plant', slotId: 51, cropId: 'sorghum', plantedOn: '2026-11-14' });
    expect(saveFarm(edited, storage)).toBeNull();
    const loaded = loadFarm(storage);
    expect(loaded.error).toBeNull();
    expect(loaded.state).toEqual(edited);
  });
  it('preserves damaged legacy data rather than migrating an unsupported planting slot', () => {
    const storage = memoryStorage();
    const { layout: _layout, ...original } = createScenarioState();
    const invalid = { ...original, version: 1, plots: [{ ...original.plots[0], slotId: 6 }] };
    const saved = JSON.stringify(invalid);
    storage.setItem(STORAGE_KEY, saved);
    expect(loadFarm(storage).error).toMatch(/saved farm/);
    expect(storage.getItem(STORAGE_KEY)).toBe(saved);
  });
  it('refuses saved layouts with overlap or plantings that refer to missing beds', () => {
    const storage = memoryStorage();
    const original = createScenarioState();
    const overlap = structuredClone(original);
    overlap.layout.beds[1].points = structuredClone(overlap.layout.beds[0].points);
    expect(saveFarm(overlap, storage)).toMatch(/invalid/);
    const missing = structuredClone(original);
    missing.layout.beds = missing.layout.beds.filter(bed => bed.slotId !== missing.plots[0].slotId);
    const saved = JSON.stringify(missing);
    storage.setItem(STORAGE_KEY, saved);
    expect(loadFarm(storage).error).toMatch(/saved farm/);
    expect(storage.getItem(STORAGE_KEY)).toBe(saved);
  });
});
