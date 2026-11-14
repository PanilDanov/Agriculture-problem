import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Polygon } from 'geojson';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CheckCheck,
  ChevronRight, CircleHelp, CloudSun, Database, Droplets, FlaskConical,
  Leaf, ListChecks, MapPin, Plus, RefreshCw, ScanLine,
  Settings2, ShieldCheck, Sprout, Sun, Trash2, Undo2, Wheat, X,
} from 'lucide-react';
import {
  CROP_CATALOG, SCENARIOS, buildAnalysisRequest, createApiProvider,
  createMockProvider, createScenarioState, farmReducer, getDueTasks,
  getFarmDate, getGrowthStage, loadFarm, loadProviderSettings, saveFarm, saveProviderSettings, validateBoundary,
} from './domain/orbitFarm-domain';
import type {
  AnalysisResult, CareTask, CropId, FarmAction, FarmInputs, FarmState,
  JournalEntry, ProviderSettings, ScenarioId,
} from './domain/orbitFarm-types';
import { CropSprite, FarmScene, SatelliteIcon } from './components/orbitFarm-farm-scene';
const BoundaryMap = lazy(() => import('./components/orbitFarm-boundary-map').then((module) => ({ default: module.BoundaryMap })));
import { OrbitScanner } from './components/orbitFarm-scanner';

