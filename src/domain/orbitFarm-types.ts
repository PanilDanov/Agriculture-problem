import type { Polygon } from 'geojson';

export type CropId = 'wheat' | 'chickpea' | 'sorghum';
export type ScenarioId = 'normal' | 'dry-week' | 'missing-data' | 'stale-data' | 'api-unavailable' | 'empty-farm';
export type Priority = 'balanced' | 'save_water' | 'improve_soil';

export interface Crop {
  id: CropId;
  name: string;
  daysToHarvest: number;
  color: string;
  description: string;
}

export interface FarmInputs {
  season: { plantingDate: string; endDate: string };
  soil: { ph: number | null; texture: string | null; source?: 'farmer_reported' | 'soil_test' | 'synthetic' | 'unknown' };
  irrigation: {
    availability: 'available' | 'none' | 'unknown';
    method: 'drip' | 'sprinkler' | 'surface' | null;
    volumeM3: number | null;
  };
  previousCropId: CropId | null;
  priority: Priority;
}

export interface AnalysisRequest {
  schemaVersion: '1.0';
  requestId: string;
  farmId: string;
  boundaryVersion: number;
  boundary: Polygon;
  regionLabel: string;
  farmTimeZone: string;
  season: FarmInputs['season'];
  localInputs: {
    soil: { ph: number | null; texture: string | null; source: 'farmer_reported' | 'soil_test' | 'synthetic' | 'unknown'; sampledOn: string | null };
    irrigation: {
      availability: FarmInputs['irrigation']['availability'];
      method: FarmInputs['irrigation']['method'];
      waterBudget: { volumeM3: number; periodStartDate: string; periodEndDate: string; basis: 'field_inlet' } | null;
      applicationEfficiency: number | null;
    };
    previousCropId: CropId | null;
    currentPlan: null | Array<{ seasonIndex: number; cropId: CropId }>;
  };
  priorities: [Priority];
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
}

export interface RotationPlan {
  planId: string;
  name: string;
  sequence: [CropId, CropId];
  reasons: string[];
  tradeoffs: string[];
  baselineOrigin: 'example' | 'farmer';
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
}

export interface Plot {
  id: string;
  slotId: number;
  cropId: CropId;
  plantedOn: string;
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
  dueAtISO: string;
  status: 'open' | 'done' | 'skipped' | 'snoozed';
  snoozedUntilISO: string | null;
}

export interface JournalEntry {
  id: string;
  taskId: string;
  plotId: string;
  action: 'watered' | 'done' | 'skipped' | 'snoozed';
  createdAtISO: string;
  undone: boolean;
  previousStatus?: CareTask['status'];
  previousSnoozedUntilISO?: string | null;
}

export interface FarmState {
  version: 2;
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
  demoNow: string;
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
  | { type: 'complete_task'; taskId: string }
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
