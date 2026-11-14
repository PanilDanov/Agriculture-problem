import area from '@turf/area';
import type { Polygon } from 'geojson';
import { z } from 'zod';
import { CROP_IDS } from './orbitFarm-crop-catalog';
import type { AnalysisRequest, AnalysisResult, FarmInputs } from './orbitFarm-types';

export const cropIdSchema = z.enum(CROP_IDS);
export const scenarioIdSchema = z.enum(['normal', 'dry-week', 'missing-data', 'stale-data', 'api-unavailable', 'empty-farm']);
export const textureSchema = z.enum(['sand', 'loamy_sand', 'sandy_loam', 'loam', 'silt_loam', 'silt', 'sandy_clay_loam', 'clay_loam', 'silty_clay_loam', 'sandy_clay', 'silty_clay', 'clay']);
export const isoSchema = z.string().datetime({ offset: true });
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a complete YYYY-MM-DD date.').refine(value => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');

const positionSchema = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
export const polygonSchema = z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(positionSchema)).length(1) }).strict();

function orientation(a: number[], b: number[], c: number[]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a: number[], b: number[], p: number[]): boolean {
  return Math.abs(orientation(a, b, p)) < 1e-12 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
}
function segmentsIntersect(a: number[], b: number[], c: number[], d: number[]): boolean {
  const abC = orientation(a, b, c), abD = orientation(a, b, d), cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

export function validateBoundary(value: unknown): { valid: boolean; errors: string[]; areaHa: number } {
  const parsed = polygonSchema.safeParse(value);
  if (!parsed.success) return { valid: false, errors: ['Draw a single field with valid longitude and latitude coordinates.'], areaHa: 0 };
  const ring = parsed.data.coordinates[0];
  if (ring.length < 4 || ring[0][0] !== ring.at(-1)?.[0] || ring[0][1] !== ring.at(-1)?.[1]) {
    return { valid: false, errors: ['Close the boundary with at least three distinct corners.'], areaHa: 0 };
  }
  for (let i = 0; i < ring.length - 1; i++) {
    if (ring[i][0] === ring[i + 1][0] && ring[i][1] === ring[i + 1][1]) return { valid: false, errors: ['Remove duplicate boundary corners.'], areaHa: 0 };
    if (Math.abs(ring[i][0] - ring[i + 1][0]) > 180) return { valid: false, errors: ['Fields crossing the date line are not supported in this demo.'], areaHa: 0 };
    for (let j = i + 1; j < ring.length - 1; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 2)) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return { valid: false, errors: ['The boundary crosses itself. Move or remove a point.'], areaHa: 0 };
    }
  }
  const areaHa = area(parsed.data as Polygon) / 10000;
  if (!Number.isFinite(areaHa) || areaHa < 0.000001) return { valid: false, errors: ['The boundary must enclose a field with a positive area.'], areaHa: 0 };
  return { valid: true, errors: [], areaHa };
}

const prioritySchema = z.enum(['balanced', 'save_water', 'improve_soil']);
const availabilitySchema = z.enum(['available', 'none', 'unknown']);
const methodSchema = z.enum(['drip', 'sprinkler', 'surface']).nullable();
export const farmInputsSchema = z.object({
  soil: z.object({ ph: z.number().finite().min(0).max(14).nullable(), texture: textureSchema.nullable(), source: z.enum(['farmer_reported', 'soil_test', 'synthetic', 'unknown']).optional() }).strict(),
  irrigation: z.object({ availability: availabilitySchema, method: methodSchema, volumeM3: z.number().finite().min(0).nullable() }).strict(),
  previousCropId: cropIdSchema.nullable(),
  priority: prioritySchema,
}).strict().superRefine((value, ctx) => {
  if (value.irrigation.availability === 'none' && ((value.irrigation.volumeM3 ?? 0) > 0 || value.irrigation.method !== null)) ctx.addIssue({ code: 'custom', path: ['irrigation'], message: 'No irrigation access cannot have an irrigation method or positive allocation.' });
  if (value.irrigation.availability === 'unknown' && (value.irrigation.volumeM3 !== null || value.irrigation.method !== null)) ctx.addIssue({ code: 'custom', path: ['irrigation'], message: 'Unknown irrigation access requires an unknown method and allocation.' });
});

