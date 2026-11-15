import type { Polygon } from 'geojson';

import type { CROP_IDS } from './orbitFarm-crop-catalog';

export type CropId = (typeof CROP_IDS)[number];
export type ScenarioId = 'normal' | 'dry-week' | 'missing-data' | 'stale-data' | 'api-unavailable' | 'empty-farm';
export type Priority = 'balanced' | 'save_water' | 'improve_soil';

export interface Crop {
  id: CropId;
  name: string;
  daysToGrowing: number;
  daysToHarvest: number;
  color: string;
  description: string;
}

export interface FarmInputs {
  soil: { ph: number | null; texture: string | null; source?: 'farmer_reported' | 'soil_test' | 'synthetic' | 'unknown'; sampledOn?: string | null };
  irrigation: {
    availability: 'available' | 'none' | 'unknown';
    method: 'drip' | 'sprinkler' | 'surface' | null;
    volumeM3: number | null;
    applicationEfficiency?: number | null;
    periodStart?: string | null;
    periodEnd?: string | null;
  };
  previousCropId: CropId | null;
  priority: Priority;
  currentPlan?: Array<{ seasonIndex: number; cropId: CropId }> | null;
  fieldObservations?: FieldObservations | null;
  seasonalWaterBalance?: FieldObservations['seasonalWaterBalance'];
  yieldForecast?: { mode: 'auto' | 'annual_history' | 'pre_season' | 'mid_season'; harvestYear?: number | null };
  agroEcologicalZone?: string | null;
}

export interface FieldObservations {
  observedOn: string;
  cropId: CropId;
  variant?: string | null;
  stage: 'initial' | 'development' | 'mid_season' | 'late';
  stageProgress?: number | null;
  et0MmDay?: number | null;
  applicationEfficiency?: number | null;
  source: string;
  rootZoneLayers?: Array<{ thicknessM: number; thetaFc: number; thetaWp: number; thetaNow: number | null }>;
  seasonalWaterBalance?: Array<{ cropId: CropId; periodStart: string; periodEnd: string; netIrrigationRequirementMm: number; source: string; method: string }>;
}

export interface AnalysisRequest {
  schemaVersion: '1.0';
  requestId: string;
  farmId: string;
  boundaryVersion: number;
  boundary: Polygon;
  regionLabel: string;
  localInputs: {
    soil: { ph: number | null; texture: string | null; source: 'farmer_reported' | 'soil_test' | 'synthetic' | 'unknown'; sampledOn: string | null };
    irrigation: {
      availability: FarmInputs['irrigation']['availability'];
      method: FarmInputs['irrigation']['method'];
      waterBudget: { volumeM3: number; basis: 'field_inlet'; periodStart?: string | null; periodEnd?: string | null } | null;
      applicationEfficiency: number | null;
    };
    previousCropId: CropId | null;
    currentPlan: null | Array<{ seasonIndex: number; cropId: CropId }>;
    fieldObservations?: FieldObservations | null;
    seasonalWaterBalance?: FieldObservations['seasonalWaterBalance'];
    agroEcologicalZone?: string | null;
  };
  priorities: [Priority];
  yieldForecast?: FarmInputs['yieldForecast'];
}

export interface EnvironmentalSignal {
  signalId: string;
  label: string;
  value: number | null;
  unit: string;
  origin: 'synthetic' | 'nasa';
  observedAt: string;
  fetchedAt: string;
  quality: 'good' | 'missing' | 'stale';
  spatialResolutionKm: number | null;
  source: { dataset: string; url: string; version: string };
}

export interface CropOption {
  cropId: CropId;
  name: string;
  score: number | null;
  scoreStatus: 'complete' | 'insufficient_data';
  reasons: string[];
  recommendedPlantingDate?: string | null;
  evaluationStatus?: 'evaluated' | 'insufficient_data' | 'excluded';
  componentScores?: Record<string, number | null>;
  knownWeight?: number;
  missingFields?: string[];
  exclusionReasons?: string[];
  scoringModelVersion?: string;
}

export interface RotationPlan {
  planId: string;
  name: string;
  sequence: [CropId, CropId];
  reasons: string[];
  tradeoffs: string[];
  baselineOrigin: 'example' | 'farmer';
  planStatus?: 'supported' | 'provisional';
  waterScreenMm?: number | null;
  seasons?: [RotationSeason, RotationSeason];
}

export interface RotationSeason {
  cropId: CropId;
  recommendedPlantingDate: string | null;
  calendarHarvestDate: string | null;
  calendarSource: string | null;
  calendarScope: string | null;
}

