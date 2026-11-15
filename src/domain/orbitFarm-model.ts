import type { CareTask, FarmAction, FarmState, JournalEntry, Plot, ScenarioId, AnalysisRequest } from './orbitFarm-types';
import { CROP_CATALOG, CROP_PROFILES } from './orbitFarm-crop-catalog';
import { DEFAULT_INPUTS, DEMO_BOUNDARY, DEMO_TODAY, makeMockAnalysis } from './orbitFarm-fixtures';
import { dateSchema, validateAnalysisRequest, validateBoundary, validateFarmInputs } from './orbitFarm-validation';
import { createDefaultLayout, farmLayoutSchema } from './orbitFarm-layout';

// Calendar dates are opaque YYYY-MM-DD values; offsets never move a farm day.
const DAY_MS = 86_400_000;
const FIRST_FARM_DAY = Date.parse('0000-01-01T00:00:00Z');
const LAST_FARM_DAY = Date.parse('9999-12-31T00:00:00Z');

export function getFarmDate(value: string): string {
  return dateSchema.parse(value.slice(0, 10));
}

function farmDateMilliseconds(value: string): number {
  return Date.parse(`${getFarmDate(value)}T00:00:00Z`);
}

export function daysBetweenFarmDates(from: string, to: string): number {
  return (farmDateMilliseconds(to) - farmDateMilliseconds(from)) / DAY_MS;
}

export function addFarmDays(value: string, days: number): string {
  const target = farmDateMilliseconds(value) + days * DAY_MS;
  return new Date(Math.min(LAST_FARM_DAY, Math.max(FIRST_FARM_DAY, target))).toISOString().slice(0, 10);
}

export function addDemoDay(value: string): string {
  return addFarmDays(value, 1);
}

export function getEstimatedHarvestDate(plot: Plot): string {
  return addFarmDays(plot.plantedOn, CROP_PROFILES[plot.cropId].daysToHarvest);
}

export type GrowthStage = 'Planned' | 'Seedling' | 'Growing' | 'Ready to harvest';

export function getGrowthStage(plot: Plot, date: string): GrowthStage {
  const days = daysBetweenFarmDates(plot.plantedOn, date);
  if (days < 0) return 'Planned';
  const { daysToGrowing, daysToHarvest } = CROP_PROFILES[plot.cropId];
  if (days < daysToGrowing) return 'Seedling';
  return days < daysToHarvest ? 'Growing' : 'Ready to harvest';
}

export function buildAnalysisRequest(state: FarmState, requestId: string): AnalysisRequest {
  if (!state.boundary) throw new Error('Draw and confirm your field boundary first.');
  const inputs = validateFarmInputs(state.inputs);
  const irrigation = inputs.irrigation;
  return validateAnalysisRequest({
    schemaVersion: '1.0', requestId, farmId: state.farmId, boundaryVersion: state.boundaryVersion, boundary: state.boundary,
    regionLabel: 'Selected field',
    localInputs: {
      soil: { ...inputs.soil, source: inputs.soil.source ?? (state.scenarioId === 'empty-farm' ? 'farmer_reported' : 'synthetic'), sampledOn: null },
      irrigation: { availability: irrigation.availability, method: irrigation.method, waterBudget: irrigation.volumeM3 === null ? null : { volumeM3: irrigation.volumeM3, basis: 'field_inlet' }, applicationEfficiency: null },
      previousCropId: inputs.previousCropId, currentPlan: null,
    }, priorities: [inputs.priority],
  });
}

function taskForPlot(plot: Plot, dueOn: string): CareTask {
  return { id: `care-${plot.id}`, plotId: plot.id, kind: 'water', title: 'Check soil moisture', reason: 'Check the soil locally before irrigating. This planting reminder does not confirm a water deficit.', dueOn, status: 'open', snoozedUntil: null };
}

