import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createScenarioState } from '../domain/orbitFarm-model';
import type { AnalysisResult, FarmInputs } from '../domain/orbitFarm-types';
import { AnalysisDetails, analysisDate, analysisNumber, analysisTimestamp } from './orbitFarm-analysis-details';
import { FieldEvidenceFields } from './orbitFarm-evidence-fields';

function analysis(): AnalysisResult {
  const result = createScenarioState('dry-week').analysis!;
  return { ...result, dataMode: 'nasa-api', yieldForecasts: [{ cropId: 'wheat', status: 'available', harvestYear: 2026, forecast: {
    crop: 'wheat', mode: 'annual_history', predicted_yield_t_ha: 4.25, spatial_level: 'country',
    model_version: 'test-model', country_code: 'FR', harvest_year: 2026, data_through: '2024',
    prediction_interval_t_ha: null, quality_status: 'experimental', warnings: ['National estimate only.'],
    source: { dataset: 'FAOSTAT QCL', url: 'https://www.fao.org/faostat/en/#data/QCL' },
    validation: { holdout: { mae_t_ha: 1.2, last_yield_baseline_mae_t_ha: 1.1 } },
  } }, { cropId: 'maize', status: 'unavailable', reason: 'No compatible regional observations.' }] };
}

describe('analysis evidence display', () => {
  it('keeps unknown values distinct from measured zero and preserves calendar dates', () => {
    expect(analysisNumber(null)).toBe('Unavailable');
    expect(analysisNumber(Number.NaN)).toBe('Unavailable');
    expect(analysisNumber(0)).toBe('0');
    expect(analysisDate('2024')).toBe('2024');
    expect(analysisDate('2026-05')).toBe('May 2026');
    expect(analysisDate('2026-13')).toBe('Unavailable');
    expect(analysisDate('2026-01-01')).toBe('1 Jan 2026');
    expect(analysisDate('2026-02-31')).toBe('Unavailable');
    expect(analysisTimestamp('2026-11-15T14:05:07+00:00')).toBe('15 Nov 2026, 14:05:07 UTC');
    expect(analysisTimestamp('2026-11-15T14:05:07')).toBe('Unavailable');
    expect(analysisTimestamp('2026-02-31T14:05:07Z')).toBe('Unavailable');
  });

  it('shows all ten crop outcomes with scale, unavailable reasons and model evidence', () => {
    const html = renderToStaticMarkup(createElement(AnalysisDetails, { analysis: analysis() }));
    expect((html.match(/aria-label="[^"]+ yield forecast"/g) ?? [])).toHaveLength(10);
    expect(html).toContain('National estimate');
    expect(html).toContain('4.25');
    expect(html).toContain('No compatible regional observations.');
    expect(html).toContain('Experimental');
    expect(html).toContain('test-model');
    expect(html).toContain('Last-yield baseline MAE');
    expect(html).toContain('FAOSTAT QCL');
    expect(html).toContain('Annual-history models do not use current-season weather');
  });

  it('does not turn missing moisture or unavailable measurement volumes into a dose', () => {
    const result = analysis();
    result.irrigationAssessment = { status: 'needs_root_zone_moisture', missingFields: ['fieldObservations.rootZoneLayers.thetaNow'],
      calculation: { etcStandardMmDay: 5.5 }, grossRefillM3: null, netRefillM3: null };
    const html = renderToStaticMarkup(createElement(AnalysisDetails, { analysis: result }));
    expect(html).toContain('Current root-zone moisture is missing');
    expect(html).toContain('Current moisture in every active-root layer');
    expect(html).toContain('Gross refill volume');
    expect(html).toContain('Unavailable');
    expect(html).not.toContain('Reference threshold reached');
  });

  it('distinguishes a historical forecast date from the time the replay was calculated', () => {
    const result = analysis();
    Object.assign(result.yieldForecasts![0].forecast!, { spatial_level: 'administrative_region', mode: 'pre_season',
      forecast_date: '2026-01-22', calculated_at: '2026-11-15T14:05:07Z', is_replay: true, temporal_status: 'retrospective_estimate' });
    const html = renderToStaticMarkup(createElement(AnalysisDetails, { analysis: result }));
    expect(html).toContain('Historical replay');
    expect(html).toContain('this estimate was not issued on that date');
    expect(html).toContain('<dt>Forecast date</dt><dd>22 Jan 2026</dd>');
    expect(html).toContain('<dt>Calculated at</dt><dd>15 Nov 2026, 14:05:07 UTC</dd>');
  });

  it('keeps provincial point estimates experimental and separates weather from yield-label evidence', () => {
    const result = analysis();
    const entry = result.yieldForecasts![0];
    Object.assign(entry.forecast!, { spatial_level: 'administrative_region', mode: 'mid_season',
      release_status: 'experimental', quality_status: 'beats_last_yield_on_holdout', weather_support: 'representative_point',
      region_name: 'Albacete', region_id: '02', country_code: 'ES', data_through: '2026-05',
      source: { labels: { dataset: 'MAPA provincial statistics', url: 'https://www.mapa.gob.es/es/estadistica/temas/estadisticas-agrarias/' },
        calendar: { source_files: [{ id: 'leguminosasgrano.xlsx', url: 'https://www.mapa.gob.es/calendar.xlsx' }] },
        weather: { product: 'NASA POWER Monthly', url: 'https://power.larc.nasa.gov/' } },
      validation: { holdout_years: [2022, 2023, 2024], metrics: { mae_t_ha: 4.56 },
        conservative_policy_metrics: { mae_t_ha: 2.45, last_yield_baseline_mae_t_ha: 2.7 },
        metrics_by_label_age: { '2': { mae_t_ha: 2.45, last_yield_baseline_mae_t_ha: 2.7 }, '3': { mae_t_ha: 2.6, last_yield_baseline_mae_t_ha: 2.9 } } } });
    entry.diagnostics = { labelDataThrough: 2024, labelAgeYears: 2, labelCutoffYear: 2024 };
    const html = renderToStaticMarkup(createElement(AnalysisDetails, { analysis: result }));
    expect(html).toContain('Experimental');
    expect(html).toContain('Province: Albacete (02)');
    expect(html).toContain('NASA monthly point proxy');
    expect(html).toContain('<dt>Weather observed through</dt><dd>May 2026</dd>');
    expect(html).toContain('<dt>Latest yield label</dt><dd>2024</dd>');
    expect(html).toContain('Held-out error by yield history age');
    expect(html).toContain('Both the combined and conservative-policy holdout checks had lower error');
    expect(html).toContain('2.45');
    expect(html).not.toContain('4.56');
    expect(html).toContain('Yield labels:');
    expect(html).toContain('Crop calendar:');
  });

  it('does not describe a better provincial policy MAE as worse when the combined check failed', () => {
    const result = analysis();
    Object.assign(result.yieldForecasts![0].forecast!, { mode: 'pre_season', spatial_level: 'administrative_region',
      country_code: 'ES', region_id: '50', region_name: 'Zaragoza', weather_support: 'representative_point', release_status: 'experimental',
      quality_status: 'does_not_beat_last_yield_on_holdout',
      validation: { metrics: { mae_t_ha: .9959, last_yield_baseline_mae_t_ha: .9673 },
        conservative_policy_metrics: { mae_t_ha: .96755, last_yield_baseline_mae_t_ha: .96977 } } });
    const html = renderToStaticMarkup(createElement(AnalysisDetails, { analysis: result }));
    expect(html).toContain('At least one of the combined and conservative-policy holdout checks did not beat the last-yield baseline.');
    expect(html).not.toContain('Held-out error did not improve on the last-reported-yield baseline.');
    expect(html).toContain('held-out cases matching the conservative yield-history availability policy');
  });

  it('links nested MAPA label archives to the latest yearbook index instead of an arbitrary crop workbook', () => {
    const result = analysis();
    Object.assign(result.yieldForecasts![0].forecast!, { weather_support: 'representative_point',
      source: { labels: { archive_sha256: 'fixture', sources: [
        { yearbook: 2025, index_url: 'https://www.mapa.gob.es/anuario/2025', url: 'https://www.mapa.gob.es/2025-other-crop.xlsx' },
        { yearbook: 2023, index_url: 'https://www.mapa.gob.es/anuario/2023', url: 'https://www.mapa.gob.es/2023-other-crop.xlsx' },
      ] } } });
    const html = renderToStaticMarkup(createElement(AnalysisDetails, { analysis: result }));
    expect(html).toContain('Yield labels:');
    expect(html).toContain('MAPA provincial crop statistics · yearbook 2025');
    expect(html).toContain('href="https://www.mapa.gob.es/anuario/2025"');
    expect(html).not.toContain('href="https://www.mapa.gob.es/anuario/2023"');
    expect(html).not.toContain('other-crop.xlsx');
  });

  it('renders uncertain source strings as text rather than unsafe navigation', () => {
    const result = analysis();
    result.yieldForecasts![0].forecast!.source = { dataset: '<script>untrusted</script>', url: 'javascript:alert(1)' };
    const html = renderToStaticMarkup(createElement(AnalysisDetails, { analysis: result }));
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<script>untrusted</script>');
    expect(html).toContain('&lt;script&gt;untrusted&lt;/script&gt;');
  });
});

describe('field evidence form', () => {
  it('leaves observations and planning choices absent until the farmer adds them', () => {
    const inputs: FarmInputs = { soil: { ph: null, texture: null, source: 'unknown' }, irrigation: { availability: 'unknown', method: null, volumeM3: null }, previousCropId: null, priority: 'balanced' };
    const html = renderToStaticMarkup(createElement(FieldEvidenceFields, { inputs, onChange: () => {} }));
    expect(html).toContain('Forecast mode');
    expect(html).toContain('Add field water observations');
    expect(html).not.toContain('Root-zone layer 1');
    expect(html).not.toContain('Seasonal water assessment 1');
    expect(html).not.toContain('Existing plan · season 1');
    expect(html).not.toContain('value="NaN"');
  });

  it('renders incomplete added measurements as blank and preserves an actual measured zero', () => {
    const inputs: FarmInputs = { soil: { ph: null, texture: null, source: 'unknown' }, irrigation: { availability: 'unknown', method: null, volumeM3: null }, previousCropId: null, priority: 'balanced',
      fieldObservations: { observedOn: '2026-11-15', cropId: 'maize', stage: 'mid_season', source: 'Field sensor',
        rootZoneLayers: [{ thicknessM: Number.NaN, thetaFc: Number.NaN, thetaWp: Number.NaN, thetaNow: null }] } };
    const blank = renderToStaticMarkup(createElement(FieldEvidenceFields, { inputs, onChange: () => {} }));
    expect(blank).toContain('Root-zone layer 1');
    expect(blank).not.toContain('value="NaN"');
    expect(blank).not.toContain('value="0"');
    inputs.fieldObservations!.rootZoneLayers![0].thetaNow = 0;
    const measured = renderToStaticMarkup(createElement(FieldEvidenceFields, { inputs, onChange: () => {} }));
    expect(measured).toContain('value="0"');
  });

  it('allows a documented seasonal balance without creating daily field observations', () => {
    const inputs: FarmInputs = { soil: { ph: null, texture: null, source: 'unknown' }, irrigation: { availability: 'unknown', method: null, volumeM3: null }, previousCropId: null, priority: 'balanced',
      seasonalWaterBalance: [{ cropId: 'wheat', periodStart: '2027-03-01', periodEnd: '2027-08-01', netIrrigationRequirementMm: 100, source: 'Local agronomic assessment', method: 'Effective rainfall and root-zone balance' }] };
    const html = renderToStaticMarkup(createElement(FieldEvidenceFields, { inputs, onChange: () => {} }));
    expect(html).toContain('Seasonal crop water balance');
    expect(html).toContain('Seasonal water assessment 1');
    expect(html).toContain('Local agronomic assessment');
    expect(html).not.toContain('Observation date');
    expect(html).not.toContain('Measured growth stage');
    expect(inputs.fieldObservations).toBeUndefined();
  });
});
