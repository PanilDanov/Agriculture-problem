import { z } from 'zod';
import type { FarmState, ProviderSettings, ProviderSettingsLoadResult, ScenarioId, StorageLike } from './orbitFarm-types';
import { analysisResultSchema, cropIdSchema, dateSchema, farmInputsSchema, isoSchema, polygonSchema, scenarioIdSchema, validateBoundary } from './orbitFarm-validation';
import { createScenarioState } from './orbitFarm-model';
import { createDefaultLayout, farmLayoutSchema, MAX_LAYOUT_BEDS } from './orbitFarm-layout';

export const STORAGE_KEY = 'orbitFarm.farm.v1';
export const PROVIDER_SETTINGS_KEY = 'orbitFarm.provider.v1';

const providerSettingsSchema = z.object({
  mode: z.enum(['mock', 'api']),
  baseUrl: z.string().trim().min(1).refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
    } catch {
      return false;
    }
  }, 'Use an HTTP or HTTPS analysis service URL without embedded credentials.'),
}).strict();

export function loadProviderSettings(storage: StorageLike): ProviderSettingsLoadResult {
  let saved: string | null;
  try {
    saved = storage.getItem(PROVIDER_SETTINGS_KEY);
  } catch {
    return { settings: null, error: 'Provider settings could not be read on this device. Select your analysis service again; demo mode has not been selected.' };
  }
  if (saved === null) return { settings: null, error: null };
  try {
    const parsed = providerSettingsSchema.safeParse(JSON.parse(saved));
    if (parsed.success) return { settings: parsed.data, error: null };
  } catch {
    // Keep damaged settings intact until the user explicitly saves a replacement.
  }
  return { settings: null, error: 'The saved provider settings are damaged or unsupported. Select your analysis service again; demo mode has not been selected.' };
}

export function saveProviderSettings(settings: ProviderSettings, storage: StorageLike): string | null {
  const parsed = providerSettingsSchema.safeParse(settings);
  if (!parsed.success) return 'Provider settings could not be saved. Choose a supported mode and an HTTP or HTTPS service URL without embedded credentials.';
  try {
    storage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify(parsed.data));
    return null;
  } catch {
    return 'Provider settings could not be saved on this device. Your selection remains active in this tab.';
  }
}

const taskStatusSchema = z.enum(['open', 'done', 'skipped', 'snoozed']);
const plotSchema = z.object({ id: z.string().min(1), slotId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), cropId: cropIdSchema, plantedOn: dateSchema }).strict();
const taskFields = { id: z.string().min(1), plotId: z.string().min(1), kind: z.enum(['water', 'soil']), title: z.string().min(1), reason: z.string().min(1), status: taskStatusSchema };
const journalFields = { id: z.string().min(1), taskId: z.string().min(1).nullable(), plotId: z.string().min(1), action: z.enum(['watered', 'done', 'skipped', 'snoozed']), undone: z.boolean(), previousStatus: taskStatusSchema.optional() };
const commonFarmFields = {
  farmId: z.string().min(1), name: z.string().min(1).max(70), boundary: polygonSchema.nullable(), boundaryVersion: z.number().int().min(1),
  analysis: analysisResultSchema.nullable(), scenarioId: scenarioIdSchema, selectedPlanId: z.string().nullable(), pendingRequestId: z.string().nullable(), analysisError: z.string().nullable(),
};
const farmFields = {
  ...commonFarmFields, inputs: farmInputsSchema,
  tasks: z.array(z.object({ ...taskFields, dueOn: dateSchema, snoozedUntil: dateSchema.nullable() }).strict()),
  journal: z.array(z.object({ ...journalFields, createdOn: dateSchema, previousSnoozedUntil: dateSchema.nullable().optional() }).strict()),
  demoToday: dateSchema,
};

function validateStateRelations(state: Pick<FarmState, 'boundary' | 'boundaryVersion' | 'farmId' | 'plots' | 'tasks' | 'journal' | 'analysis'>, ctx: z.RefinementCtx) {
  if (state.boundary && !validateBoundary(state.boundary).valid) ctx.addIssue({ code: 'custom', path: ['boundary'], message: 'Invalid saved field boundary.' });
  if (new Set(state.plots.map(p => p.slotId)).size !== state.plots.length || new Set(state.plots.map(p => p.id)).size !== state.plots.length) ctx.addIssue({ code: 'custom', path: ['plots'], message: 'Saved planting areas overlap.' });
  if (!state.boundary && state.plots.length) ctx.addIssue({ code: 'custom', path: ['plots'], message: 'Plantings need a field boundary.' });
  if (state.tasks.some(t => !state.plots.some(p => p.id === t.plotId)) || new Set(state.tasks.map(t => t.id)).size !== state.tasks.length) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'Saved tasks do not match their planting areas.' });
  if (state.tasks.some(t => (t.status === 'snoozed') !== (t.snoozedUntil !== null))) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'A snoozed task needs its reminder date.' });
  if (new Set(state.journal.map(e => e.id)).size !== state.journal.length) ctx.addIssue({ code: 'custom', path: ['journal'], message: 'Journal entry identifiers must be unique.' });
  if (state.journal.some(e => e.taskId === null && (e.action !== 'watered' || e.previousStatus !== undefined || e.previousSnoozedUntil !== undefined))) ctx.addIssue({ code: 'custom', path: ['journal'], message: 'Only a manual watering entry can be saved without a task.' });
  if (state.journal.some(e => (e.previousStatus === 'snoozed') !== (typeof e.previousSnoozedUntil === 'string'))) ctx.addIssue({ code: 'custom', path: ['journal'], message: 'A saved reminder snapshot needs a matching reminder date.' });
  if (state.analysis && (state.analysis.farmId !== state.farmId || state.analysis.boundaryVersion !== state.boundaryVersion)) ctx.addIssue({ code: 'custom', path: ['analysis'], message: 'Saved analysis belongs to an older field.' });
}

