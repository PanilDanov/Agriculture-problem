import type { Polygon } from 'geojson';
import type { AnalysisRequest, AnalysisResult, CropId, FarmInputs, ScenarioId } from './orbitFarm-types';
import { validateAnalysisRequest, validateAnalysisResult, validateBoundary } from './orbitFarm-validation';
import { CROP_CATALOG } from './orbitFarm-crop-catalog';
export { CROP_CATALOG } from './orbitFarm-crop-catalog';

export const SCENARIOS: Array<{ id: ScenarioId; name: string; description: string }> = [
  { id: 'dry-week', name: 'Dry week', description: 'Low soil moisture.' },
  { id: 'normal', name: 'Normal conditions', description: 'Complete demo observations.' },
  { id: 'missing-data', name: 'Missing observations', description: 'Missing soil moisture.' },
  { id: 'stale-data', name: 'Outdated observations', description: 'Outdated observations.' },
  { id: 'api-unavailable', name: 'Analysis unavailable', description: 'Failed analysis request.' },
  { id: 'empty-farm', name: 'Empty farm', description: 'No field or plantings.' },
];

export const DEMO_TODAY = '2026-11-14';
export const DEMO_NOW = '2026-11-14T12:00:00.000Z';
export const DEMO_BOUNDARY: Polygon = { type: 'Polygon', coordinates: [[[34.79, 30.85], [34.79235, 30.85], [34.79235, 30.852], [34.79, 30.852], [34.79, 30.85]]] };
export const DEFAULT_INPUTS: FarmInputs = {
  soil: { ph: 7.5, texture: 'sandy_loam', source: 'synthetic' },
  irrigation: { availability: 'available', method: 'drip', volumeM3: 10000 },
  previousCropId: 'wheat', priority: 'save_water',
};

export function makeMockAnalysis(value: AnalysisRequest, scenario: ScenarioId): AnalysisResult {
  const request = validateAnalysisRequest(value);
  const missing = scenario === 'missing-data';
  const stale = scenario === 'stale-data';
  const dry = scenario === 'dry-week';
  const complete = !missing && !stale && request.localInputs.soil.ph !== null && request.localInputs.soil.texture !== null && request.localInputs.irrigation.availability !== 'unknown' && request.localInputs.irrigation.waterBudget !== null && (request.localInputs.irrigation.method === 'drip' || request.localInputs.irrigation.applicationEfficiency !== null);
  const observationDate = stale ? '2026-10-01T06:00:00.000Z' : '2026-11-13T06:00:00.000Z';
  const quality = stale ? 'stale' : 'good';
  const source = { dataset: `orbitFarm ${scenario} synthetic fixture`, url: `fixture://orbitFarm/${scenario}`, version: 'demo-v1' };
  const profiles: Partial<Record<CropId, [number, number, number]>> = { wheat: [76, 65, 82], chickpea: [87, 84, 88], sorghum: [92, 96, 80] };
  const plantingDates: Partial<Record<CropId, string>> = { wheat: '2026-11-20', chickpea: '2026-12-01', sorghum: '2027-04-01' };
  const ph = request.localInputs.soil.ph;
  const soilPh = ph === null ? 0 : Math.max(0, 100 - Math.abs(ph - 6.8) * 18);
  const waterKnownZero = request.localInputs.irrigation.waterBudget?.volumeM3 === 0;
  const cropOptions = CROP_CATALOG.flatMap(crop => {
    const profile = profiles[crop.id];
    if (!profile) return [];
    const [temperature, water, soilTexture] = profile;
    const score = complete ? Math.round(.35 * temperature + .25 * soilPh + .30 * (waterKnownZero ? 0 : water) + .10 * soilTexture) : null;
    return [{
      cropId: crop.id, name: crop.name, recommendedPlantingDate: complete ? plantingDates[crop.id] ?? null : null, score, scoreStatus: score === null ? 'insufficient_data' as const : 'complete' as const,
      reasons: score === null
        ? [stale ? 'The regional observation is outdated. A fresh observation is needed before scoring.' : missing ? 'Regional soil moisture is missing. Missing data is not zero moisture.' : 'Add the missing soil or irrigation information to complete the four-factor comparison.', 'This is a synthetic example, not an agronomic recommendation.']
        : [crop.id === 'sorghum' ? 'Lower water demand in this synthetic comparison.' : crop.id === 'chickpea' ? 'Adds a legume to the example rotation.' : 'A familiar baseline for comparing the next season.', 'Based on simulated regional conditions and the entered field information.'],
    }];
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const current = request.localInputs.currentPlan;
  return validateAnalysisResult({
    schemaVersion: '1.0', analysisId: `demo-${request.requestId}`, requestId: request.requestId, farmId: request.farmId,
    boundaryVersion: request.boundaryVersion, areaHa: validateBoundary(request.boundary).areaHa, generatedAt: DEMO_NOW, dataMode: 'mock',
    signals: [
      { signalId: 'soil-moisture', label: 'Soil moisture', value: missing ? null : dry ? .18 : .26, unit: 'm³/m³', origin: 'synthetic', observedAt: observationDate, fetchedAt: DEMO_NOW, quality: missing ? 'missing' : quality, spatialResolutionKm: 9, source },
      { signalId: 'temperature', label: 'Temperature', value: dry ? 28 : 23, unit: '°C', origin: 'synthetic', observedAt: observationDate, fetchedAt: DEMO_NOW, quality, spatialResolutionKm: 50, source },
      { signalId: 'rainfall', label: 'Recent rainfall', value: dry ? .7 : 12, unit: 'mm', origin: 'synthetic', observedAt: observationDate, fetchedAt: DEMO_NOW, quality, spatialResolutionKm: 10, source },
    ],
    cropOptions,
    rotationPlans: [
      { planId: 'current', name: current ? 'Current plan' : 'Example current plan', sequence: current ? [current.find(p => p.seasonIndex === 1)!.cropId, current.find(p => p.seasonIndex === 2)!.cropId] : ['wheat', 'wheat'], reasons: ['A baseline to make the alternatives easier to compare.'], tradeoffs: [current ? 'A farmer-entered comparison baseline.' : 'Repeated crop family in this example.', 'Review local soil and crop history.'], baselineOrigin: current ? 'farmer' : 'example' },
      { planId: 'save-water', name: 'Save water', sequence: ['sorghum', 'chickpea'], reasons: ['Explore lower water demand in this synthetic scenario.'], tradeoffs: ['Two crop families across two seasons.', 'Actual irrigation needs require local validation.'], baselineOrigin: 'example' },
      { planId: 'improve-soil', name: 'Improve soil', sequence: ['chickpea', 'wheat'], reasons: ['Include a legume in the illustrative sequence.'], tradeoffs: ['More crop diversity than the example baseline.', 'Soil nutrient decisions still need a soil test.'], baselineOrigin: 'example' },
    ],
    assumptions: [
      'All environmental observations, crop profiles, and planting dates in this analysis are synthetic demo fixtures.',
      'Illustrative scoring weights: temperature 35%, soil pH 25%, water 30%, and soil texture 10%. The score is not a probability.',
      ...(request.localInputs.irrigation.method === 'drip' && request.localInputs.irrigation.applicationEfficiency === null ? ['The demo assumes 0.90 application efficiency for drip irrigation. This is an explicit demo assumption, not a field measurement.'] : []),
    ],
    limitations: ['Regional observations do not measure every planting area.', 'No yield, income, fertilizer dosage, or live satellite forecast is predicted.', 'Rotation examples need local crop and soil review.'],
  });
}