const irrigationSchema = z.object({
  availability: availabilitySchema,
  method: methodSchema,
  waterBudget: z.object({ volumeM3: z.number().finite().min(0), basis: z.literal('field_inlet') }).strict().nullable(),
  applicationEfficiency: z.number().finite().gt(0).max(1).nullable(),
}).strict();

export const analysisRequestSchema = z.object({
  schemaVersion: z.literal('1.0'), requestId: z.string().uuid(), farmId: z.string().min(1), boundaryVersion: z.number().int().min(1),
  boundary: polygonSchema, regionLabel: z.string(),
  localInputs: z.object({
    soil: z.object({ ph: z.number().finite().min(0).max(14).nullable(), texture: textureSchema.nullable(), source: z.enum(['farmer_reported', 'soil_test', 'synthetic', 'unknown']), sampledOn: dateSchema.nullable() }).strict(),
    irrigation: irrigationSchema, previousCropId: cropIdSchema.nullable(),
    currentPlan: z.array(z.object({ seasonIndex: z.number().int().min(1).max(2), cropId: cropIdSchema }).strict()).length(2).nullable(),
  }).strict(), priorities: z.tuple([prioritySchema]),
}).strict().superRefine((request, ctx) => {
  const boundary = validateBoundary(request.boundary);
  if (!boundary.valid) ctx.addIssue({ code: 'custom', path: ['boundary'], message: boundary.errors[0] });
  const irrigation = request.localInputs.irrigation;
  if (irrigation.availability === 'none' && ((irrigation.waterBudget?.volumeM3 ?? 0) > 0 || irrigation.method !== null || irrigation.applicationEfficiency !== null)) ctx.addIssue({ code: 'custom', path: ['localInputs', 'irrigation'], message: 'No irrigation access cannot have a positive allocation, method, or efficiency.' });
  if (irrigation.availability === 'unknown' && (irrigation.waterBudget !== null || irrigation.method !== null || irrigation.applicationEfficiency !== null)) ctx.addIssue({ code: 'custom', path: ['localInputs', 'irrigation'], message: 'Unknown irrigation access requires unknown allocation, method, and efficiency.' });
  if (request.localInputs.currentPlan && new Set(request.localInputs.currentPlan.map(p => p.seasonIndex)).size !== 2) ctx.addIssue({ code: 'custom', path: ['localInputs', 'currentPlan'], message: 'The existing plan must contain seasons 1 and 2.' });
});

