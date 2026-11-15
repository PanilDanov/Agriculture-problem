import { useId, useState } from 'react';
import profiles from '../../agronomy/crop_profiles.json';
import { CROP_CATALOG } from '../domain/orbitFarm-crop-catalog';
import type { CropId, FarmInputs, FieldObservations } from '../domain/orbitFarm-types';
import { Select } from './orbitFarm-select';
import './orbitFarm-evidence-fields.css';

type Layer = NonNullable<FieldObservations['rootZoneLayers']>[number];
type Balance = NonNullable<FieldObservations['seasonalWaterBalance']>[number];
const STAGES: Array<{ value: FieldObservations['stage']; label: string }> = [
  { value: 'initial', label: 'Initial stage' }, { value: 'development', label: 'Development' },
  { value: 'mid_season', label: 'Mid-season' }, { value: 'late', label: 'Late season' },
];

function numericValue(value: number | null | undefined): number | '' { return typeof value === 'number' && Number.isFinite(value) ? value : ''; }
function requiredNumber(value: string): number { return value.trim() === '' ? Number.NaN : Number(value); }
function optionalNumber(value: string): number | null { return value.trim() === '' ? null : Number(value); }

const CROP_OPTIONS = [{ value: '', label: 'Choose a crop' }, ...CROP_CATALOG.map(crop => ({ value: crop.id, label: crop.name }))];

function NumericField({ label, value, onChange, min, max, step = '0.01', required = false, hint }: {
  label: string; value: number | null | undefined; onChange: (value: string) => void; min?: number; max?: number;
  step?: string; required?: boolean; hint?: string;
}) {
  const id = useId();
  return <div className="of-evidence-numeric"><label htmlFor={id}>{label}<input id={id} type="number" value={numericValue(value)} onChange={event => onChange(event.target.value)}
    min={min} max={max} step={step} required={required} placeholder={required ? 'Enter measured value' : 'Unknown'} aria-describedby={hint ? `${id}-hint` : undefined} /></label>
    {hint && <p className="of-evidence-hint" id={`${id}-hint`}>{hint}</p>}</div>;
}

