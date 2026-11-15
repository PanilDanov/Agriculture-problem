import { useId } from 'react';
import { CROP_CATALOG } from '../domain/orbitFarm-crop-catalog';
import type { AnalysisResult, CropOption, IrrigationAssessment, YieldForecast } from '../domain/orbitFarm-types';
import { CropSprite } from './orbitFarm-crop-sprite';
import './orbitFarm-analysis-details.css';

const FACTORS: Record<string, string> = { temperature: 'Temperature', soilPh: 'Soil pH', water: 'Water adequacy', soilTexture: 'Soil texture' };
const IRRIGATION_STATUSES: Record<string, string> = {
  ready: 'Measured water assessment', needs_observations: 'Add field measurements', needs_variant: 'Choose a crop variant',
  needs_root_zone_layers: 'Add active-root soil layers', needs_root_zone_moisture: 'Current root-zone moisture is missing',
  stale_observations: 'Measurements need updating', invalid_observations: 'Check the field measurements',
};

export function analysisDate(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string' || !value) return 'Unavailable';
  if (/^\d{4}$/.test(value)) return value;
  const calendar = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendar)) return value;
  const parsed = new Date(`${calendar}T12:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === calendar
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed) : 'Unavailable';
}

export function analysisNumber(value: unknown, decimals = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: decimals }).format(value) : 'Unavailable';
}

export function analysisTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || analysisDate(value) === 'Unavailable') return 'Unavailable';
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf())
    ? `${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(parsed)} UTC`
    : 'Unavailable';
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function words(value: string): string { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '); }

function fieldLabel(field: string): string {
  const names: Record<string, string> = {
    fieldObservations: 'Dated field measurements', observedOn: 'Measurement date', source: 'Measurement source', cropId: 'Crop',
    stage: 'Growth stage', stageProgress: 'Progress through the growth stage', et0MmDay: 'Daily reference evapotranspiration',
    variant: 'Crop and harvest variant', rootZoneLayers: 'Active-root soil layers', thetaNow: 'Current moisture in every active-root layer',
    applicationEfficiency: 'Irrigation efficiency', fieldAreaHa: 'Field area', cropSeason: 'Planting and harvest dates',
    documentedSeasonalNetIrrigationRequirement: 'A sourced seasonal net irrigation requirement', matchingAllocationPeriod: 'A matching allocation period',
    waterBudget: 'Water allocation', volumeM3: 'Total available water', soilPh: 'Soil pH', soilTexture: 'Soil texture',
    temperature: 'Historical crop-season temperature', water: 'Seasonal water adequacy',
  };
  const end = field.split('.').at(-1) ?? field;
  return names[end] ?? words(end);
}

function sourceDetails(source: unknown): { label?: string; href?: string; published?: string } {
  if (typeof source === 'string') return { label: source, href: /^https?:\/\//i.test(source) ? source : undefined };
  const record = object(source);
  const href = [record.url, record.download_url, record.source_url, record.source_reference, record.reference].find(value => typeof value === 'string' && /^https?:\/\//i.test(value));
  return {
    label: text(record.dataset) ?? text(record.name) ?? text(record.title) ?? text(record.publisher) ?? text(record.product),
    href: typeof href === 'string' ? href : undefined,
    published: text(record.published_on),
  };
}

function Source({ value }: { value: unknown }) {
  const source = sourceDetails(value);
  if (!source.label && !source.href) return null;
  return <p className="of-analysis-source">Source: {source.href
    ? <a href={source.href} target="_blank" rel="noreferrer noopener">{source.label ?? 'Source dataset'}</a> : source.label}
    {source.published && <> · published {analysisDate(source.published)}</>}</p>;
}

function ForecastCard({ cropId, name, entry }: { cropId: YieldForecast['cropId']; name: string; entry?: YieldForecast }) {
  const forecast = entry?.status === 'available' ? entry.forecast : undefined;
  const ready = forecast !== undefined && number(forecast.predicted_yield_t_ha) !== null;
  const quality = text(forecast?.quality_status);
  const experimental = Boolean(forecast?.experimental || forecast?.mode.includes('cold_start') || forecast?.mode.includes('_v2')
    || (quality && quality !== 'beats_last_yield_on_holdout'));
  const diagnostics = object(entry?.diagnostics);
  const replay = forecast?.is_replay === true || forecast?.temporal_status === 'retrospective_estimate'
    || diagnostics.isReplay === true || diagnostics.temporalStatus === 'retrospective_estimate';
  const forecastDate = forecast?.forecast_date ?? diagnostics.forecastDate;
  const calculatedAt = forecast?.calculated_at ?? diagnostics.calculatedAt;
  const validation = object(forecast?.validation);
  const holdout = Object.keys(object(validation.holdout)).length ? object(validation.holdout) : validation;
  const source = forecast?.source ?? diagnostics.source;
  const dataThrough = forecast?.data_through ?? forecast?.last_observed_year ?? diagnostics.dataThrough;
  const mode = forecast?.mode ?? entry?.mode;
  const modeLabel = mode === 'annual_history' ? 'Annual yield history' : mode?.includes('mid_season') ? 'Mid-season' : mode?.includes('pre_season') ? 'Pre-season' : 'Forecast';
  const spatialLabel = forecast?.spatial_level === 'country' ? 'National estimate' : 'Regional estimate';
  const warnings = forecast?.warnings ?? [];
  return <article className={`of-yield-card ${ready ? 'of-yield-card--ready' : 'of-yield-card--missing'}`} aria-label={`${name} yield forecast`}>
    <header><CropSprite cropId={cropId} size={36} /><div><h3>{name}</h3><span className="of-analysis-caption">{ready ? spatialLabel : 'Forecast unavailable'}</span></div>
      {experimental && <span className="of-analysis-tag of-analysis-tag--review">Experimental</span>}</header>
    {ready && forecast ? <>
      <p className="of-yield-value"><strong>{analysisNumber(forecast.predicted_yield_t_ha, 2)}</strong><span>t/ha</span></p>
      <p className="of-analysis-caption">{modeLabel}{forecast.harvest_year ?? entry?.harvestYear ? ` · harvest ${forecast.harvest_year ?? entry?.harvestYear}` : ''}
        {text(forecast.country_name) ? ` · ${text(forecast.country_name)}` : forecast.country_code ? ` · ${forecast.country_code}` : ''}</p>
      {replay && <p className="of-analysis-caption"><strong>Historical replay</strong> · forecast {analysisDate(forecastDate)}. Calculated later for a past forecast date; this estimate was not issued on that date.</p>}
      {text(forecast.target_product) && <p className="of-analysis-caption">Reported product: {text(forecast.target_product)}</p>}
      {warnings.find(warning => /production systems|dry harvested/i.test(warning)) && <p className="of-analysis-caption">{warnings.find(warning => /production systems|dry harvested/i.test(warning))}</p>}
      <details className="of-analysis-disclosure"><summary>Model & evidence</summary><div className="of-analysis-disclosure-content">
        <dl className="of-analysis-dl"><div><dt>Model version</dt><dd>{forecast.model_version}</dd></div>
          <div><dt>Yield data through</dt><dd>{analysisDate(dataThrough)}</dd></div>
          <div><dt>Forecast date</dt><dd>{analysisDate(forecastDate)}</dd></div>
          <div><dt>Calculated at</dt><dd>{analysisTimestamp(calculatedAt)}</dd></div>
          <div><dt>Target product</dt><dd>{text(forecast.target_product) ?? name}</dd></div>
          <div><dt>Prediction interval</dt><dd>{forecast.prediction_interval_t_ha
            ? `${analysisNumber(forecast.prediction_interval_t_ha[0], 2)}–${analysisNumber(forecast.prediction_interval_t_ha[1], 2)} t/ha` : 'Not calibrated'}</dd></div>
          {number(holdout.mae_t_ha) !== null && <div><dt>Held-out MAE</dt><dd>{analysisNumber(holdout.mae_t_ha, 2)} t/ha</dd></div>}
          {number(holdout.last_yield_baseline_mae_t_ha) !== null && <div><dt>Last-yield baseline MAE</dt><dd>{analysisNumber(holdout.last_yield_baseline_mae_t_ha, 2)} t/ha</dd></div>}
          {Array.isArray(validation.holdout_years) && <div><dt>Validation harvest years</dt><dd>{validation.holdout_years.filter(value => typeof value === 'number').join(', ')}</dd></div>}
        </dl>
        {quality && <p className="of-analysis-caption">{quality === 'beats_last_yield_on_holdout'
          ? 'Held-out error was lower than using the last reported yield.' : 'Held-out error did not improve on the last-reported-yield baseline.'}</p>}
        <Source value={source} />
        {warnings.length > 0 && <ul className="of-analysis-notes">{warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
      </div></details>
    </> : <p className="of-analysis-unavailable">{entry?.reason ?? 'This analysis does not include a trained-model forecast for this crop.'}</p>}
  </article>;
}

function IrrigationDetails({ assessment }: { assessment: IrrigationAssessment }) {
  const calculation = object(assessment.calculation);
  const allocation = object(assessment.allocationContext);
  const hasCalculation = Object.keys(calculation).length > 0;
  return <section className="of-analysis-panel" aria-label="Field water assessment">
    <div className="of-analysis-heading"><h2>Field water assessment</h2><span className="of-analysis-tag">{IRRIGATION_STATUSES[assessment.status] ?? words(assessment.status)}</span></div>
    {text(assessment.message) && <p className="of-analysis-unavailable">{text(assessment.message)}</p>}
    {text(assessment.observedOn) && <p className="of-analysis-caption">Measured {analysisDate(assessment.observedOn)}{text(assessment.observationSource) ? ` · ${text(assessment.observationSource)}` : ''}</p>}
    {hasCalculation && <>
      <dl className="of-analysis-metrics"><div><dt>Crop water use</dt><dd>{analysisNumber(calculation.etcStandardMmDay)} <span>mm/day</span></dd></div>
        <div><dt>Measured depletion</dt><dd>{analysisNumber(calculation.rootZoneDepletionMm)} <span>mm</span></dd></div>
        <div><dt>Net refill volume</dt><dd>{analysisNumber(assessment.netRefillM3)} <span>m³</span></dd></div>
        <div><dt>Gross refill volume</dt><dd>{analysisNumber(assessment.grossRefillM3)} <span>m³</span></dd></div></dl>
      {typeof assessment.thresholdReached === 'boolean' && <p className="of-analysis-water-threshold">{assessment.thresholdReached
        ? 'Measured depletion has reached the reference threshold. Review rainfall and local conditions before watering.'
        : 'Measured depletion is below the reference threshold.'}</p>}
      {typeof allocation.canDeliverGrossRefill === 'boolean' && <p className="of-analysis-caption">{allocation.canDeliverGrossRefill
        ? 'The supplied dated allocation covers this gross refill estimate.' : 'The supplied dated allocation does not cover this gross refill estimate.'}</p>}
    </>}
    {Boolean(assessment.missingFields?.length) && <p className="of-analysis-caption">Still needed: {assessment.missingFields!.map(fieldLabel).join('; ')}.</p>}
    {assessment.limitations && <details className="of-analysis-disclosure"><summary>Water calculation limits</summary><ul className="of-analysis-notes">{assessment.limitations.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
  </section>;
}

function CropComponents({ options }: { options: CropOption[] }) {
  return <details className="of-analysis-panel of-analysis-disclosure"><summary>Crop suitability evidence</summary><div className="of-analysis-disclosure-content of-component-grid">
    {options.map(option => <article key={option.cropId} className="of-component-card"><h3>{option.name}</h3>
      <p className="of-analysis-caption">{option.evaluationStatus === 'excluded' ? 'Outside a known reference constraint' : option.score === null ? 'Incomplete reference screen' : `${analysisNumber(option.score, 1)}/100 reference screen`}
        {option.knownWeight !== undefined ? ` · ${Math.round(option.knownWeight * 100)}% of component weights known` : ''}</p>
      {option.componentScores && <dl className="of-analysis-dl">{Object.entries(option.componentScores).map(([key, value]) => <div key={key}><dt>{FACTORS[key] ?? words(key)}</dt><dd>{value === null ? 'Unknown' : `${analysisNumber(value)}/100`}</dd></div>)}</dl>}
      {Boolean(option.exclusionReasons?.length) && <ul className="of-analysis-notes of-analysis-notes--constraint">{option.exclusionReasons!.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
      {Boolean(option.missingFields?.length) && <p className="of-analysis-caption">Still needed: {option.missingFields!.map(fieldLabel).join('; ')}.</p>}
      {option.scoringModelVersion && <p className="of-analysis-source">Policy: {option.scoringModelVersion}</p>}
    </article>)}
  </div></details>;
}

export function AnalysisDetails({ analysis }: { analysis: AnalysisResult }) {
  const id = useId();
  const recent = analysis.recentWeather;
  const forecasts = new Map((analysis.yieldForecasts ?? []).map(entry => [entry.cropId, entry]));
  return <div className="of-analysis-details">
    <section className="of-analysis-panel" aria-labelledby={`${id}-weather`}>
      <div className="of-analysis-heading"><h2 id={`${id}-weather`}>Recent NASA conditions</h2><span className="of-analysis-tag">NASA POWER</span></div>
      {recent && (recent.status === 'available' || recent.status === 'partial') ? <>
        <p className="of-analysis-caption">{analysisDate(recent.periodStart)}–{analysisDate(recent.periodEnd)} · regional weather context</p>
        <dl className="of-analysis-metrics"><div><dt>Mean temperature</dt><dd>{analysisNumber(recent.meanTemperatureC)} <span>°C</span></dd></div>
          <div><dt>Total rainfall</dt><dd>{analysisNumber(recent.precipitationMm)} <span>mm</span></dd></div>
          <div><dt>Latest reference ET</dt><dd>{analysisNumber(recent.latestEt0MmDay)} <span>mm/day</span></dd></div></dl>
        {recent.observedOn && <p className="of-analysis-caption">Latest observation {analysisDate(recent.observedOn)}{recent.status === 'partial' ? ' · some observations are missing' : ''}.</p>}
        <Source value={recent.source} />
      </> : <p className="of-analysis-unavailable">{analysis.dataMode === 'mock' ? 'The selected demo uses synthetic conditions.' : 'Recent NASA observations are unavailable. Historical evidence remains listed in the analysis sources.'}</p>}
    </section>
    <section aria-labelledby={`${id}-yield`}><div className="of-analysis-heading"><div><h2 id={`${id}-yield`}>Yield forecasts</h2><p className="of-analysis-caption">Trained-model estimates in tonnes per hectare. Each card identifies its geographic scale and available evidence.</p></div>
      <span className="of-analysis-tag">{[...forecasts.values()].filter(entry => entry.status === 'available').length} / {CROP_CATALOG.length} available</span></div>
      <div className="of-yield-grid">{CROP_CATALOG.map(crop => <ForecastCard key={crop.id} cropId={crop.id} name={crop.name} entry={forecasts.get(crop.id)} />)}</div>
      <p className="of-analysis-caption of-analysis-scope-note">National and regional yield estimates do not establish the yield of this individual field. Annual-history models do not use current-season weather; NASA conditions support the separate field and water analysis.</p>
    </section>
    {analysis.irrigationAssessment && <IrrigationDetails assessment={analysis.irrigationAssessment} />}
    {analysis.cropOptions.some(option => option.componentScores) && <CropComponents options={analysis.cropOptions} />}
  </div>;
}