type Route = 'farm' | 'plans' | 'tasks' | 'journal' | 'lab' | 'setup';
interface Draft { name: string; inputs: FarmInputs; boundary: Polygon | null }
const NAV = [
  { route: 'farm', label: 'Your farm', icon: Sprout },
  { route: 'plans', label: 'Rotation plans', icon: Leaf },
  { route: 'tasks', label: 'Tasks', icon: ListChecks },
  { route: 'journal', label: 'Journal', icon: BookOpen },
] as const;
const TEXTURES = ['sand', 'loamy_sand', 'sandy_loam', 'loam', 'silt_loam', 'silt', 'sandy_clay_loam', 'clay_loam', 'silty_clay_loam', 'sandy_clay', 'silty_clay', 'clay'];
const cropName = (id: CropId) => CROP_CATALOG.find((crop) => crop.id === id)?.name ?? id;
const plotLetter = (slot: number) => String.fromCharCode(65 + slot);
const human = (value: string) => value.replaceAll('_', ' ');
const displayDate = (date: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
const readRoute = (): Route => {
  const route = window.location.hash.replace(/^#\//, '').split('/')[0];
  return ['farm', 'plans', 'tasks', 'journal', 'lab', 'setup'].includes(route) ? route as Route : 'farm';
};

function restore() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';
  try {
    const farm = loadFarm(window.localStorage);
    const provider = loadProviderSettings(window.localStorage);
    const fallbackMode = provider.error || (farm.state.analysis && farm.state.analysis.dataMode !== 'mock') ? 'api' : 'mock';
    return { ...farm, provider: provider.settings ?? { mode: fallbackMode, baseUrl } as ProviderSettings, providerError: provider.error };
  } catch {
    return { state: createScenarioState('dry-week'), error: 'Saved farms are unavailable in this browser. Changes will remain in this session.', provider: { mode: 'api', baseUrl } as ProviderSettings, providerError: 'Select an analysis provider in Test benches. Saved settings are unavailable.' };
  }
}

export function OrbitFarmApp() {
  const [initial] = useState(restore);
  const [state, setState] = useState<FarmState>(initial.state);
  const [route, setRoute] = useState<Route>(readRoute);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(0);
  const [mapView, setMapView] = useState(false);
  const [notice, setNoticeValue] = useState<string | null>(null);
  const [noticeTaskId, setNoticeTaskId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(initial.error);
  const [recoveryRequired, setRecoveryRequired] = useState(Boolean(initial.error));
  const [providerMode, setProviderMode] = useState<'mock' | 'api'>(initial.provider.mode);
  const [providerError, setProviderError] = useState<string | null>(initial.providerError);
  const [analysisMode, setAnalysisMode] = useState<'demo' | 'api'>('demo');
  const [scannerPreview, setScannerPreview] = useState<'scanning' | 'complete'>('scanning');
  const [scannerPreviewRun, setScannerPreviewRun] = useState(0);
  const [apiBaseUrl, setApiBaseUrl] = useState(initial.provider.baseUrl);
  const [draft, setDraft] = useState<Draft>(() => ({ name: 'My farm', inputs: createScenarioState('empty-farm').inputs, boundary: null }));
  const [formError, setFormError] = useState<string | null>(null);
  const [editingFarm, setEditingFarm] = useState(false);
  const [pendingBoundary, setPendingBoundary] = useState<Polygon | null>(null);
  const abort = useRef<AbortController | null>(null);
  const lastSaved = useRef(state);
  const dueTasks = getDueTasks(state);
  const selectedPlot = state.plots.find((plot) => plot.slotId === selectedSlotId);
  const selectedTask = dueTasks.find((task) => task.plotId === selectedPlot?.id) ?? (selectedPlot ? undefined : dueTasks[0]);
  const selectedPlan = state.analysis?.rotationPlans.find((plan) => plan.planId === state.selectedPlanId);
  const sourceLabel = state.analysis?.dataMode === 'nasa-api' ? 'NASA data' : state.analysis?.dataMode === 'nasa-cache' ? 'Cached NASA data' : 'Demo data';
  const lastUndoable = noticeTaskId ? [...state.journal].reverse().find((entry) => entry.taskId === noticeTaskId && !entry.undone && state.tasks.some((task) => task.id === entry.taskId)) : undefined;

  function setNotice(message: string | null, taskId?: string) {
    setNoticeValue(message);
    setNoticeTaskId(taskId ?? null);
  }
  function selectProvider(mode: ProviderSettings['mode']) {
    let baseUrl = apiBaseUrl.trim();
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid service URL');
    } catch {
      if (mode === 'api') { setProviderError('Use an HTTP or HTTPS analysis service URL without embedded credentials.'); return; }
      baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';
    }
    setProviderMode(mode);
    setApiBaseUrl(baseUrl);
    try { setProviderError(saveProviderSettings({ mode, baseUrl }, window.localStorage)); }
    catch { setProviderError('Provider settings could not be saved. Your selection remains active in this tab.'); }
    setNotice(mode === 'mock' ? 'Demo fixtures selected explicitly.' : 'API provider selected. Analyze your field to send its information.');
  }

  function navigate(next: Route) {
    window.location.hash = `/${next}`;
    setRoute(next);
  }
  function dispatch(action: FarmAction, message?: string) {
    setState((current) => farmReducer(current, action));
    if (message) setNotice(message, action.type === 'complete_task' || action.type === 'skip_task' || action.type === 'snooze_task' ? action.taskId : undefined);
  }
  useEffect(() => {
    const onHash = () => { setRoute(readRoute()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (lastSaved.current === state || recoveryRequired) return;
    lastSaved.current = state;
    try { setStorageError(saveFarm(state, window.localStorage)); }
    catch { setStorageError('Your changes could not be saved. Keep this tab open and try again.'); }
  }, [state, recoveryRequired]);
  useEffect(() => () => abort.current?.abort(), []);

  function createFarm() {
    setEditingFarm(false);
    setDraft({ name: 'My farm', boundary: null, inputs: createScenarioState('empty-farm').inputs });
    setFormError(null);
    navigate('setup');
  }
  function editField() {
    setEditingFarm(true);
    setDraft({ name: state.name, boundary: state.boundary, inputs: state.inputs });
    setFormError(null);
    navigate('setup');
  }
  async function analyze(target = state) {
    const requestId = crypto.randomUUID();
    let request;
    try { request = buildAnalysisRequest(target, requestId); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Check your field information and try again.';
      setFormError(message);
      setNotice(message);
      return;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setAnalysisMode(providerMode === 'mock' ? 'demo' : 'api');
    setState(farmReducer(target, { type: 'analysis_started', requestId }));
    setNotice(null);
    navigate('plans');
    try {
      const provider = providerMode === 'api' ? createApiProvider(apiBaseUrl) : createMockProvider(target.scenarioId);
      const analysis = await provider.analyze(request, controller.signal);
      if (!controller.signal.aborted) setState((current) => farmReducer(current, { type: 'analysis_received', analysis }));
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Analysis unavailable. Please try again.';
      setState((current) => farmReducer(current, { type: 'analysis_failed', requestId, message }));
    }
  }
  function submitFarm(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) { setFormError('Enter a farm name.'); return; }
    if (draft.inputs.season.endDate < draft.inputs.season.plantingDate) { setFormError('Season end must not be before planting date.'); return; }
    const boundary = validateBoundary(draft.boundary);
    if (!boundary.valid || !draft.boundary) { setFormError(boundary.errors[0] ?? 'Draw a closed field boundary before continuing.'); return; }
    const inputs = structuredClone(draft.inputs);
    inputs.soil.source = inputs.soil.ph === null && inputs.soil.texture === null ? 'unknown' : 'farmer_reported';
    const next: FarmState = {
      ...(editingFarm ? state : createScenarioState('empty-farm')),
      farmId: editingFarm ? state.farmId : crypto.randomUUID(), name: draft.name.trim(), boundary: draft.boundary,
      boundaryVersion: editingFarm ? state.boundaryVersion + 1 : 1, inputs,
      scenarioId: state.scenarioId === 'empty-farm' ? 'dry-week' : state.scenarioId,
      analysis: null, pendingRequestId: null, analysisError: null, selectedPlanId: null,
    };
    try { buildAnalysisRequest(next, crypto.randomUUID()); }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Check your field information.'); return; }
    setRecoveryRequired(false);
    setStorageError(null);
    setFormError(null);
    setSelectedSlotId(0);
    void analyze(next);
  }
  function loadScenario(id: ScenarioId) {
    if ((state.name !== 'Meadow Farm' || state.journal.length > 0 || recoveryRequired) && !window.confirm('Replace the saved demo farm with this test scenario?')) return;
    abort.current?.abort();
    setState(createScenarioState(id));
    setRecoveryRequired(false);
    setStorageError(null);
    setSelectedSlotId(0);
    selectProvider('mock');
    setMapView(false);
    setNotice(`Loaded ${SCENARIOS.find((scenario) => scenario.id === id)?.name ?? id}. All conditions are simulated.`);
    navigate('farm');
  }
  function plantShortcut() {
    const empty = Array.from({ length: 6 }, (_, slot) => slot).find((slot) => !state.plots.some((plot) => plot.slotId === slot));
    setSelectedSlotId(empty ?? state.plots[0]?.slotId ?? 0);
    setNotice(empty === undefined ? 'Your plots are full. Select a crop to edit its planting.' : `Plot ${plotLetter(empty)} is ready. Choose a crop in the planting panel.`);
  }
  function taskAction(task: CareTask, type: 'complete_task' | 'skip_task' | 'snooze_task') {
    dispatch({ type, taskId: task.id }, type === 'complete_task' ? task.kind === 'water' ? 'Irrigation logged. A little care goes a long way.' : 'Care task completed. Your action is saved in the journal.' : type === 'skip_task' ? 'Task skipped. Your choice is saved in the journal.' : 'Reminder moved to tomorrow in demo time.');
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <a className="wordmark" href="#/farm" aria-label="orbitFarm home"><span className="brand-mark"><Sprout size={23} /></span>orbitFarm<span className="brand-period">.</span></a>
      <div className="workspace-label">YOUR GROWING SPACE</div>
      <div className="farm-identity"><span className="farm-avatar"><Wheat size={24} /></span><div><strong data-testid="farm-name">{state.name}</strong><span>Personal workspace</span></div></div>
      <nav aria-label="Main navigation">
        {NAV.map(({ route: target, label, icon: Icon }) => <a key={target} href={`#/${target}`} aria-label={label} className={`nav-link ${route === target ? 'active' : ''}`} aria-current={route === target ? 'page' : undefined}><Icon size={19} /><span>{label}</span>{target === 'tasks' && dueTasks.length > 0 && <span className="nav-count">{dueTasks.length}</span>}</a>)}
      </nav>
      <div className="sidebar-season"><span className="eyebrow"><Sun size={14} /> THE NEXT GOOD THING</span><h3>A little space.<br />A fresh start.</h3><p>Thoughtful seasons begin with small decisions.</p><button className="text-button" onClick={() => { navigate('plans'); }}>Explore your plans <ArrowRight size={16} /></button></div>
      <div className="sidebar-bottom"><a href="#/lab" className={`nav-link ${route === 'lab' ? 'active' : ''}`}><FlaskConical size={18} />Test benches</a><div className="sidebar-footer"><span className="avatar">F</span><span>Field notes & fresh starts<small>orbitFarm · early access</small></span><CircleHelp size={16} /></div></div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div className="breadcrumbs"><Sprout size={16} /><span>My workspace</span><ChevronRight size={13} /><strong>{route === 'farm' ? 'Your farm' : route === 'lab' ? 'Test benches' : route === 'setup' ? 'Field setup' : route === 'plans' ? 'Rotation plans' : route === 'tasks' ? 'Tasks' : 'Journal'}</strong></div><div className="topbar-right"><span className={`data-badge ${sourceLabel === 'Demo data' ? 'demo' : 'nasa'}`}><span />{sourceLabel}</span><span className="topbar-divider" /><span className="topbar-date"><CalendarDays size={15} />{displayDate(state.demoNow)}</span><span className="avatar">F</span></div></header>
      {storageError && <div className="storage-alert" role="alert"><Database size={18} /><span>{storageError}</span>{recoveryRequired ? <button onClick={() => loadScenario('dry-week')}>Reset demo safely</button> : <button onClick={() => { try { setStorageError(saveFarm(state, window.localStorage)); } catch { setStorageError('Browser storage is still unavailable.'); } }}>Try saving again</button>}</div>}
      {providerError && <div className="storage-alert" role="alert"><Database size={18} /><span>{providerError}</span><button onClick={() => navigate('lab')}>Open provider settings</button></div>}
      {notice && <div className="notice" role="status"><Check size={17} /><span>{notice}</span>{lastUndoable && <button className="text-button" onClick={() => { dispatch({ type: 'undo_action', entryId: lastUndoable.id }); setNotice('Action undone. Your task is restored.'); }}><Undo2 size={15} />Undo</button>}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}
      <main id="main-content">
        {route === 'farm' && <>
          <div className="page-heading"><div><span className="eyebrow"><span className="tiny-leaf" />FROM ORBIT TO YOUR NEXT SEASON</span><h1>Your farm, a little happier.</h1><p>Big-picture insights. Small, thoughtful actions.</p></div><div className="heading-actions"><button className="button secondary" disabled={Boolean(state.pendingRequestId)} onClick={() => state.boundary ? void analyze() : createFarm()}><ScanLine size={17} />Analyze field</button><button className="button primary" onClick={createFarm}><Plus size={17} />Create farm</button></div></div>
          {state.pendingRequestId && <OrbitScanner key={state.pendingRequestId} mode={analysisMode} compact />}
          <div className="farm-layout"><section className="farm-main">
            <div className="farm-window"><div className="farm-window-toolbar"><div><span className="live-dot" /><strong>{state.name}</strong><span className="muted">{state.boundary ? `${validateBoundary(state.boundary).areaHa.toFixed(1)} ha` : 'No field selected'}</span></div><div className="segmented" aria-label="Field view"><button aria-pressed={!mapView} onClick={() => setMapView(false)}><Sprout size={14} />Farm</button><button aria-pressed={mapView} onClick={() => { setPendingBoundary(state.boundary); setMapView(true); }}><MapPin size={14} />Map</button></div></div>
              {mapView ? <div className="map-workspace"><Suspense fallback={<p className="muted small">Loading the field map…</p>}><BoundaryMap boundary={pendingBoundary} error={pendingBoundary ? validateBoundary(pendingBoundary).errors[0] : null} onChange={setPendingBoundary} /></Suspense><button className="button primary" onClick={() => { const checked = validateBoundary(pendingBoundary); if (checked.valid && pendingBoundary) { dispatch({ type: 'set_boundary', boundary: pendingBoundary }, 'Boundary saved. Analyze the field to refresh its recommendations.'); setMapView(false); } else setNotice(checked.errors[0] ?? 'Draw a valid field boundary.'); }}>Confirm boundary</button></div> : <FarmScene plots={state.plots} selectedSlotId={selectedSlotId} onSelectSlot={setSelectedSlotId} tasks={state.tasks} demoNow={state.demoNow} isScanning={Boolean(state.pendingRequestId)} />}
              <div className="farm-window-footer"><span><span className="legend-dot planted" />{state.plots.length} planted plots</span><span><span className="legend-dot attention" />{dueTasks.length} {dueTasks.length === 1 ? 'task' : 'tasks'} need a check</span><span className="scene-caption">Schematic layout · not to scale</span></div>
            </div>
            <div className="conditions-heading"><div><h2>A view from above</h2><p>Your field conditions, made a little clearer.</p></div><button className="text-button" onClick={() => navigate('plans')}>See the evidence <ArrowRight size={15} /></button></div>
            <ConditionCards analysis={state.analysis} />
            <div className="season-strip"><div className="season-strip-icon"><Leaf size={24} /></div><div><span className="eyebrow">THINK ONE SEASON AHEAD</span><h3>{selectedPlan ? selectedPlan.sequence.map(cropName).join(' → ') : 'Good neighbors. Better next seasons.'}</h3><p>{selectedPlan ? 'Your selected rotation · review local conditions before planting.' : 'Explore crop rotations that fit your soil, water, and priorities.'}</p></div><button className="button secondary" onClick={() => navigate('plans')}>Compare plans <ArrowRight size={16} /></button></div>
            <p className="data-footnote"><ShieldCheck size={14} />{sourceLabel === 'Demo data' ? 'Simulated conditions for testing. No live satellite measurements or agronomic guarantees.' : 'Review observation dates, spatial resolution, and local field conditions before acting.'}</p>
          </section>
          <aside className="care-sidebar"><div className="section-heading"><h2>A little care today</h2><span className="soft-count">{dueTasks.length}</span></div><p className="section-subtitle">Small steps. Happy growing.</p>
            {selectedTask ? <TaskCard task={selectedTask} state={state} onAction={taskAction} selected /> : <div className="caught-up"><span className="caught-up-icon"><CheckCheck size={28} /></span><h3>{state.boundary ? 'A moment to grow.' : 'Your next season starts here.'}</h3><p>{state.boundary ? 'No task is due for this plot. Your next check will appear when it is time.' : 'Draw your field, explore its conditions, and make it your own.'}</p>{!state.boundary && <button className="button primary" onClick={createFarm}>Draw my farm <ArrowRight size={16} /></button>}</div>}
            {selectedSlotId !== null && state.boundary && <PlotEditor key={`${state.farmId}-${selectedSlotId}-${selectedPlot?.id ?? 'empty'}`} state={state} slotId={selectedSlotId} onAction={dispatch} selectedCrop={selectedPlan?.sequence[0]} />}
            <div className="field-context"><span className="eyebrow"><MapPin size={13} />YOUR FIELD NOTES</span><div><span>Planting window</span><strong>{displayDate(state.inputs.season.plantingDate).replace(', 2026', '')}</strong></div><div><span>Soil texture</span><strong>{state.inputs.soil.texture ? human(state.inputs.soil.texture) : 'Unknown'}</strong></div><div><span>Priority</span><strong>{human(state.inputs.priority)}</strong></div><button className="text-button" onClick={editField}>Edit field information <Settings2 size={14} /></button></div>
          </aside></div>
        </>}

        {route === 'setup' && <>
          <button className="text-button back-button" onClick={() => navigate('farm')}><ArrowLeft size={16} />Back to your farm</button>
          <div className="page-heading"><div><span className="eyebrow">A LITTLE CONTEXT GOES A LONG WAY</span><h1>Let's meet your field.</h1><p>Draw its boundary. Tell us what you know. Leave the rest as unknown.</p></div><span className={`data-badge ${providerMode === 'mock' ? 'demo' : 'nasa'}`}><span />{providerMode === 'mock' ? 'Demo analysis' : 'Connected API'}</span></div>
          <form className="setup-layout" onSubmit={submitFarm} noValidate>
            <section className="panel boundary-panel"><div className="panel-heading"><span className="step-number">01</span><div><h2>Your little corner of Earth</h2><p>Place points on the map, or try our example boundary.</p></div></div><Suspense fallback={<p className="muted small">Loading the field map…</p>}><BoundaryMap boundary={draft.boundary} error={draft.boundary ? validateBoundary(draft.boundary).errors[0] : null} onChange={(boundary) => setDraft((current) => ({ ...current, boundary }))} /></Suspense><div className="boundary-summary"><MapPin size={16} /><span>{draft.boundary ? `${validateBoundary(draft.boundary).areaHa.toFixed(2)} hectares · geographic boundary` : 'Your confirmed boundary will appear here.'}</span></div><p className="muted small">Map imagery needs a connection. Boundary points and demo tools remain available.</p></section>
            <section className="panel setup-fields"><div className="panel-heading"><span className="step-number">02</span><div><h2>The field notes</h2><p>Only share what you know.</p></div></div>
              <label>Farm name<input name="farmName" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <div className="form-row"><label>Planting date<input type="date" value={draft.inputs.season.plantingDate} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, season: { ...draft.inputs.season, plantingDate: e.target.value } } })} /></label><label>Season end<input type="date" value={draft.inputs.season.endDate} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, season: { ...draft.inputs.season, endDate: e.target.value } } })} /></label></div>
              <div className="form-divider">SOIL & WATER</div>
              <div className="form-row"><label>Soil pH<input type="number" min="0" max="14" step="0.1" placeholder="Unknown" value={draft.inputs.soil.ph ?? ''} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, soil: { ...draft.inputs.soil, ph: e.target.value === '' ? null : Number(e.target.value) } } })} /></label><label>Soil texture<select value={draft.inputs.soil.texture ?? ''} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, soil: { ...draft.inputs.soil, texture: e.target.value || null } } })}><option value="">Unknown</option>{TEXTURES.map((texture) => <option value={texture} key={texture}>{human(texture)}</option>)}</select></label></div>
              <label>Irrigation access<select value={draft.inputs.irrigation.availability} onChange={(e) => { const availability = e.target.value as FarmInputs['irrigation']['availability']; setDraft({ ...draft, inputs: { ...draft.inputs, irrigation: { availability, method: null, volumeM3: availability === 'none' ? 0 : null } } }); }}><option value="unknown">Unknown</option><option value="available">Available</option><option value="none">No irrigation</option></select></label>
              {draft.inputs.irrigation.availability === 'available' && <div className="form-row"><label>Water budget (m³)<input type="number" min="0" placeholder="Unknown" value={draft.inputs.irrigation.volumeM3 ?? ''} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, irrigation: { ...draft.inputs.irrigation, volumeM3: e.target.value === '' ? null : Number(e.target.value) } } })} /></label><label>Irrigation method<select value={draft.inputs.irrigation.method ?? ''} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, irrigation: { ...draft.inputs.irrigation, method: e.target.value as FarmInputs['irrigation']['method'] || null } } })}><option value="">Unknown</option><option value="drip">Drip</option><option value="sprinkler">Sprinkler</option><option value="surface">Surface</option></select></label></div>}
              <p className="field-hint">Water budget covers the whole field and the complete selected season.</p>
              <div className="form-row"><label>Main priority<select value={draft.inputs.priority} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, priority: e.target.value as FarmInputs['priority'] } })}><option value="balanced">Balanced</option><option value="save_water">Save water</option><option value="improve_soil">Improve soil</option></select></label><label>Previous crop<select value={draft.inputs.previousCropId ?? ''} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, previousCropId: e.target.value as CropId || null } })}><option value="">Unknown</option>{CROP_CATALOG.map((crop) => <option value={crop.id} key={crop.id}>{crop.name}</option>)}</select></label></div>
              {formError && <div className="form-error" role="alert">{formError}</div>}
              <button className="button primary full-width" type="submit"><ScanLine size={18} />Analyze my farm <ArrowRight size={16} /></button><p className="field-hint centered">{providerMode === 'mock' ? 'Demo data · no request to NASA will be made.' : 'Your field information will be sent to the configured analysis service.'}</p>
            </section>
          </form>
        </>}

        {route === 'plans' && <>
          <div className="page-heading"><div><span className="eyebrow">THINKING BEYOND THIS HARVEST</span><h1>A good plan grows with you.</h1><p>Explore the next two seasons, one thoughtful choice at a time.</p></div><button className="button secondary" disabled={Boolean(state.pendingRequestId)} onClick={() => state.boundary ? void analyze() : createFarm()}><RefreshCw size={16} />Analyze field</button></div>
          {state.pendingRequestId ? <OrbitScanner key={state.pendingRequestId} mode={analysisMode} /> : state.analysisError ? <div className="analysis-error" role="alert"><span className="error-icon"><CloudSun size={30} /></span><h2>Analysis unavailable</h2><p>{state.analysisError}</p><div className="heading-actions"><button className="button primary" onClick={() => void analyze()}><RefreshCw size={16} />Try again</button><button className="button secondary" onClick={() => navigate('farm')}>Back to farm</button></div>{state.analysis && <p className="small muted">Your last available analysis and saved farm are preserved.</p>}</div> : state.analysis ? <>
            <div className="analysis-banner"><span className="evidence-icon"><ScanLine size={23} /></span><div><strong>Your field has a story. Here are a few possible next chapters.</strong><p>{state.analysis.dataMode === 'mock' ? 'These are simulated comparisons. Review local soil and growing conditions before acting.' : 'Review the observations, assumptions, and local conditions behind each comparison.'}</p></div><span className={`data-badge ${sourceLabel === 'Demo data' ? 'demo' : 'nasa'}`}>{sourceLabel}</span></div>
            <div className="rotation-grid">{state.analysis.rotationPlans.map((plan, index) => <article className={`rotation-card ${plan.planId.includes('water') ? 'featured' : ''}`} key={plan.planId} aria-label={`${plan.name === 'Save water' ? 'Save water' : plan.name} plan`}><div className="plan-eyebrow">{index === 0 ? 'YOUR STARTING POINT' : plan.planId.includes('water') ? 'A LITTLE LESS THIRSTY' : 'A LITTLE MORE DIVERSE'}</div><h2>{plan.name}</h2><p className="small muted">Two seasons · {plan.baselineOrigin === 'example' && index === 0 ? 'example baseline' : 'illustrative rotation'}</p><div className="rotation-sequence">{plan.sequence.map((crop, seasonIndex) => <div key={`${crop}-${seasonIndex}`}><span className="crop-portrait"><CropSprite cropId={crop} size={60} /></span><span className="small muted">Season {seasonIndex + 1}</span><strong>{cropName(crop)}</strong></div>)}<ArrowRight size={20} /></div><ul className="plan-reasons">{plan.reasons.map((reason) => <li key={reason}><Check size={15} />{reason}</li>)}</ul><div className="plan-tradeoffs">{plan.tradeoffs.map((tradeoff) => <p key={tradeoff}>{tradeoff}</p>)}</div><button className={`button ${plan.planId.includes('water') ? 'primary' : 'secondary'} full-width`} onClick={() => { dispatch({ type: 'select_plan', planId: plan.planId }, `${plan.name} selected. Place your crops to record what you actually plant.`); navigate('farm'); }}>Use this plan <ArrowRight size={16} /></button></article>)}</div>
            <div className="conditions-heading"><div><h2>A closer look at the crops</h2><p>Suitability is a comparison index, not a harvest prediction.</p></div></div><div className="crop-options">{state.analysis.cropOptions.map((option) => <article key={option.cropId} className="crop-option"><CropSprite cropId={option.cropId} size={48} /><div><h3>{option.name}</h3><p>{option.reasons[0]}</p></div><span className="score">{option.score === null ? <span className="small">Needs more data</span> : <><strong>{Math.round(option.score)}</strong><span>/100</span></>}</span></article>)}</div>
            <details className="evidence-details"><summary><Database size={17} />The evidence behind this view<ChevronRight size={16} /></summary><ConditionCards analysis={state.analysis} /><SourceEvidence analysis={state.analysis} /><div className="evidence-notes"><h3>Assumptions & limitations</h3>{[...state.analysis.assumptions, ...state.analysis.limitations].map((note) => <p key={note}>• {note}</p>)}</div></details>
          </> : <div className="empty-state"><SatelliteIcon /><h2>Let's take a look from above.</h2><p>Analyze your field to explore crop options and rotation scenarios.</p><button className="button primary" onClick={() => state.boundary ? void analyze() : createFarm()}><ScanLine size={17} />{state.boundary ? 'Analyze field' : 'Draw my farm'}</button></div>}
        </>}

        {route === 'tasks' && <><div className="page-heading"><div><span className="eyebrow">ONE LITTLE THING AT A TIME</span><h1>Your farm tasks</h1><p>Check, act, or come back tomorrow. Your farm is on your side.</p></div><span className="summary-pill"><ListChecks size={16} />{dueTasks.length} due today</span></div><div className="task-list">{state.tasks.length ? state.tasks.map((task) => <TaskCard task={task} state={state} onAction={taskAction} key={task.id} />) : <div className="empty-state"><Sprout size={40} /><h2>Room for something good.</h2><p>Plant your first crop to start a care schedule.</p><button className="button primary" onClick={() => { navigate('farm'); plantShortcut(); }}>Go to your farm</button></div>}</div></>}

        {route === 'journal' && <><div className="page-heading"><div><span className="eyebrow">SMALL ACTIONS, REMEMBERED</span><h1>Your care journal</h1><p>A little record of everything you do for your farm.</p></div><span className="summary-pill"><BookOpen size={16} />{state.journal.filter((entry) => !entry.undone).length} recorded actions</span></div><div className="journal-layout"><section className="journal-list">{state.journal.length ? [...state.journal].reverse().map((entry) => <JournalRow key={entry.id} entry={entry} state={state} onUndo={() => dispatch({ type: 'undo_action', entryId: entry.id }, 'Action undone. Your task is restored.')} />) : <div className="empty-state"><BookOpen size={40} /><h2>Every little action belongs here.</h2><p>Complete or postpone a care task to start your journal.</p><button className="button primary" onClick={() => navigate('tasks')}>See your tasks <ArrowRight size={16} /></button></div>}</section><aside className="journal-note"><span className="note-illustration"><Sprout size={38} /><Sun size={22} /></span><h2>Your actions matter.</h2><p>Logging irrigation records what you did. New observations update environmental measurements.</p><div className="quiet-divider" /><p className="small">Your farm and journal are saved on this device. They are not synchronized across devices.</p></aside></div></>}

        {route === 'lab' && <><div className="page-heading"><div><span className="eyebrow">THE ORBITFARM FIELD LAB</span><h1>Small tests. Clear progress.</h1><p>Open a repeatable scenario and try the real application flow.</p></div><span className="summary-pill"><FlaskConical size={17} />Development test benches</span></div><div className="lab-explainer"><ShieldCheck size={21} /><p>Every bench uses the same interface and behavior as the app. Conditions are synthetic, the clock is fixed, and loading a scenario replaces the saved demo farm.</p></div><section className="panel scanner-preview-panel"><div className="panel-heading"><span className="step-number"><ScanLine size={18} /></span><div><h2>Meet Orbit-1</h2><p>Animation preview · no analysis request is sent and your farm stays unchanged.</p></div></div><OrbitScanner key={scannerPreviewRun} state={scannerPreview} mode="demo" /><div className="heading-actions"><button className="button primary" onClick={() => { setScannerPreview('scanning'); setScannerPreviewRun((current) => current + 1); }}><RefreshCw size={16} />Replay arrival</button><button className="button secondary" disabled={scannerPreview === 'complete'} onClick={() => setScannerPreview('complete')}><CheckCheck size={16} />Show completion</button></div></section><div className="lab-grid">{SCENARIOS.map((scenario, index) => <article className="bench-card" key={scenario.id}><span className={`bench-icon bench-${index}`}><FlaskConical size={23} /></span><span className="bench-id">BENCH 0{index + 1}</span><h2>{scenario.name}</h2><p>{scenario.description}</p><button className="button secondary full-width" onClick={() => loadScenario(scenario.id)}>Load {scenario.id}<ArrowRight size={15} /></button></article>)}</div><section className="panel api-panel"><div><span className="eyebrow">WHEN YOUR ANALYTICS ARE READY</span><h2>Connect the analysis service</h2><p>POST the agreed contract to your backend. Failures stay visible; the app never quietly switches to mock results.</p><span className="small muted">Active provider: {providerMode === 'mock' ? 'Demo fixtures' : 'Connected API'}</span></div><div className="api-controls"><label>API base URL<input type="url" value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://your-analysis-service.example" /></label><div className="heading-actions"><button className="button secondary" onClick={() => selectProvider('mock')}>Use demo fixtures</button><button className="button primary" onClick={() => selectProvider('api')}>Use API</button></div></div></section></>}
      </main>
      <footer className="app-footer"><span><Sprout size={14} />A little space. A smarter next season.</span><span>Made for NASA Space Apps · Independent project</span></footer>
      <div className="demo-clock"><span className="clock-label"><span className="live-dot" />DEMO TIME</span><strong>{displayDate(state.demoNow)}</strong><button onClick={() => dispatch({ type: 'advance_day' }, 'Demo time advanced by one day. Observation values are unchanged.')}><CalendarDays size={14} />Advance 1 day <ArrowRight size={14} /></button></div>
    </div>
  </div>;
}

function ConditionCards({ analysis }: { analysis: AnalysisResult | null }) {
  const signals = analysis?.signals.slice(0, 3) ?? [];
  const defaults = [{ label: 'Soil moisture', unit: 'm³/m³' }, { label: 'Temperature', unit: '°C' }, { label: 'Rainfall', unit: 'mm' }];
  return <div className="condition-grid">{(signals.length ? signals : defaults).map((signal, index) => {
    const actual = signals[index] ?? null;
    const Icon = index === 0 ? Droplets : index === 1 ? Sun : CloudSun;
    return <article className="condition-card" key={signal.label}><span className={`condition-icon condition-${index}`}><Icon size={19} /></span><span className="condition-label">{signal.label}</span><div className="condition-value">{actual?.value === null || !actual ? '—' : actual.value}<span>{actual?.value !== null && actual ? signal.unit : ''}</span></div><div className="condition-meta">{actual ? `${actual.origin === 'synthetic' ? 'Demo observation' : 'NASA observation'} · ${actual.quality === 'missing' ? 'Data unavailable' : actual.quality === 'stale' ? `Outdated · ${displayDate(actual.observedAt)}` : displayDate(actual.observedAt)}` : 'Analyze your field to begin'}</div>{actual && <span className="condition-source">{actual.spatialResolutionKm ? `${actual.spatialResolutionKm} km regional grid` : actual.source.dataset}</span>}</article>;
  })}</div>;
}

function SourceEvidence({ analysis }: { analysis: AnalysisResult }) {
  return <section className="source-evidence" aria-label="Analysis sources">
    <h3>Sources & observation dates</h3>
    <p>Analysis prepared {displayDate(analysis.generatedAt)} · {analysis.areaHa.toFixed(2)} hectares</p>
    {analysis.signals.map((signal) => <article key={signal.signalId}>
      <h3>{signal.label}</h3>
      <dl>
        <div><dt>Origin</dt><dd>{signal.origin === 'synthetic' ? 'Synthetic demo data' : 'NASA observation'} · {signal.quality === 'good' ? 'Available' : signal.quality === 'stale' ? 'Outdated' : 'Missing'}</dd></div>
        <div><dt>Dataset</dt><dd>{signal.source.dataset} · {signal.source.version}</dd></div>
        <div><dt>Observed</dt><dd>{signal.observedAt ? displayDate(signal.observedAt) : 'Unknown'}</dd></div>
        <div><dt>Retrieved</dt><dd>{signal.fetchedAt ? displayDate(signal.fetchedAt) : 'Unknown'}</dd></div>
        <div><dt>Resolution</dt><dd>{signal.spatialResolutionKm === null ? 'Not specified' : `${signal.spatialResolutionKm} km regional grid`}</dd></div>
        <div><dt>Source</dt><dd>{/^https?:\/\//.test(signal.source.url) ? <a href={signal.source.url} target="_blank" rel="noreferrer">{signal.source.url}</a> : signal.source.url}</dd></div>
      </dl>
    </article>)}
  </section>;
}

function TaskCard({ task, state, onAction, selected = false }: { task: CareTask; state: FarmState; onAction: (task: CareTask, type: 'complete_task' | 'skip_task' | 'snooze_task') => void; selected?: boolean }) {
  const plot = state.plots.find((item) => item.id === task.plotId);
  const isDue = getDueTasks(state).some((item) => item.id === task.id);
  const status = task.status === 'done' ? 'Done' : task.status === 'skipped' ? 'Skipped' : task.status === 'snoozed' && !isDue ? 'Snoozed' : isDue ? 'Needs a check' : 'Upcoming';
  return <article className={`task-card ${status === 'Done' ? 'task-done' : ''}`} data-testid={selected ? 'selected-task' : undefined} aria-label={`${plot ? `Plot ${plotLetter(plot.slotId)} ` : ''}${task.title}`}><div className="task-card-top"><span className="task-symbol"><Droplets size={20} /></span><span className={`task-status ${isDue ? 'attention' : ''}`}>{isDue ? <span className="status-dot" /> : <Check size={12} />}{status}</span></div><p className="task-plot">{plot ? `Plot ${plotLetter(plot.slotId)} · ${cropName(plot.cropId)}` : 'Past planting'}<span> · {isDue ? 'Today' : displayDate(task.snoozedUntilISO ?? task.dueAtISO)}</span></p><h3>{task.title}</h3><p className="task-reason">{task.reason}</p><details className="task-why"><summary>Why this? <ChevronRight size={13} /></summary><p>This reminder uses the recorded planting date and a fixed demonstration schedule. {task.kind === 'water' ? 'Check the soil locally before deciding whether to irrigate.' : 'Inspect crop condition and use a local soil test before deciding whether fertilizer is needed.'}</p><span className="small muted">Demo care schedule · Estimated growth stage</span></details>{isDue && <><button className="button primary full-width" onClick={() => onAction(task, 'complete_task')}><Check size={17} />{task.kind === 'water' ? 'Watered' : 'Done'}</button><div className="task-alternatives"><button onClick={() => onAction(task, 'skip_task')}>Skip</button><button onClick={() => onAction(task, 'snooze_task')}>Remind me tomorrow <ArrowRight size={13} /></button></div></>}</article>;
}

function PlotEditor({ state, slotId, selectedCrop, onAction }: { state: FarmState; slotId: number; selectedCrop?: CropId; onAction: (action: FarmAction, message?: string) => void }) {
  const plot = state.plots.find((item) => item.slotId === slotId);
  const [cropId, setCropId] = useState<CropId>(plot?.cropId ?? selectedCrop ?? 'wheat');
  const [plantedOn, setPlantedOn] = useState(plot?.plantedOn ?? getFarmDate(state.demoNow));
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!plot);
  if (plot && !editing) return <section className="plot-summary"><div className="plot-summary-top"><span className="crop-portrait small-portrait"><CropSprite cropId={plot.cropId} size={42} /></span><div><span className="eyebrow">PLOT {plotLetter(slotId)}</span><h3>{cropName(plot.cropId)}</h3></div><span className="growth-dot" /></div><div className="plot-detail"><span>Estimated stage</span><strong>{getGrowthStage(plot, state.demoNow)}</strong></div><div className="plot-detail"><span>Planted</span><strong>{displayDate(plot.plantedOn)}</strong></div><button className="text-button" onClick={() => setEditing(true)}>Edit planting <Settings2 size={14} /></button></section>;
  return <form className="plot-editor" onSubmit={(event) => { event.preventDefault(); if (!/^\d{4}-\d{2}-\d{2}$/.test(plantedOn) || !Number.isFinite(Date.parse(plantedOn))) { setError('Choose a valid planting date.'); return; } onAction(plot ? { type: 'edit_plot', plotId: plot.id, cropId, plantedOn } : { type: 'plant', slotId, cropId, plantedOn }, `${cropName(cropId)} ${plot ? 'updated' : 'planted'} in Plot ${plotLetter(slotId)}.`); setError(null); setEditing(false); }}><div className="plot-editor-heading"><span className="eyebrow">PLOT {plotLetter(slotId)}</span><h3>{plot ? 'A little change of plan.' : 'Make room for something good.'}</h3></div><label>Crop<select value={cropId} onChange={(event) => setCropId(event.target.value as CropId)}>{CROP_CATALOG.map((crop) => <option value={crop.id} key={crop.id}>{crop.name}</option>)}</select></label><label>Planting date<input type="date" value={plantedOn} onChange={(event) => setPlantedOn(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary full-width" type="submit"><Sprout size={16} />{plot ? 'Save planting' : 'Plant crop'}</button>{plot && <div className="task-alternatives"><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="danger-text" type="button" onClick={() => { if (window.confirm(`Remove ${cropName(plot.cropId)} from Plot ${plotLetter(slotId)}?`)) onAction({ type: 'remove_plot', plotId: plot.id }, 'Planting removed. Your journal history is preserved.'); }}><Trash2 size={13} />Remove crop</button></div>}</form>;
}

function JournalRow({ entry, state, onUndo }: { entry: JournalEntry; state: FarmState; onUndo: () => void }) {
  const plot = state.plots.find((item) => item.id === entry.plotId);
  const label = entry.action === 'watered' ? 'Irrigation logged' : entry.action === 'skipped' ? 'Task skipped' : entry.action === 'snoozed' ? 'Reminder moved to tomorrow' : 'Care task completed';
  const latest = [...state.journal].reverse().find((item) => item.taskId === entry.taskId && !item.undone)?.id === entry.id;
  return <article className={`journal-row ${entry.undone ? 'undone' : ''}`} data-testid="journal-entry"><span className="journal-row-icon">{entry.action === 'watered' ? <Droplets size={22} /> : entry.action === 'snoozed' ? <CalendarDays size={22} /> : <Check size={22} />}</span><div><span className="small muted">{displayDate(entry.createdAtISO)}{plot ? ` · Plot ${plotLetter(plot.slotId)} · ${cropName(plot.cropId)}` : ' · Past planting'}</span><h3>{label}</h3><p>{entry.undone ? 'Undone · the task has been restored.' : 'Your action is recorded on this device.'}</p></div>{!entry.undone && latest && state.tasks.some((task) => task.id === entry.taskId) && <button className="button secondary compact" onClick={onUndo}><Undo2 size={15} />Undo</button>}{entry.undone && <span className="muted small">Undone</span>}</article>;
}