// Validate the old shape before dropping fields so damaged saves remain untouched.
const legacySeasonSchema = z.object({ plantingDate: dateSchema, endDate: dateSchema }).strict().refine(season => season.endDate >= season.plantingDate);
const legacyInputsSchema = z.object({ season: legacySeasonSchema, ...farmInputsSchema.shape }).strict()
  .transform(({ season: _season, ...inputs }) => inputs).pipe(farmInputsSchema);
const legacyFarmFields = {
  ...commonFarmFields, inputs: legacyInputsSchema,
  tasks: z.array(z.object({ ...taskFields, dueAtISO: isoSchema, snoozedUntilISO: isoSchema.nullable() }).strict()),
  journal: z.array(z.object({ ...journalFields, createdAtISO: isoSchema, previousSnoozedUntilISO: isoSchema.nullable().optional() }).strict()),
  demoNow: isoSchema,
};
const legacyFarmStateSchema = z.discriminatedUnion('version', [
  z.object({ version: z.literal(1), ...legacyFarmFields, plots: z.array(plotSchema.extend({ slotId: z.number().int().min(0).max(5) })).max(6) }).strict(),
  z.object({ version: z.literal(2), ...legacyFarmFields, layout: farmLayoutSchema, plots: z.array(plotSchema).max(MAX_LAYOUT_BEDS) }).strict(),
]);

function migrateLegacyFarm(state: z.infer<typeof legacyFarmStateSchema>) {
  const { demoNow, tasks, journal, ...rest } = state;
  return {
    ...rest, version: 3, layout: state.version === 1 ? createDefaultLayout() : state.layout,
    demoToday: demoNow.slice(0, 10),
    tasks: tasks.map(({ dueAtISO, snoozedUntilISO, ...task }) => ({ ...task, dueOn: dueAtISO.slice(0, 10), snoozedUntil: snoozedUntilISO?.slice(0, 10) ?? null })),
    journal: journal.map(({ createdAtISO, previousSnoozedUntilISO, ...entry }) => ({ ...entry, createdOn: createdAtISO.slice(0, 10), ...(previousSnoozedUntilISO === undefined ? {} : { previousSnoozedUntil: previousSnoozedUntilISO?.slice(0, 10) ?? null }) })),
  };
}

export const farmStateSchema = z.object({
  version: z.literal(3), ...farmFields, layout: farmLayoutSchema,
  plots: z.array(plotSchema).max(MAX_LAYOUT_BEDS),
}).strict().superRefine((state, ctx) => {
  validateStateRelations(state, ctx);
  const bedIds = new Set(state.layout.beds.map(bed => bed.slotId));
  if (state.plots.some(plot => !bedIds.has(plot.slotId))) ctx.addIssue({ code: 'custom', path: ['plots'], message: 'Saved plantings need a matching bed in the farm layout.' });
});

export function loadFarm(storage: StorageLike, initialScenario: ScenarioId = 'dry-week'): { state: FarmState; error: string | null } {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (!saved) return { state: createScenarioState(initialScenario), error: null };
    const value: unknown = JSON.parse(saved);
    const legacy = value && typeof value === 'object' && 'version' in value && (value.version === 1 || value.version === 2) ? legacyFarmStateSchema.safeParse(value) : null;
    if (legacy && !legacy.success) return { state: createScenarioState('dry-week'), error: 'The saved farm could not be read. A demo farm is shown; your saved data has not been overwritten.' };
    const parsed = farmStateSchema.safeParse(legacy?.success ? migrateLegacyFarm(legacy.data) : value);
    if (!parsed.success) return { state: createScenarioState('dry-week'), error: 'The saved farm could not be read. A demo farm is shown; your saved data has not been overwritten.' };
    return { state: { ...parsed.data, pendingRequestId: null } as FarmState, error: null };
  } catch {
    return { state: createScenarioState('dry-week'), error: 'Local storage is unavailable or the saved farm is damaged. Changes may not persist on this device.' };
  }
}

export function saveFarm(state: FarmState, storage: StorageLike): string | null {
  try {
    const parsed = farmStateSchema.safeParse(state);
    if (!parsed.success) return 'The farm could not be saved because its data is invalid.';
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed.data, pendingRequestId: null }));
    return null;
  } catch {
    return 'Your changes could not be saved on this device. Storage may be full or disabled.';
  }
}