export function createScenarioState(scenarioId: ScenarioId = 'dry-week'): FarmState {
  const inputs = structuredClone(DEFAULT_INPUTS);
  const empty = scenarioId === 'empty-farm';
  if (empty) { inputs.soil = { ph: null, texture: null, source: 'unknown' }; inputs.irrigation = { availability: 'unknown', method: null, volumeM3: null }; inputs.previousCropId = null; inputs.priority = 'balanced'; }
  const plots: Plot[] = empty ? [] : [{ id: 'plot-0', slotId: 0, cropId: 'wheat', plantedOn: '2026-11-02' }, { id: 'plot-1', slotId: 1, cropId: 'chickpea', plantedOn: '2026-11-05' }, { id: 'plot-4', slotId: 4, cropId: 'sorghum', plantedOn: '2026-11-08' }];
  const tasks = plots.map((plot, i) => taskForPlot(plot, `2026-11-${14 + i}`));
  if (scenarioId === 'dry-week' && tasks[0]) tasks[0].reason = 'Simulated regional conditions suggest a dry spell. Check the soil locally before irrigating.';
  if (tasks[1]) { tasks[1].kind = 'soil'; tasks[1].title = 'Check soil nutrients'; tasks[1].reason = 'A local soil test can guide nutrient decisions. Satellite data alone cannot determine a fertilizer dose.'; }
  const state: FarmState = { version: 3, farmId: 'farm-demo-01', name: empty ? 'My new farm' : 'Meadow Farm', boundary: empty ? null : structuredClone(DEMO_BOUNDARY), boundaryVersion: 1, inputs, analysis: null, layout: createDefaultLayout(), plots, tasks, journal: [], demoToday: DEMO_TODAY, scenarioId, selectedPlanId: null, pendingRequestId: null, analysisError: null };
  if (!empty && scenarioId !== 'api-unavailable') state.analysis = makeMockAnalysis(buildAnalysisRequest(state, 'd5f4cd61-186f-42fb-b09b-42b0d6549571'), scenarioId);
  return state;
}

export function getDueTasks(state: FarmState): CareTask[] {
  const today = state.demoToday;
  return state.tasks.filter(task => task.dueOn <= today && (task.status === 'open' || (task.status === 'snoozed' && task.snoozedUntil !== null && task.snoozedUntil <= today))).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

function logAction(state: FarmState, taskId: string, action: JournalEntry['action']): FarmState {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || task.status === 'done' || task.status === 'skipped') return state;
  const status = action === 'snoozed' ? 'snoozed' : action === 'skipped' ? 'skipped' : 'done';
  const nextUntil = action === 'snoozed' ? addDemoDay(state.demoToday) : null;
  if (task.status === 'snoozed' && action === 'snoozed' && task.snoozedUntil === nextUntil) return state;
  const entry: JournalEntry = { id: `entry-${state.journal.length + 1}`, taskId, plotId: task.plotId, action, createdOn: state.demoToday, undone: false, previousStatus: task.status, previousSnoozedUntil: task.snoozedUntil };
  return { ...state, tasks: state.tasks.map(t => t.id === taskId ? { ...t, status, snoozedUntil: nextUntil } : t), journal: [...state.journal, entry] };
}

export function getLastWatering(state: FarmState, plotId: string): string | undefined {
  return state.journal.filter(entry => entry.plotId === plotId && entry.action === 'watered' && !entry.undone).at(-1)?.createdOn;
}

export function canUndoJournalEntry(state: FarmState, entry: JournalEntry): boolean {
  if (entry.undone) return false;
  if (entry.taskId === null) return state.plots.some(plot => plot.id === entry.plotId);
  return state.tasks.some(task => task.id === entry.taskId)
    && state.journal.filter(item => item.taskId === entry.taskId && !item.undone).at(-1)?.id === entry.id;
}

