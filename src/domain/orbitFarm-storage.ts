import { z } from 'zod';
import type { FarmState, ProviderSettings, ProviderSettingsLoadResult, StorageLike } from './orbitFarm-types';
import { analysisResultSchema, cropIdSchema, dateSchema, farmInputsSchema, isoSchema, polygonSchema, scenarioIdSchema, validateBoundary } from './orbitFarm-validation';
import { createScenarioState } from './orbitFarm-model';

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
export const farmStateSchema = z.object({
  version: z.literal(1), farmId: z.string().min(1), name: z.string().min(1).max(70), boundary: polygonSchema.nullable(), boundaryVersion: z.number().int().min(1),
  inputs: farmInputsSchema, analysis: analysisResultSchema.nullable(),
  plots: z.array(z.object({ id: z.string().min(1), slotId: z.number().int().min(0).max(5), cropId: cropIdSchema, plantedOn: dateSchema }).strict()).max(6),
  tasks: z.array(z.object({ id: z.string().min(1), plotId: z.string().min(1), kind: z.enum(['water', 'soil']), title: z.string().min(1), reason: z.string().min(1), dueAtISO: isoSchema, status: taskStatusSchema, snoozedUntilISO: isoSchema.nullable() }).strict()),
  journal: z.array(z.object({ id: z.string().min(1), taskId: z.string().min(1), plotId: z.string().min(1), action: z.enum(['watered', 'done', 'skipped', 'snoozed']), createdAtISO: isoSchema, undone: z.boolean(), previousStatus: taskStatusSchema.optional(), previousSnoozedUntilISO: isoSchema.nullable().optional() }).strict()),
  demoNow: isoSchema, scenarioId: scenarioIdSchema, selectedPlanId: z.string().nullable(), pendingRequestId: z.string().nullable(), analysisError: z.string().nullable(),
}).strict().superRefine((state, ctx) => {
  if (state.boundary && !validateBoundary(state.boundary).valid) ctx.addIssue({ code: 'custom', path: ['boundary'], message: 'Invalid saved field boundary.' });
  if (new Set(state.plots.map(p => p.slotId)).size !== state.plots.length || new Set(state.plots.map(p => p.id)).size !== state.plots.length) ctx.addIssue({ code: 'custom', path: ['plots'], message: 'Saved planting areas overlap.' });
  if (!state.boundary && state.plots.length) ctx.addIssue({ code: 'custom', path: ['plots'], message: 'Plantings need a field boundary.' });
  if (state.tasks.some(t => !state.plots.some(p => p.id === t.plotId)) || new Set(state.tasks.map(t => t.id)).size !== state.tasks.length) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'Saved tasks do not match their planting areas.' });
  if (state.tasks.some(t => (t.status === 'snoozed') !== (t.snoozedUntilISO !== null))) ctx.addIssue({ code: 'custom', path: ['tasks'], message: 'A snoozed task needs its reminder time.' });
  if (new Set(state.journal.map(e => e.id)).size !== state.journal.length) ctx.addIssue({ code: 'custom', path: ['journal'], message: 'Journal entry identifiers must be unique.' });
  if (state.journal.some(e => (e.previousStatus === 'snoozed') !== (typeof e.previousSnoozedUntilISO === 'string'))) ctx.addIssue({ code: 'custom', path: ['journal'], message: 'A saved reminder snapshot needs a matching reminder time.' });
  if (state.analysis && (state.analysis.farmId !== state.farmId || state.analysis.boundaryVersion !== state.boundaryVersion)) ctx.addIssue({ code: 'custom', path: ['analysis'], message: 'Saved analysis belongs to an older field.' });
});

export function loadFarm(storage: StorageLike): { state: FarmState; error: string | null } {
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (!saved) return { state: createScenarioState('dry-week'), error: null };
    const parsed = farmStateSchema.safeParse(JSON.parse(saved));
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