export const environmentalSignalSchema = z.object({
  signalId: z.string().min(1), label: z.string().min(1), value: z.number().finite().nullable(),
  unit: z.enum(['m³/m³', '°C', 'mm', 'pH', 'ha']), origin: z.enum(['synthetic', 'nasa']), observedAt: isoSchema, fetchedAt: isoSchema,
  quality: z.enum(['good', 'missing', 'stale']), spatialResolutionKm: z.number().finite().gt(0).nullable(),
  source: z.object({ dataset: z.string().min(1), url: z.string().min(1), version: z.string().min(1) }).passthrough(),
}).passthrough().superRefine((signal, ctx) => {
  const knownUnits: Record<string, string> = { 'soil-moisture': 'm³/m³', temperature: '°C', rainfall: 'mm' };
  if (knownUnits[signal.signalId] && signal.unit !== knownUnits[signal.signalId]) ctx.addIssue({ code: 'custom', path: ['unit'], message: 'The signal unit does not match the observed variable.' });
  if ((signal.value === null) !== (signal.quality === 'missing')) ctx.addIssue({ code: 'custom', path: ['quality'], message: 'A missing signal must have a null value and missing quality.' });
  if (signal.signalId === 'soil-moisture' && signal.value !== null && (signal.value < 0 || signal.value > 1)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Volumetric soil moisture must be between 0 and 1 m³/m³.' });
  if (signal.signalId === 'rainfall' && signal.value !== null && signal.value < 0) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Rainfall cannot be negative.' });
  if (signal.origin === 'nasa' && !/^https?:\/\//.test(signal.source.url)) ctx.addIssue({ code: 'custom', path: ['source', 'url'], message: 'NASA observations require a source URL.' });
});

const cropOptionSchema = z.object({ cropId: cropIdSchema, name: z.string().min(1), score: z.number().finite().min(0).max(100).nullable(), scoreStatus: z.enum(['complete', 'insufficient_data']), reasons: z.array(z.string().min(1)).min(1), recommendedPlantingDate: dateSchema.nullable().optional() }).passthrough().refine(option => (option.scoreStatus === 'complete') === (option.score !== null), 'An incomplete score must remain null.');
const rotationPlanSchema = z.object({ planId: z.enum(['current', 'save-water', 'improve-soil']), name: z.string().min(1), sequence: z.tuple([cropIdSchema, cropIdSchema]), reasons: z.array(z.string().min(1)).min(1), tradeoffs: z.array(z.string().min(1)).min(1), baselineOrigin: z.enum(['example', 'farmer']) }).passthrough();

export const analysisResultSchema = z.object({
  schemaVersion: z.literal('1.0'), analysisId: z.string().min(1), requestId: z.string().uuid(), farmId: z.string().min(1), boundaryVersion: z.number().int().min(1),
  areaHa: z.number().finite().positive(), generatedAt: isoSchema, dataMode: z.enum(['mock', 'nasa-cache', 'nasa-api']),
  signals: z.array(environmentalSignalSchema).min(1), cropOptions: z.array(cropOptionSchema).min(1), rotationPlans: z.array(rotationPlanSchema).length(3),
  assumptions: z.array(z.string()), limitations: z.array(z.string()),
}).passthrough().superRefine((result, ctx) => {
  if (result.dataMode === 'mock' && result.signals.some(s => s.origin !== 'synthetic')) ctx.addIssue({ code: 'custom', path: ['signals'], message: 'Demo analysis cannot claim authentic NASA observations.' });
  if (result.dataMode !== 'mock' && !result.signals.some(s => s.origin === 'nasa')) ctx.addIssue({ code: 'custom', path: ['signals'], message: 'NASA delivery requires an authentic NASA signal.' });
  if (new Set(result.signals.map(s => s.signalId)).size !== result.signals.length) ctx.addIssue({ code: 'custom', path: ['signals'], message: 'Signal identifiers must be unique.' });
  if (new Set(result.rotationPlans.map(p => p.planId)).size !== 3) ctx.addIssue({ code: 'custom', path: ['rotationPlans'], message: 'Three distinct rotation plans are required.' });
  if (new Set(result.cropOptions.map(p => p.cropId)).size !== result.cropOptions.length) ctx.addIssue({ code: 'custom', path: ['cropOptions'], message: 'Crop options must be unique.' });
  if (result.signals.some(s => s.quality !== 'good') && result.cropOptions.some(c => c.scoreStatus === 'complete')) ctx.addIssue({ code: 'custom', path: ['cropOptions'], message: 'Missing or outdated environmental inputs cannot produce a complete score.' });
});

function parseContract<T>(schema: z.ZodTypeAny, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`${label}: ${result.error.issues.map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join(' ')}`);
  return result.data as T;
}
export function validateAnalysisRequest(value: unknown): AnalysisRequest { return parseContract<AnalysisRequest>(analysisRequestSchema, value, 'Invalid analysis request'); }
export function validateAnalysisResult(value: unknown): AnalysisResult { return parseContract<AnalysisResult>(analysisResultSchema, value, 'Invalid analysis response'); }
export function validateFarmInputs(value: unknown): FarmInputs { return parseContract<FarmInputs>(farmInputsSchema, value, 'Check your farm information'); }