export interface AnalysisResult {
  schemaVersion: '1.0';
  analysisId: string;
  requestId: string;
  farmId: string;
  boundaryVersion: number;
  areaHa: number;
  generatedAt: string;
  dataMode: 'mock' | 'nasa-cache' | 'nasa-api';
  signals: EnvironmentalSignal[];
  cropOptions: CropOption[];
  rotationPlans: RotationPlan[];
  assumptions: string[];
  limitations: string[];
  yieldForecasts?: YieldForecast[];
  irrigationAssessment?: IrrigationAssessment;
  modelVersion?: string;
  recentWeather?: { status: string; periodStart?: string; periodEnd?: string; meanTemperatureC?: number | null; precipitationMm?: number | null; latestEt0MmDay?: number | null; observedOn?: string | null; source?: string };
}

export interface YieldForecast {
  cropId: CropId;
  status: 'available' | 'unavailable';
  harvestYear?: number;
  mode?: string;
  reason?: string;
  code?: string;
  forecast?: {
    crop: string; mode: string; predicted_yield_t_ha: number; spatial_level: 'country' | 'administrative_region';
    model_version: string; warnings: string[]; prediction_interval_t_ha?: [number, number] | null;
    country_code?: string; harvest_year?: number; data_through?: string | number; last_observed_year?: number;
    source?: string | Record<string, unknown>; experimental?: boolean;
    [key: string]: unknown;
  };
  diagnostics?: Record<string, unknown> | null;
}

export interface IrrigationAssessment {
  status: string;
  missingFields?: string[];
  limitations?: string[];
  [key: string]: unknown;
}

export interface Plot {
  id: string;
  slotId: number;
  cropId: CropId;
  plantedOn: string;
  estimatedHarvestOn?: string;
  rotation?: PlotRotation;
}

export interface PlotRotation {
  analysisId: string;
  planId: string;
  planName: string;
  seasonIndex: 0 | 1;
}

export interface HarvestRecord {
  id: string;
  plotId: string;
  slotId: number;
  bedName: string;
  cropId: CropId;
  plantedOn: string;
  harvestedOn: string;
  estimatedHarvestOn?: string;
  rotation?: PlotRotation;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface FarmBed {
  slotId: number;
  name: string;
  points: LayoutPoint[];
}

export interface FarmLayout {
  width: 24;
  height: 12;
  beds: FarmBed[];
}

export interface CareTask {
  id: string;
  plotId: string;
  kind: 'water' | 'soil';
  title: string;
  reason: string;
  dueOn: string;
  status: 'open' | 'done' | 'skipped' | 'snoozed';
  snoozedUntil: string | null;
}

export interface JournalEntry {
  id: string;
  taskId: string | null;
  plotId: string;
  action: 'watered' | 'done' | 'skipped' | 'snoozed';
  createdOn: string;
  undone: boolean;
  previousStatus?: CareTask['status'];
  previousSnoozedUntil?: string | null;
}

export interface FarmState {
  version: 3;
  farmId: string;
  name: string;
  boundary: Polygon | null;
  boundaryVersion: number;
  inputs: FarmInputs;
  analysis: AnalysisResult | null;
  layout: FarmLayout;
  plots: Plot[];
  tasks: CareTask[];
  journal: JournalEntry[];
  harvests: HarvestRecord[];
  demoToday: string;
  scenarioId: ScenarioId;
  selectedPlanId: string | null;
  pendingRequestId: string | null;
  analysisError: string | null;
}

export type FarmAction =
  | { type: 'set_name'; name: string }
  | { type: 'set_boundary'; boundary: Polygon }
  | { type: 'set_inputs'; inputs: FarmInputs }
  | { type: 'analysis_started'; requestId: string }
  | { type: 'analysis_received'; analysis: AnalysisResult }
  | { type: 'analysis_failed'; requestId: string; message: string }
  | { type: 'select_plan'; planId: string }
  | { type: 'set_layout'; layout: FarmLayout }
  | { type: 'plant'; slotId: number; cropId: CropId; plantedOn: string }
  | { type: 'edit_plot'; plotId: string; cropId: CropId; plantedOn: string }
  | { type: 'remove_plot'; plotId: string }
  | { type: 'harvest'; plotId: string; harvestedOn?: string }
  | { type: 'complete_task'; taskId: string }
  | { type: 'record_watering'; plotId: string }
  | { type: 'skip_task'; taskId: string }
  | { type: 'snooze_task'; taskId: string }
  | { type: 'undo_action'; entryId: string }
  | { type: 'advance_day' };

export interface AnalysisProvider {
  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ProviderSettings {
  mode: 'mock' | 'api';
  baseUrl: string;
}

export interface ProviderSettingsLoadResult {
  settings: ProviderSettings | null;
  error: string | null;
}