export function FieldEvidenceFields({ inputs, onChange }: { inputs: FarmInputs; onChange: (inputs: FarmInputs) => void }) {
  const id = useId();
  const [soilEvidenceOpen, setSoilEvidenceOpen] = useState(false);
  const observations = inputs.fieldObservations;
  const balances = inputs.seasonalWaterBalance ?? observations?.seasonalWaterBalance ?? [];
  const irrigated = inputs.irrigation.availability === 'available';
  const currentPlan = inputs.currentPlan;
  const variants: Record<string, { label: string }> = observations?.cropId ? profiles.crops[observations.cropId]?.irrigation.variants ?? {} : {};
  const updateObservations = (patch: Partial<FieldObservations>) => {
    if (observations) onChange({ ...inputs, fieldObservations: { ...observations, ...patch } });
  };
  const updateLayer = (index: number, patch: Partial<Layer>) => updateObservations({
    rootZoneLayers: observations?.rootZoneLayers?.map((layer, position) => position === index ? { ...layer, ...patch } : layer),
  });
  const updateBalances = (next: Balance[]) => onChange({ ...inputs, seasonalWaterBalance: next });
  const updateBalance = (index: number, patch: Partial<Balance>) => updateBalances(
    balances.map((balance, position) => position === index ? { ...balance, ...patch } : balance),
  );
  const planCrop = (seasonIndex: number, crop: string) => {
    const plan = (currentPlan ?? []).filter(entry => entry.seasonIndex !== seasonIndex);
    if (crop) plan.push({ seasonIndex, cropId: crop as CropId });
    onChange({ ...inputs, currentPlan: plan.sort((first, second) => first.seasonIndex - second.seasonIndex) });
  };
  return <div className="of-evidence-fields">
    <details className="of-evidence-section"><summary>Forecast settings & existing plan</summary><div className="of-evidence-content">
      <p className="of-evidence-hint">Add the context you know. Missing observations stay unknown.</p>
      <div className="of-evidence-row"><Select label="Forecast mode" value={inputs.yieldForecast?.mode ?? 'auto'} onChange={value => onChange({ ...inputs, yieldForecast: { ...inputs.yieldForecast, mode: value as NonNullable<FarmInputs['yieldForecast']>['mode'] } })}
        options={[{ value: 'auto', label: 'Automatic, based on available evidence' }, { value: 'annual_history', label: 'Annual yield history · all crops' },
          { value: 'pre_season', label: 'Regional pre-season' }, { value: 'mid_season', label: 'Regional mid-season' }]} /><NumericField label="Harvest year" value={inputs.yieldForecast?.harvestYear} min={2000} max={2100} step="1"
        hint="Leave blank to use next year." onChange={value => onChange({ ...inputs, yieldForecast: { mode: inputs.yieldForecast?.mode ?? 'auto', harvestYear: optionalNumber(value) } })} /></div>
      <p className="of-evidence-hint">Regional wheat and maize forecasts need compatible regional observations. Annual estimates use reported national yield history.</p>
      <label>Confirmed agroecological zone<input aria-label="Confirmed agroecological zone" value={inputs.agroEcologicalZone ?? ''} maxLength={100} placeholder="Unknown" onChange={event => onChange({ ...inputs, agroEcologicalZone: event.target.value.trim() || null })} />
        <span className="of-evidence-hint">Enter a verified FAO zone identifier only if known. A zone can help qualify planting calendars.</span></label>
      <label className="of-evidence-toggle"><input type="checkbox" checked={currentPlan !== undefined && currentPlan !== null} onChange={event => onChange({ ...inputs, currentPlan: event.target.checked ? [] : null })} /><span>Compare my existing two-season plan</span></label>
      {currentPlan !== undefined && currentPlan !== null && <div className="of-evidence-row"><Select label="Existing plan · season 1" value={currentPlan.find(entry => entry.seasonIndex === 1)?.cropId ?? ''} onChange={value => planCrop(1, value)} options={CROP_OPTIONS} />
        <Select label="Existing plan · season 2" value={currentPlan.find(entry => entry.seasonIndex === 2)?.cropId ?? ''} onChange={value => planCrop(2, value)} options={CROP_OPTIONS} /></div>}
    </div></details>

    <details className="of-evidence-section" onToggle={event => setSoilEvidenceOpen(event.currentTarget.open)}><summary>Water allocation & soil evidence</summary>{soilEvidenceOpen && <div className="of-evidence-content">
      <div className="of-evidence-row"><Select label="Soil information source" value={inputs.soil.source ?? 'unknown'} onChange={value => onChange({ ...inputs, soil: { ...inputs.soil, source: value as FarmInputs['soil']['source'] } })}
        options={[{ value: 'unknown', label: 'Unknown' }, { value: 'farmer_reported', label: 'Farmer reported' }, { value: 'soil_test', label: 'Soil test' }, ...(inputs.soil.source === 'synthetic' ? [{ value: 'synthetic', label: 'Demo data' }] : [])]} /><label>Soil test / sample date<input type="date" value={inputs.soil.sampledOn ?? ''} onChange={event => onChange({ ...inputs, soil: { ...inputs.soil, sampledOn: event.target.value || null } })} /></label></div>
      {irrigated ? <>
        <NumericField label="Application efficiency (%)" value={inputs.irrigation.applicationEfficiency == null ? null : inputs.irrigation.applicationEfficiency * 100} min={1} max={100} step="1"
          hint="Use a measured or documented efficiency, including field application losses." onChange={value => onChange({ ...inputs, irrigation: { ...inputs.irrigation, applicationEfficiency: value === '' ? null : Number(value) / 100 } })} />
        <div className="of-evidence-row"><label>Water allocation starts<input type="date" value={inputs.irrigation.periodStart ?? ''} onChange={event => onChange({ ...inputs, irrigation: { ...inputs.irrigation, periodStart: event.target.value || null } })} /></label>
          <label>Water allocation ends<input type="date" value={inputs.irrigation.periodEnd ?? ''} onChange={event => onChange({ ...inputs, irrigation: { ...inputs.irrigation, periodEnd: event.target.value || null } })} /></label></div>
        <p className="of-evidence-hint">These dates apply to the whole-field water budget above. Seasonal adequacy needs a net requirement for the same crop and period.</p>
      </> : <p className="of-evidence-hint">Select irrigation access above to add a dated allocation and efficiency.</p>}
    </div>}</details>

    <details className="of-evidence-section"><summary>Measured water needs & root zone</summary><div className="of-evidence-content">
      <p className="of-evidence-hint">Current water assessment uses dated field measurements. Add only observed or documented values.</p>
      <label className="of-evidence-toggle"><input type="checkbox" checked={Boolean(observations)} onChange={event => onChange({ ...inputs,
        seasonalWaterBalance: inputs.seasonalWaterBalance ?? observations?.seasonalWaterBalance, fieldObservations: event.target.checked
        ? { observedOn: '', cropId: '' as CropId, stage: '' as FieldObservations['stage'], source: '', et0MmDay: null, rootZoneLayers: [] } : null })} /><span>Add field water observations</span></label>
      {observations && <div className="of-evidence-observations" role="group" aria-label="Field water observations" aria-describedby={`${id}-measurement-help`}>
        <div className="of-evidence-row"><label>Observation date<input type="date" value={observations.observedOn} onChange={event => updateObservations({ observedOn: event.target.value })} required /></label>
          <Select label="Measured crop" value={observations.cropId} onChange={value => updateObservations({ cropId: value as CropId, variant: null })} options={CROP_OPTIONS} /></div>
        <label>Observation source<input value={observations.source} placeholder="For example, field sensor or soil test" maxLength={300} onChange={event => updateObservations({ source: event.target.value })} required /></label>
        <div className="of-evidence-row"><Select label="Measured growth stage" value={observations.stage} onChange={value => updateObservations({ stage: value as FieldObservations['stage'], stageProgress: null })}
          options={[{ value: '', label: 'Choose a stage' }, ...STAGES]} /><Select label="Crop / harvest variant" value={observations.variant ?? ''} onChange={value => updateObservations({ variant: value || null })}
          options={[{ value: '', label: Object.keys(variants).length === 1 ? 'Single reference profile' : 'Choose a reference profile' }, ...Object.entries(variants).map(([value, variant]) => ({ value, label: variant.label }))]} /></div>
        {(observations.stage === 'development' || observations.stage === 'late') && <NumericField label="Progress through this stage (%)" value={observations.stageProgress == null ? null : observations.stageProgress * 100}
          min={0} max={100} step="1" required onChange={value => updateObservations({ stageProgress: value === '' ? null : Number(value) / 100 })} />}
        <NumericField label="Reference evapotranspiration (mm/day)" value={observations.et0MmDay} min={0} max={50} step="0.1" onChange={value => updateObservations({ et0MmDay: optionalNumber(value) })}
          hint="Use reference ET for the measurement day. Historical annual averages are not a current reading." />
        <div className="of-evidence-subheading"><h3>Active-root soil layers</h3><span>m³/m³ water content</span></div>
        <p className="of-evidence-hint">Add layers from shallow to deep, covering the active roots. Unknown current moisture leaves the refill estimate unavailable.</p>
        {(observations.rootZoneLayers ?? []).map((layer, index) => <fieldset key={index} className="of-evidence-record"><legend>Root-zone layer {index + 1}</legend>
          <div className="of-evidence-record-actions"><button type="button" className="of-evidence-remove" aria-label={`Remove root-zone layer ${index + 1}`} onClick={() => updateObservations({ rootZoneLayers: observations.rootZoneLayers?.filter((_, position) => position !== index) })}>Remove layer</button></div>
          <div className="of-evidence-row"><NumericField label="Layer thickness (m)" value={layer.thicknessM} min={0.001} max={3} required onChange={value => updateLayer(index, { thicknessM: requiredNumber(value) })} />
            <NumericField label="Water content at field capacity" value={layer.thetaFc} min={0} max={1} required onChange={value => updateLayer(index, { thetaFc: requiredNumber(value) })} /></div>
          <div className="of-evidence-row"><NumericField label="Water content at wilting point" value={layer.thetaWp} min={0} max={1} required onChange={value => updateLayer(index, { thetaWp: requiredNumber(value) })} />
            <NumericField label="Current measured water content" value={layer.thetaNow} min={0} max={1} onChange={value => updateLayer(index, { thetaNow: optionalNumber(value) })} /></div>
        </fieldset>)}
        <button type="button" className="button secondary of-evidence-add" onClick={() => updateObservations({ rootZoneLayers: [...observations.rootZoneLayers ?? [], { thicknessM: Number.NaN, thetaFc: Number.NaN, thetaWp: Number.NaN, thetaNow: null }] })}>Add measured soil layer</button>
        <p className="of-evidence-hint" id={`${id}-measurement-help`}>Complete each added soil layer or remove it before analyzing. Empty measurements are never replaced with zero.</p>
      </div>}
    </div></details>

    <details className="of-evidence-section"><summary>Seasonal crop water balance</summary><div className="of-evidence-content">
        <p className="of-evidence-hint">Add a documented net irrigation requirement for a crop and season. A local water balance should account for effective rainfall and root-zone storage. Daily field observations are not required for this planning assessment.</p>
        {balances.map((balance, index) => <fieldset className="of-evidence-record" key={index}><legend>Seasonal water assessment {index + 1}</legend>
          <div className="of-evidence-record-actions"><button type="button" className="of-evidence-remove" aria-label={`Remove seasonal water assessment ${index + 1}`} onClick={() => updateBalances(balances.filter((_, position) => position !== index))}>Remove assessment</button></div>
          <Select label="Seasonal water crop" value={balance.cropId} onChange={value => updateBalance(index, { cropId: value as CropId })} options={CROP_OPTIONS} />
          <div className="of-evidence-row"><label>Season starts<input type="date" value={balance.periodStart} onChange={event => updateBalance(index, { periodStart: event.target.value })} required /></label>
            <label>Season ends<input type="date" value={balance.periodEnd} onChange={event => updateBalance(index, { periodEnd: event.target.value })} required /></label></div>
          <NumericField label="Net irrigation requirement (mm)" value={balance.netIrrigationRequirementMm} min={0} max={10000} step="0.1" required onChange={value => updateBalance(index, { netIrrigationRequirementMm: requiredNumber(value) })} />
          <label>Water balance source<input value={balance.source} placeholder="Source of the local assessment" maxLength={300} onChange={event => updateBalance(index, { source: event.target.value })} required /></label>
          <label>Water balance method<input value={balance.method} placeholder="How effective rainfall and soil storage were accounted for" maxLength={500} onChange={event => updateBalance(index, { method: event.target.value })} required /></label>
        </fieldset>)}
        <button type="button" className="button secondary of-evidence-add" onClick={() => updateBalances([...balances, { cropId: observations?.cropId ?? '' as CropId, periodStart: '', periodEnd: '', netIrrigationRequirementMm: Number.NaN, source: '', method: '' }])}>Add seasonal water assessment</button>
        {balances.length > 0 && <p className="of-evidence-hint">Complete each added seasonal assessment or remove it before analyzing. Unknown requirements are never replaced with zero.</p>}
    </div></details>
  </div>;
}