export function farmReducer(state: FarmState, action: FarmAction): FarmState {
  switch (action.type) {
    case 'set_name': return { ...state, name: action.name.trim().slice(0, 70) || 'My farm' };
    case 'set_boundary': {
      const result = validateBoundary(action.boundary);
      if (!result.valid) return { ...state, analysisError: result.errors[0] };
      return { ...state, boundary: structuredClone(action.boundary), boundaryVersion: state.boundaryVersion + 1, analysis: null, pendingRequestId: null, analysisError: null, selectedPlanId: null };
    }
    case 'set_inputs': {
      try { const inputs = validateFarmInputs(action.inputs); inputs.soil.source = inputs.soil.ph === null && inputs.soil.texture === null ? 'unknown' : 'farmer_reported'; return { ...state, inputs, analysis: null, pendingRequestId: null, analysisError: null, selectedPlanId: null }; }
      catch (error) { return { ...state, analysisError: error instanceof Error ? error.message : 'Check your farm information.' }; }
    }
    case 'analysis_started': return { ...state, pendingRequestId: action.requestId, analysisError: null };
    case 'analysis_received':
      if (action.analysis.requestId !== state.pendingRequestId || action.analysis.farmId !== state.farmId || action.analysis.boundaryVersion !== state.boundaryVersion) return state;
      return { ...state, analysis: action.analysis, pendingRequestId: null, analysisError: null };
    case 'analysis_failed':
      return action.requestId === state.pendingRequestId ? { ...state, pendingRequestId: null, analysisError: action.message } : state;
    case 'select_plan': return state.analysis?.rotationPlans.some(p => p.planId === action.planId) ? { ...state, selectedPlanId: action.planId } : state;
    case 'set_layout': {
      const parsed = farmLayoutSchema.safeParse(action.layout);
      if (!parsed.success) return state;
      const layout = structuredClone(parsed.data);
      const slots = new Set(layout.beds.map(bed => bed.slotId));
      const plots = state.plots.filter(plot => slots.has(plot.slotId));
      const plotIds = new Set(plots.map(plot => plot.id));
      return { ...state, layout, plots, tasks: state.tasks.filter(task => plotIds.has(task.plotId)) };
    }
    case 'plant': {
      if (!state.boundary || !state.layout.beds.some(bed => bed.slotId === action.slotId) || state.plots.some(p => p.slotId === action.slotId) || !CROP_CATALOG.some(c => c.id === action.cropId) || !dateSchema.safeParse(action.plantedOn).success) return state;
      const plot: Plot = { id: `plot-${action.slotId}-${state.journal.length}-${state.plots.length}`, slotId: action.slotId, cropId: action.cropId, plantedOn: action.plantedOn };
      return { ...state, plots: [...state.plots, plot], tasks: [...state.tasks, taskForPlot(plot, action.plantedOn)] };
    }
    case 'edit_plot': {
      if (!CROP_CATALOG.some(c => c.id === action.cropId) || !dateSchema.safeParse(action.plantedOn).success) return state;
      return { ...state, plots: state.plots.map(p => p.id === action.plotId ? { ...p, cropId: action.cropId, plantedOn: action.plantedOn } : p), tasks: state.tasks.map(t => t.plotId === action.plotId && t.status !== 'done' && t.status !== 'skipped' ? { ...t, dueOn: action.plantedOn, status: 'open', snoozedUntil: null } : t) };
    }
    case 'remove_plot': return { ...state, plots: state.plots.filter(p => p.id !== action.plotId), tasks: state.tasks.filter(t => t.plotId !== action.plotId) };
    case 'complete_task': return logAction(state, action.taskId, state.tasks.find(t => t.id === action.taskId)?.kind === 'water' ? 'watered' : 'done');
    case 'record_watering': {
      if (!state.plots.some(plot => plot.id === action.plotId && plot.plantedOn <= state.demoToday)
        || getLastWatering(state, action.plotId) === state.demoToday) return state;
      const reminder = getDueTasks(state).find(task => task.plotId === action.plotId && task.kind === 'water');
      if (reminder) return logAction(state, reminder.id, 'watered');
      const entry: JournalEntry = {
        id: `entry-${state.journal.length + 1}`, taskId: null, plotId: action.plotId,
        action: 'watered', createdOn: state.demoToday, undone: false,
      };
      return { ...state, journal: [...state.journal, entry] };
    }
    case 'skip_task': return logAction(state, action.taskId, 'skipped');
    case 'snooze_task': return logAction(state, action.taskId, 'snoozed');
    case 'undo_action': {
      const entry = state.journal.find(e => e.id === action.entryId);
      if (!entry || !canUndoJournalEntry(state, entry)) return state;
      const tasks = entry.taskId === null ? state.tasks : state.tasks.map(task =>
        task.id === entry.taskId ? { ...task, status: entry.previousStatus ?? 'open', snoozedUntil: entry.previousSnoozedUntil ?? null } : task);
      return { ...state, tasks, journal: state.journal.map(e => e.id === entry.id ? { ...e, undone: true } : e) };
    }
    case 'advance_day': return { ...state, demoToday: addDemoDay(state.demoToday) };
    default: return state;
  }
}
