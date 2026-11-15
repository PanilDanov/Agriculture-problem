import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Polygon } from 'geojson';
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarDays, Check, CheckCheck,
  ChevronRight, CloudSun, Database, Droplets, FlaskConical,
  Leaf, ListChecks, MapPin, Plus, RefreshCw, ScanLine,
  Settings2, ShieldCheck, Sprout, Sun, Trash2, Undo2, Wheat, X,
} from 'lucide-react';
import {
  CROP_CATALOG, SCENARIOS, buildAnalysisRequest, createApiProvider,
  createMockProvider, createScenarioState, createDefaultLayout, dateSchema, farmReducer, getDueTasks,
  addFarmDays, canUndoJournalEntry, daysBetweenFarmDates, getEstimatedHarvestDate,
  getFarmDate, getGrowthStage, getLastWatering, getBedName, loadFarm, loadProviderSettings,
  saveFarm, saveProviderSettings, validateBoundary, validateFarmLayout,
} from './domain/orbitFarm-domain';
import type {
  AnalysisResult, CareTask, CropId, FarmAction, FarmInputs, FarmLayout, FarmState,
  JournalEntry, ProviderSettings, ScenarioId,
} from './domain/orbitFarm-types';
import { CropSprite, FarmScene, SatelliteIcon } from './components/orbitFarm-farm-scene';
const BoundaryMap = lazy(() => import('./components/orbitFarm-boundary-map').then((module) => ({ default: module.BoundaryMap })));
const FarmLayoutEditor = lazy(() => import('./components/orbitFarm-layout-editor').then((module) => ({ default: module.FarmLayoutEditor })));
import { OrbitScanner } from './components/orbitFarm-scanner';
import { getFarmSeasonStops } from './components/orbitFarm-seasons';
import { Select } from './components/orbitFarm-select';

type Route = 'farm' | 'plans' | 'tasks' | 'journal' | 'lab' | 'setup' | 'layout';
type TaskAction = 'complete_task' | 'skip_task' | 'snooze_task';
type UndoTarget = { taskId: string } | { wateredPlotId: string };
interface SeasonRange { start: string; end: string }
interface Draft { name: string; inputs: FarmInputs; boundary: Polygon | null }
const NAV = [
  { route: 'farm', label: 'Your farm', icon: Sprout },
  { route: 'plans', label: 'Rotation plans', icon: Leaf },
  { route: 'tasks', label: 'Tasks', icon: ListChecks },
  { route: 'journal', label: 'Journal', icon: BookOpen },
] as const;
const TEXTURES = ['sand', 'loamy_sand', 'sandy_loam', 'loam', 'silt_loam', 'silt', 'sandy_clay_loam', 'clay_loam', 'silty_clay_loam', 'sandy_clay', 'silty_clay', 'clay'];
const hostedAnalysis = import.meta.env.VITE_ORBITFARM_LIVE_API === '1';
const defaultScenario = hostedAnalysis ? 'empty-farm' : 'dry-week';
const defaultApiBaseUrl = () => import.meta.env.VITE_API_BASE_URL?.trim()
  || (hostedAnalysis ? window.location.origin : 'http://localhost:8000');
const cropName = (id: CropId) => CROP_CATALOG.find((crop) => crop.id === id)?.name ?? id;
const human = (value: string) => value.replaceAll('_', ' ');
const localFarmDate = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const displayDate = (value: string) => {
  const [year, month, day] = getFarmDate(value).split('-');
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
};
const readRoute = (): Route => {
  const route = window.location.hash.replace(/^#\//, '').split('/')[0];
  return ['farm', 'plans', 'tasks', 'journal', 'lab', 'setup', 'layout'].includes(route) ? route as Route : 'farm';
};

function restore() {
  const baseUrl = defaultApiBaseUrl();
  try {
    const farm = loadFarm(window.localStorage, defaultScenario);
    const { settings, error } = loadProviderSettings(window.localStorage);
    const fallbackMode = hostedAnalysis || error || (farm.state.analysis && farm.state.analysis.dataMode !== 'mock') ? 'api' : 'mock';
    const legacyLocalUrl = hostedAnalysis && /^http:\/\/(localhost|127\.0\.0\.1):8000\/?$/.test(settings?.baseUrl ?? '');
    const provider: ProviderSettings = {
      mode: settings?.mode ?? fallbackMode,
      baseUrl: legacyLocalUrl ? baseUrl : settings?.baseUrl ?? baseUrl,
    };
    return { ...farm, provider, providerError: error };
  } catch {
    return { state: createScenarioState(defaultScenario), error: 'Saved farms are unavailable in this browser. Changes will remain in this session.', provider: { mode: 'api', baseUrl } as ProviderSettings, providerError: 'Select an analysis provider in Test benches. Saved settings are unavailable.' };
  }
}

export function OrbitFarmApp() {
  const [initial] = useState(restore);
  const [state, setState] = useState<FarmState>(() => ({ ...initial.state, demoToday: localFarmDate() }));
  const [route, setRoute] = useState<Route>(readRoute);
  const routeRef = useRef(route);
  const layoutDirtyRef = useRef(false);
  const allowLayoutLeaveRef = useRef(false);
  const reportLayoutDirty = useCallback((dirty: boolean) => { layoutDirtyRef.current = dirty; }, []);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(initial.state.layout.beds[0]?.slotId ?? null);
  const [mapView, setMapView] = useState(false);
  const [seasonDate, setSeasonDate] = useState<string | null>(null);
  const [notice, setNoticeValue] = useState<string | null>(null);
  const [noticeUndo, setNoticeUndo] = useState<UndoTarget | null>(null);
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
  const updateFarmDate = useCallback(() => {
    const today = localFarmDate();
    setState(current => current.demoToday === today ? current : { ...current, demoToday: today });
  }, []);
  const dueTasks = useMemo(() => getDueTasks(state), [state]);
  const selectedPlot = state.plots.find((plot) => plot.slotId === selectedSlotId);
  const dueWatering = dueTasks.find(task => task.plotId === selectedPlot?.id && task.kind === 'water');
  const selectedPlan = state.analysis?.rotationPlans.find((plan) => plan.planId === state.selectedPlanId);
  const noticeEntry = noticeUndo ? [...state.journal].reverse().find(entry => !entry.undone && (
    'taskId' in noticeUndo ? entry.taskId === noticeUndo.taskId
      : entry.plotId === noticeUndo.wateredPlotId && entry.action === 'watered'
  )) : undefined;
  const lastUndoable = noticeEntry && canUndoJournalEntry(state, noticeEntry) ? noticeEntry : undefined;
  const season = useMemo<SeasonRange | null>(() => {
    if (providerMode !== 'mock') return null;
    let start = state.demoToday;
    let end = addFarmDays(state.demoToday, 365);
    for (const plot of state.plots) {
      if (plot.plantedOn < start) start = plot.plantedOn;
      const harvest = getEstimatedHarvestDate(plot);
      if (harvest > end) end = harvest;
    }
    return { start: addFarmDays(start, -1), end };
  }, [providerMode, state.demoToday, state.plots]);
  const viewDate = season && !mapView && seasonDate ? seasonDate : state.demoToday;

  function setNotice(message: string | null, undo?: UndoTarget) {
    setNoticeValue(message);
    setNoticeUndo(undo ?? null);
  }
  function selectProvider(mode: ProviderSettings['mode']) {
    let baseUrl = apiBaseUrl.trim();
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid service URL');
    } catch {
      if (mode === 'api') { setProviderError('Use an HTTP or HTTPS analysis service URL without embedded credentials.'); return; }
      baseUrl = defaultApiBaseUrl();
    }
    setProviderMode(mode);
    setSeasonDate(null);
    setApiBaseUrl(baseUrl);
    try { setProviderError(saveProviderSettings({ mode, baseUrl }, window.localStorage)); }
    catch { setProviderError('Provider settings could not be saved. Your selection remains active in this tab.'); }
    setNotice(mode === 'mock' ? 'Demo fixtures selected.' : 'API provider selected.');
  }

  function navigate(next: Route, allowLayoutLeave = false) {
    allowLayoutLeaveRef.current = allowLayoutLeave;
    window.location.hash = `/${next}`;
  }
  function dispatch(action: FarmAction, message?: string) {
    setState((current) => farmReducer(current, action));
    if (message) {
      const undo = 'taskId' in action ? { taskId: action.taskId }
        : action.type === 'record_watering' ? { wateredPlotId: action.plotId } : undefined;
      setNotice(message, undo);
    }
  }
  useEffect(() => {
    const onHash = () => {
      const next = readRoute();
      if (routeRef.current === 'layout' && next !== 'layout' && layoutDirtyRef.current && !allowLayoutLeaveRef.current) {
        if (!window.confirm('Leave without saving your layout changes?')) {
          window.history.replaceState(null, '', '#/layout');
          return;
        }
      }
      allowLayoutLeaveRef.current = false;
      if (next !== 'layout') layoutDirtyRef.current = false;
      if (next !== 'farm') setSeasonDate(null);
      routeRef.current = next;
      setRoute(next);
      window.scrollTo({ top: 0 });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (routeRef.current !== 'layout' || !layoutDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('beforeunload', onBeforeUnload); };
  }, []);
  useEffect(() => {
    if (lastSaved.current === state || recoveryRequired) return;
    lastSaved.current = state;
    try { setStorageError(saveFarm(state, window.localStorage)); }
    catch { setStorageError('Your changes could not be saved. Keep this tab open and try again.'); }
  }, [state, recoveryRequired]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const timer = window.setInterval(updateFarmDate, 60_000);
    window.addEventListener('focus', updateFarmDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateFarmDate);
    };
  }, [updateFarmDate]);
  useEffect(() => {
    if (!state.layout.beds.some((bed) => bed.slotId === selectedSlotId)) setSelectedSlotId(state.layout.beds[0]?.slotId ?? null);
  }, [state.layout, selectedSlotId]);

  function saveLayout(layout: FarmLayout) {
    const checked = validateFarmLayout(layout);
    if (!checked.valid) { setNotice(checked.errors[0] ?? 'Check your bed shapes before saving.'); return; }
    const removed = state.plots.filter((plot) => !layout.beds.some((bed) => bed.slotId === plot.slotId));
    if (removed.length && !window.confirm(`Remove ${removed.length} planted ${removed.length === 1 ? 'bed' : 'beds'} from this layout? Their plantings and open tasks will be removed. Your journal history will be kept.`)) return;
    dispatch({ type: 'set_layout', layout }, 'Farm layout saved.');
    setSelectedSlotId(layout.beds.some((bed) => bed.slotId === selectedSlotId) ? selectedSlotId : layout.beds[0]?.slotId ?? null);
    setMapView(false);
    navigate('farm', true);
  }

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
      const provider = providerMode === 'api'
        ? createApiProvider(apiBaseUrl, hostedAnalysis ? { timeoutMs: 55_000 } : undefined)
        : createMockProvider(target.scenarioId);
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
    const boundary = validateBoundary(draft.boundary);
    if (!boundary.valid || !draft.boundary) { setFormError(boundary.errors[0] ?? 'Draw a closed field boundary before continuing.'); return; }
    const inputs = structuredClone(draft.inputs);
    inputs.soil.source = inputs.soil.ph === null && inputs.soil.texture === null ? 'unknown' : 'farmer_reported';
    const freshFarm = createScenarioState('empty-farm');
    if (!editingFarm && state.boundary === null) freshFarm.layout = structuredClone(state.layout);
    const next: FarmState = {
      ...(editingFarm ? state : freshFarm),
      demoToday: localFarmDate(),
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
    if ((state.name !== 'Meadow Farm' || state.journal.length > 0 || recoveryRequired || JSON.stringify(state.layout) !== JSON.stringify(createDefaultLayout())) && !window.confirm('Replace the saved demo farm with this test scenario?')) return;
    abort.current?.abort();
    setState({ ...createScenarioState(id), demoToday: localFarmDate() });
    setRecoveryRequired(false);
    setStorageError(null);
    setSelectedSlotId(0);
    selectProvider('mock');
    setMapView(false);
    setNotice(`Loaded ${SCENARIOS.find((scenario) => scenario.id === id)?.name ?? id}.`);
    navigate('farm');
  }
  function plantShortcut() {
    if (!state.layout.beds.length) { setNotice('Draw a bed first.'); navigate('layout'); return; }
    const empty = state.layout.beds.find((bed) => !state.plots.some((plot) => plot.slotId === bed.slotId));
    setSelectedSlotId(empty?.slotId ?? state.plots[0]?.slotId ?? state.layout.beds[0].slotId);
    setNotice(empty ? `${empty.name} is ready. Choose a crop in the planting panel.` : 'Select a bed to edit its planting.');
  }
  function taskAction(task: CareTask, type: TaskAction) {
    dispatch({ type, taskId: task.id }, type === 'complete_task' ? task.kind === 'water' ? 'Irrigation logged.' : 'Care task completed.' : type === 'skip_task' ? 'Task skipped.' : 'Reminder moved to tomorrow.');
  }

  return <div className="app-shell">
    <a className="skip-link" href={`#/${route}`} onClick={(event) => { event.preventDefault(); const main = document.getElementById('main-content'); main?.focus(); main?.scrollIntoView({ block: 'start' }); }}>Skip to content</a>
    <aside className="sidebar">
      <a className="wordmark" href="#/farm" aria-label="orbitFarm home"><span className="brand-mark"><Sprout size={23} /></span><span className="brand-name">orbitFarm<span className="brand-period" aria-hidden="true">.</span></span></a>
      <div className="farm-identity"><span className="farm-avatar"><Wheat size={24} /></span><div><strong data-testid="farm-name">{state.name}</strong></div></div>
      <nav aria-label="Main navigation">
        {NAV.map(({ route: target, label, icon: Icon }) => <a key={target} href={`#/${target}`} aria-label={label} className={`nav-link ${(route === target || (target === 'farm' && route === 'layout')) ? 'active' : ''}`} aria-current={(route === target || (target === 'farm' && route === 'layout')) ? 'page' : undefined}><Icon size={19} /><span>{label}</span>{target === 'tasks' && dueTasks.length > 0 && <span className="nav-count">{dueTasks.length}</span>}</a>)}
      </nav>
      <div className="sidebar-bottom"><a href="#/lab" className={`nav-link ${route === 'lab' ? 'active' : ''}`}><FlaskConical size={18} />Test benches</a></div>
    </aside>
    <div className="app-body">
      {storageError && <div className="storage-alert" role="alert"><Database size={18} /><span>{storageError}</span>{recoveryRequired ? <button onClick={() => loadScenario('dry-week')}>Reset demo safely</button> : <button onClick={() => { try { setStorageError(saveFarm(state, window.localStorage)); } catch { setStorageError('Browser storage is still unavailable.'); } }}>Try saving again</button>}</div>}
      {providerError && <div className="storage-alert" role="alert"><Database size={18} /><span>{providerError}</span><button onClick={() => navigate('lab')}>Open provider settings</button></div>}
      {notice && <div className="notice" role="status"><Check size={17} /><span>{notice}</span>{lastUndoable && <button className="text-button" onClick={() => { dispatch({ type: 'undo_action', entryId: lastUndoable.id }); setNotice('Action undone.'); }}><Undo2 size={15} />Undo</button>}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}
      <main id="main-content" tabIndex={-1}>
        {route === 'farm' && <>
          <div className="page-heading"><div><h1>Your farm</h1></div><div className="heading-actions"><button className="button secondary" disabled={Boolean(state.pendingRequestId)} onClick={() => state.boundary ? void analyze() : createFarm()}><ScanLine size={17} />Analyze field</button><button className="button primary" onClick={createFarm}><Plus size={17} />Create farm</button></div></div>
          {state.pendingRequestId && <OrbitScanner key={state.pendingRequestId} mode={analysisMode} compact />}
          <div className="farm-layout"><section className="farm-main">
            <div className={`farm-window${mapView ? '' : ' farm-window--scene'}`}>
              <div className="farm-window-toolbar">
                <div>
                  <span className="live-dot" />
                  <strong>{state.name}</strong>
                  <span className="muted">{state.boundary ? `${validateBoundary(state.boundary).areaHa.toFixed(1)} ha` : 'No field selected'}</span>
                </div>
                <div className="farm-view-actions">
                  <button className="text-button edit-layout-button" onClick={() => navigate('layout')}><Settings2 size={15} />Edit layout</button>
                  <div className="segmented" aria-label="Field view">
                    <button aria-pressed={!mapView} onClick={() => setMapView(false)}><Sprout size={14} />Farm</button>
                    <button aria-pressed={mapView} onClick={() => { setPendingBoundary(state.boundary); setSeasonDate(null); setMapView(true); }}><MapPin size={14} />Map</button>
                  </div>
                </div>
              </div>
              {mapView ? <div className="map-workspace"><Suspense fallback={<p className="muted small">Loading the field map…</p>}><BoundaryMap boundary={pendingBoundary} error={pendingBoundary ? validateBoundary(pendingBoundary).errors[0] : null} onChange={setPendingBoundary} /></Suspense><button className="button primary" onClick={() => { const checked = validateBoundary(pendingBoundary); if (checked.valid && pendingBoundary) { dispatch({ type: 'set_boundary', boundary: pendingBoundary }, 'Boundary saved. Analyze the field to refresh its recommendations.'); setMapView(false); } else setNotice(checked.errors[0] ?? 'Draw a valid field boundary.'); }}>Confirm boundary</button></div> : <>
                {season && <SeasonPreview
                  range={season}
                  date={viewDate}
                  currentDate={state.demoToday}
                  onChange={setSeasonDate}
                  onReset={() => {
                    updateFarmDate();
                    setSeasonDate(null);
                  }}
                />}
                <FarmScene
                  layout={state.layout}
                  plots={state.plots}
                  selectedSlotId={selectedSlotId}
                  onSelectSlot={setSelectedSlotId}
                  viewDate={viewDate}
                  isScanning={Boolean(state.pendingRequestId)}
                />
              </>}
              <div className="farm-bed-controls">
                {state.layout.beds.length ? <Select label="Selected bed" value={selectedSlotId === null ? '' : String(selectedSlotId)} onChange={(value) => setSelectedSlotId(Number(value))} options={state.layout.beds.map((bed) => { const plot = state.plots.find((item) => item.slotId === bed.slotId); return { value: String(bed.slotId), label: `${bed.name} · ${plot ? cropName(plot.cropId) : 'Empty'}` }; })} /> : <p className="muted small">Draw a bed to plant a crop.</p>}
                <span className="bed-count">{state.layout.beds.length} {state.layout.beds.length === 1 ? 'bed' : 'beds'}</span>
              </div>
              <div className="farm-window-footer"><span><span className="legend-dot planted" />{state.plots.length} planted plots</span><span className="scene-caption">Schematic · not to scale</span></div>
            </div>
          </section>
          <aside className="care-sidebar" aria-label="Bed details">
            {selectedSlotId !== null && state.boundary && state.layout.beds.some(bed => bed.slotId === selectedSlotId) && <PlotEditor
              key={`${state.farmId}-${selectedSlotId}-${selectedPlot?.id ?? 'empty'}`}
              state={state}
              slotId={selectedSlotId}
              viewDate={viewDate}
              onAction={dispatch}
              selectedCrop={selectedPlan?.sequence[0]}
              dueWatering={dueWatering}
              onTaskAction={taskAction}
            />}
            <div className="field-context"><div><span>Soil texture</span><strong>{state.inputs.soil.texture ? human(state.inputs.soil.texture) : 'Unknown'}</strong></div><div><span>Priority</span><strong>{human(state.inputs.priority)}</strong></div><button className="text-button" onClick={editField}>Edit field information <Settings2 size={14} /></button></div>
          </aside>
          <section className="farm-conditions">
            <div className="conditions-heading"><div><h2>Conditions</h2></div><button className="text-button" onClick={() => navigate('plans')}>View analysis <ArrowRight size={15} /></button></div>
            <ConditionCards analysis={state.analysis} />
            {selectedPlan && <div className="season-strip"><div className="season-strip-icon"><Leaf size={24} /></div><div><h3>{selectedPlan.sequence.map(cropName).join(' → ')}</h3></div><button className="button secondary" onClick={() => navigate('plans')}>Compare plans <ArrowRight size={16} /></button></div>}
          </section></div>
        </>}

        {route === 'layout' && <>
          <Suspense fallback={<div className="panel layout-loading" role="status">Getting your planning board ready…</div>}><FarmLayoutEditor layout={state.layout} plantedSlotIds={state.plots.map((plot) => plot.slotId)} onSave={saveLayout} onDirtyChange={reportLayoutDirty} onCancel={() => navigate('farm', true)} /></Suspense>
        </>}

        {route === 'setup' && <>
          <button className="text-button back-button" onClick={() => navigate('farm')}><ArrowLeft size={16} />Back to your farm</button>
          <div className="page-heading"><div><h1>Field setup</h1></div><span className={`data-badge ${providerMode === 'mock' ? 'demo' : 'nasa'}`}><span />{providerMode === 'mock' ? 'Demo analysis' : 'Connected API'}</span></div>
          <form className="setup-layout" onSubmit={submitFarm} noValidate>
            <section className="panel boundary-panel"><div className="panel-heading"><span className="step-number">01</span><div><h2>Field boundary</h2></div></div><Suspense fallback={<p className="muted small">Loading the field map…</p>}><BoundaryMap boundary={draft.boundary} error={draft.boundary ? validateBoundary(draft.boundary).errors[0] : null} onChange={(boundary) => setDraft((current) => ({ ...current, boundary }))} /></Suspense><div className="boundary-summary"><MapPin size={16} /><span>{draft.boundary ? `${validateBoundary(draft.boundary).areaHa.toFixed(2)} ha` : 'No boundary selected'}</span></div></section>
            <section className="panel setup-fields"><div className="panel-heading"><span className="step-number">02</span><div><h2>Field details</h2></div></div>
              <label>Farm name<input name="farmName" value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <div className="form-divider">SOIL & WATER</div>
              <div className="form-row"><label>Soil pH<input type="number" min="0" max="14" step="0.1" placeholder="Unknown" value={draft.inputs.soil.ph ?? ''} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, soil: { ...draft.inputs.soil, ph: e.target.value === '' ? null : Number(e.target.value) } } })} /></label><Select label="Soil texture" value={draft.inputs.soil.texture ?? ''} onChange={(value) => setDraft({ ...draft, inputs: { ...draft.inputs, soil: { ...draft.inputs.soil, texture: value || null } } })} options={[{ value: '', label: 'Unknown' }, ...TEXTURES.map((texture) => ({ value: texture, label: human(texture) }))]} /></div>
              <Select label="Irrigation access" value={draft.inputs.irrigation.availability} onChange={(value) => { const availability = value as FarmInputs['irrigation']['availability']; setDraft({ ...draft, inputs: { ...draft.inputs, irrigation: { availability, method: null, volumeM3: availability === 'none' ? 0 : null } } }); }} options={[{ value: 'unknown', label: 'Unknown' }, { value: 'available', label: 'Available' }, { value: 'none', label: 'No irrigation' }]} />
              {draft.inputs.irrigation.availability === 'available' && <div className="form-row"><label>Water budget (m³)<input type="number" min="0" placeholder="Unknown" value={draft.inputs.irrigation.volumeM3 ?? ''} onChange={(e) => setDraft({ ...draft, inputs: { ...draft.inputs, irrigation: { ...draft.inputs.irrigation, volumeM3: e.target.value === '' ? null : Number(e.target.value) } } })} /></label><Select label="Irrigation method" value={draft.inputs.irrigation.method ?? ''} onChange={(value) => setDraft({ ...draft, inputs: { ...draft.inputs, irrigation: { ...draft.inputs.irrigation, method: value as FarmInputs['irrigation']['method'] || null } } })} options={[{ value: '', label: 'Unknown' }, { value: 'drip', label: 'Drip' }, { value: 'sprinkler', label: 'Sprinkler' }, { value: 'surface', label: 'Surface' }]} /></div>}
              <p className="field-hint">Total water available for the whole field.</p>
              <div className="form-row"><Select label="Main priority" value={draft.inputs.priority} onChange={(value) => setDraft({ ...draft, inputs: { ...draft.inputs, priority: value as FarmInputs['priority'] } })} options={[{ value: 'balanced', label: 'Balanced' }, { value: 'save_water', label: 'Save water' }, { value: 'improve_soil', label: 'Improve soil' }]} /><Select label="Previous crop" value={draft.inputs.previousCropId ?? ''} onChange={(value) => setDraft({ ...draft, inputs: { ...draft.inputs, previousCropId: value as CropId || null } })} options={[{ value: '', label: 'Unknown' }, ...CROP_CATALOG.map((crop) => ({ value: crop.id, label: crop.name }))]} /></div>
              {formError && <div className="form-error" role="alert">{formError}</div>}
              <button className="button primary full-width" type="submit"><ScanLine size={18} />Analyze my farm <ArrowRight size={16} /></button><p className="field-hint centered">{providerMode === 'mock' ? 'Demo analysis' : 'Sends field data to your analysis service.'}</p>
            </section>
          </form>
        </>}

        {route === 'plans' && <>
          <div className="page-heading"><div><h1>Rotation plans</h1></div><button className="button secondary" disabled={Boolean(state.pendingRequestId)} onClick={() => state.boundary ? void analyze() : createFarm()}><RefreshCw size={16} />Analyze field</button></div>
          {state.pendingRequestId ? <OrbitScanner key={state.pendingRequestId} mode={analysisMode} /> : state.analysisError ? <div className="analysis-error" role="alert"><span className="error-icon"><CloudSun size={30} /></span><h2>Analysis unavailable</h2><p>{state.analysisError}</p><div className="heading-actions"><button className="button primary" onClick={() => void analyze()}><RefreshCw size={16} />Try again</button><button className="button secondary" onClick={() => navigate('farm')}>Back to farm</button></div>{state.analysis && <p className="small muted">Your last available analysis and saved farm are preserved.</p>}</div> : state.analysis ? <>
            <div className="rotation-grid">{state.analysis.rotationPlans.map((plan) => (
              <article className={`rotation-card ${plan.planId.includes('water') ? 'featured' : ''}`} key={plan.planId} aria-label={`${plan.name} plan`}>
                <h2>{plan.name}</h2>
                {plan.planStatus === 'provisional' && <p className="small muted">Provisional plan</p>}
                <div className="rotation-sequence">{plan.sequence.map((crop, index) => {
                  const season = plan.seasons?.[index];
                  return <div key={`${crop}-${index}`}>
                    <span className="crop-portrait"><CropSprite cropId={crop} size={60} /></span>
                    <span className="small muted">Season {index + 1}</span>
                    <strong>{cropName(crop)}</strong>
                    {season && <span className="small muted">
                      {season.recommendedPlantingDate ? `Planting ${displayDate(season.recommendedPlantingDate)}` : 'Planting date unavailable'}
                    </span>}
                  </div>;
                })}<ArrowRight size={20} /></div>
                {plan.waterScreenMm !== undefined && <p className="small muted">
                  {plan.waterScreenMm === null ? 'Historical water comparison unavailable' : `Historical water screen · ${Math.round(plan.waterScreenMm)} mm`}
                </p>}
                <details className="plan-details">
                  <summary>Details</summary>
                  <ul className="plan-reasons">{plan.reasons.map((reason) => <li key={reason}><Check size={15} />{reason}</li>)}</ul>
                  <div className="plan-tradeoffs">{plan.tradeoffs.map((tradeoff) => <p key={tradeoff}>{tradeoff}</p>)}</div>
                </details>
                <button className={`button ${plan.planId.includes('water') ? 'primary' : 'secondary'} full-width`} onClick={() => {
                  dispatch({ type: 'select_plan', planId: plan.planId }, `${plan.name} selected.`);
                  navigate('farm');
                }}>Use this plan <ArrowRight size={16} /></button>
              </article>
            ))}</div>
            <div className="conditions-heading"><div><h2>Crop suitability</h2></div></div><div className="crop-options">{state.analysis.cropOptions.map((option) => <article key={option.cropId} className="crop-option"><CropSprite cropId={option.cropId} size={48} /><div><h3>{option.name}</h3><p>{option.recommendedPlantingDate ? `Recommended planting: ${displayDate(option.recommendedPlantingDate)}` : 'Planting date unavailable'}</p><details className="crop-details"><summary>Details</summary>{option.reasons.map(reason => <p key={reason}>{reason}</p>)}</details></div><span className="score">{option.score === null ? <span className="small">Needs more data</span> : <><strong>{Math.round(option.score)}</strong><span>/100</span></>}</span></article>)}</div>
            <details className="evidence-details"><summary><Database size={17} />Sources & details<ChevronRight size={16} /></summary><ConditionCards analysis={state.analysis} /><SourceEvidence analysis={state.analysis} /><div className="evidence-notes"><h3>Assumptions & limitations</h3><p>Suitability scores compare crops; they do not predict harvests.</p>{[...state.analysis.assumptions, ...state.analysis.limitations].map((note) => <p key={note}>• {note}</p>)}</div></details>
          </> : <div className="empty-state"><SatelliteIcon /><h2>No analysis yet</h2><button className="button primary" onClick={() => state.boundary ? void analyze() : createFarm()}><ScanLine size={17} />{state.boundary ? 'Analyze field' : 'Draw my farm'}</button></div>}
        </>}

        {route === 'tasks' && <><div className="page-heading"><div><h1>Tasks</h1></div><span className="summary-pill"><ListChecks size={16} />{dueTasks.length} due today</span></div><div className="task-list">{state.tasks.length ? state.tasks.map((task) => <TaskCard task={task} state={state} onAction={taskAction} key={task.id} />) : <div className="empty-state"><Sprout size={40} /><h2>No tasks yet</h2><p>Plant a crop to add care reminders.</p><button className="button primary" onClick={() => { navigate('farm'); plantShortcut(); }}>Go to your farm</button></div>}</div></>}

        {route === 'journal' && <><div className="page-heading"><div><h1>Journal</h1><p>Saved on this device</p></div><span className="summary-pill"><BookOpen size={16} />{state.journal.filter((entry) => !entry.undone).length} recorded actions</span></div><div className="journal-layout"><section className="journal-list">{state.journal.length ? [...state.journal].reverse().map((entry) => <JournalRow key={entry.id} entry={entry} state={state} onUndo={() => dispatch({ type: 'undo_action', entryId: entry.id }, 'Action undone.')} />) : <div className="empty-state"><BookOpen size={40} /><h2>No activity yet</h2><button className="button primary" onClick={() => navigate('tasks')}>See your tasks <ArrowRight size={16} /></button></div>}</section></div></>}

        {route === 'lab' && <><div className="page-heading"><div><h1>Test benches</h1></div></div><div className="lab-explainer"><ShieldCheck size={21} /><p>Loading a scenario replaces the saved farm with demo data.</p></div><section className="panel scanner-preview-panel"><div className="panel-heading"><span className="step-number"><ScanLine size={18} /></span><div><h2>Scanner preview</h2></div></div><OrbitScanner key={scannerPreviewRun} state={scannerPreview} mode="demo" /><div className="heading-actions"><button className="button primary" onClick={() => { setScannerPreview('scanning'); setScannerPreviewRun((current) => current + 1); }}><RefreshCw size={16} />Replay arrival</button><button className="button secondary" disabled={scannerPreview === 'complete'} onClick={() => setScannerPreview('complete')}><CheckCheck size={16} />Show completion</button></div></section><div className="lab-grid">{SCENARIOS.map((scenario, index) => <article className="bench-card" key={scenario.id}><span className={`bench-icon bench-${index}`}><FlaskConical size={23} /></span><span className="bench-id">BENCH 0{index + 1}</span><h2>{scenario.name}</h2><p>{scenario.description}</p><button className="button secondary full-width" onClick={() => loadScenario(scenario.id)}>Load {scenario.id}<ArrowRight size={15} /></button></article>)}</div><section className="panel api-panel"><div><h2>Analysis service</h2><span className="small muted">Active provider: {providerMode === 'mock' ? 'Demo fixtures' : 'Connected API'}</span></div><div className="api-controls"><label>API base URL<input type="url" value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://your-analysis-service.example" /></label><div className="heading-actions"><button className="button secondary" onClick={() => selectProvider('mock')}>Use demo fixtures</button><button className="button primary" onClick={() => selectProvider('api')}>Use API</button></div></div></section></>}
      </main>
    </div>
  </div>;
}

function SeasonPreview({ range, date, currentDate, onChange, onReset }: {
  range: SeasonRange;
  date: string;
  currentDate: string;
  onChange: (date: string) => void;
  onReset: () => void;
}) {
  const [stationJump, setStationJump] = useState(false);
  const duration = daysBetweenFarmDates(range.start, range.end);
  const elapsed = Math.max(0, Math.min(duration, daysBetweenFarmDates(range.start, date)));
  const progress = duration > 0 ? elapsed / duration * 100 : 0;
  const stations = getFarmSeasonStops(range.start, range.end, currentDate).map(stop => ({
    ...stop,
    label: stop.season[0].toUpperCase() + stop.season.slice(1),
    position: duration > 0 ? daysBetweenFarmDates(range.start, stop.date) / duration * 100 : 0,
  }));
  const alignStations = duration <= 400;
  const dateLabel = displayDate(date);
  return (
    <section className="farm-season-preview" aria-label="Season preview">
      <div className="season-preview-heading">
        <label htmlFor="season-preview-date">Season preview</label>
        <time dateTime={date}>{dateLabel}</time>
        <button type="button" className="text-button" disabled={date === currentDate} onClick={() => {
          setStationJump(true);
          onReset();
        }}>Current day</button>
      </div>
      <div className={stationJump ? 'season-flight season-flight-jump' : 'season-flight'}>
        <div className="season-flight-rail">
          <input
            id="season-preview-date"
            className="season-flight-input"
            type="range"
            min={0}
            max={duration}
            aria-valuetext={dateLabel}
            aria-describedby="season-preview-range"
            value={elapsed}
            onPointerDown={() => setStationJump(false)}
            onChange={event => {
              setStationJump(false);
              onChange(addFarmDays(range.start, event.currentTarget.valueAsNumber));
            }}
          />
          <div className="season-flight-path" aria-hidden="true">
            <div className="season-flight-line">
              {!alignStations && stations.map(station => (
                <span key={station.season} className="season-flight-tick" data-season={station.season} style={{ left: station.position + '%' }} />
              ))}
              <div className="season-flight-progress" style={{ width: progress + '%' }}>
                <svg className="season-flight-satellite" width="44" height="28" viewBox="0 0 44 28" shapeRendering="crispEdges">
                  <path fill="#30493D" d="M2 7h13v13H2z M29 7h13v13H29z M13 12h18v4H13z M16 8h12v13H16z M22 4h2v5h-2z" />
                  <path fill="#5D9188" d="M3 8h11v11H3z M30 8h11v11H30z" />
                  <path fill="#B2D0B1" d="M4 10h9v1H4z M31 10h9v1h-9z" />
                  <path fill="#426F68" d="M8 9h1v9H8z M35 9h1v9h-1z" />
                  <path fill="#F2E6BE" d="M17 9h10v11H17z" />
                  <path fill="#9FAF82" d="M17 17h10v3H17z" />
                  <path fill="#3E655E" d="M19 11h6v5h-6z" />
                  <path fill="#86B6AB" d="M20 12h4v2h-4z" />
                  <path fill="#C8935F" d="M22 21h2v3h-2z" />
                  <path fill="#EBC97F" d="M22 3h3v2h-3z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
        {stations.length > 0 && <div className={alignStations ? 'season-stations season-stations-aligned' : 'season-stations'} role="group" aria-label="Season shortcuts">
          {stations.map(station => (
            <button key={station.season} type="button" className="season-station"
              data-season={station.season} style={alignStations ? { left: station.position + '%' } : undefined}
              aria-label={station.label + ', ' + displayDate(station.date)}
              aria-current={station.date === date ? 'date' : undefined}
              title={displayDate(station.date)}
              onClick={() => {
                setStationJump(true);
                onChange(station.date);
              }}>
              {station.label}
            </button>
          ))}
        </div>}
      </div>
      <span id="season-preview-range" hidden>{displayDate(range.start)} to {displayDate(range.end)}</span>
    </section>
  );
}

function ConditionCards({ analysis }: { analysis: AnalysisResult | null }) {
  const signals = analysis?.signals.slice(0, 3) ?? [];
  const defaults = [{ label: 'Soil moisture', unit: 'm³/m³' }, { label: 'Temperature', unit: '°C' }, { label: 'Rainfall', unit: 'mm' }];
  return <div className="condition-grid">{(signals.length ? signals : defaults).map((signal, index) => {
    const actual = signals[index] ?? null;
    const Icon = index === 0 ? Droplets : index === 1 ? Sun : CloudSun;
    return <article className="condition-card" key={signal.label}><span className={`condition-icon condition-${index}`}><Icon size={19} /></span><span className="condition-label">{signal.label}</span><div className="condition-value">{actual?.value === null || !actual ? '—' : actual.value}<span>{actual?.value !== null && actual ? signal.unit : ''}</span></div><div className="condition-meta">{actual ? actual.quality === 'missing' ? 'Unavailable' : `${actual.quality === 'stale' ? 'Outdated · ' : ''}${displayDate(actual.observedAt)}` : 'No data'}</div></article>;
  })}</div>;
}

function SourceEvidence({ analysis }: { analysis: AnalysisResult }) {
  return <section className="source-evidence" aria-label="Analysis sources">
    <h3>Data sources</h3>
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

function TaskCard({ task, state, onAction, selected = false }: { task: CareTask; state: FarmState; onAction: (task: CareTask, type: TaskAction) => void; selected?: boolean }) {
  const plot = state.plots.find((item) => item.id === task.plotId);
  const isDue = getDueTasks(state).some((item) => item.id === task.id);
  const status = task.status === 'done' ? 'Done' : task.status === 'skipped' ? 'Skipped' : task.status === 'snoozed' && !isDue ? 'Snoozed' : isDue ? 'Needs a check' : 'Upcoming';
  const Icon = task.kind === 'water' ? Droplets : Sprout;
  const plotName = plot ? getBedName(state.layout, plot.slotId) : null;
  const Heading = selected ? 'h4' : 'h3';

  return (
    <article
      className={`task-card${status === 'Done' ? ' task-done' : ''}${selected ? ' plot-care-task' : ''}`}
      data-testid={selected ? 'selected-task' : undefined}
      data-care-kind={task.kind}
      aria-label={plotName ? `${plotName} ${task.title}` : task.title}
    >
      {!selected && <>
        <div className="task-card-top">
          <span className="task-symbol"><Icon size={20} aria-hidden="true" /></span>
          <span className={`task-status ${isDue ? 'attention' : ''}`}>
            {isDue ? <span className="status-dot" /> : <Check size={12} />}{status}
          </span>
        </div>
        <p className="task-plot">
          {plot ? `${plotName} · ${cropName(plot.cropId)}` : 'Past planting'}
          <span> · {isDue ? 'Today' : displayDate(task.snoozedUntil ?? task.dueOn)}</span>
        </p>
      </>}
      <Heading>{task.title}</Heading>
      <details className="task-why">
        <summary>Details <ChevronRight size={13} /></summary>
        <p>{task.reason}</p>
        <span className="small muted">Demo reminder</span>
      </details>
      {isDue && <>
        <button className="button primary full-width" onClick={() => onAction(task, 'complete_task')}>
          <Check size={17} />{task.kind === 'water' ? 'Watered' : 'Done'}
        </button>
        <div className="task-alternatives">
          <button onClick={() => onAction(task, 'skip_task')}>Skip</button>
          <button onClick={() => onAction(task, 'snooze_task')}>Remind me tomorrow <ArrowRight size={13} /></button>
        </div>
      </>}
    </article>
  );
}

function PlotEditor({ state, slotId, selectedCrop, viewDate, dueWatering, onAction, onTaskAction }: {
  state: FarmState;
  slotId: number;
  selectedCrop?: CropId;
  viewDate: string;
  dueWatering?: CareTask;
  onAction: (action: FarmAction, message?: string) => void;
  onTaskAction: (task: CareTask, type: TaskAction) => void;
}) {
  const plot = state.plots.find((item) => item.slotId === slotId);
  const [cropId, setCropId] = useState<CropId>(plot?.cropId ?? selectedCrop ?? 'wheat');
  const [plantedOn, setPlantedOn] = useState(plot?.plantedOn ?? state.analysis?.cropOptions.find((option) => option.cropId === (selectedCrop ?? 'wheat'))?.recommendedPlantingDate ?? state.demoToday);
  const recommendedDate = state.analysis?.cropOptions.find((option) => option.cropId === cropId)?.recommendedPlantingDate;
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!plot);
  const previewing = viewDate !== state.demoToday;
  const bedName = getBedName(state.layout, slotId);
  if (!plot && previewing) return <section className="plot-summary"><span className="eyebrow">{bedName}</span><h3>Empty bed</h3></section>;
  if (plot && (!editing || previewing)) {
    const stage = getGrowthStage(plot, viewDate);
    const lastWatering = getLastWatering(state, plot.id);
    const wateredToday = lastWatering === state.demoToday;
    return (
      <section className="plot-summary" aria-label={bedName} data-testid="plot-card">
        <div className="plot-summary-top">
          <span className="crop-portrait small-portrait">
            {stage === 'Planned' ? <Sprout size={22} aria-hidden="true" /> : <CropSprite cropId={plot.cropId} stage={stage} size={42} />}
          </span>
          <div><span className="eyebrow">{bedName}</span><h3>{cropName(plot.cropId)}</h3></div>
          <span className="growth-dot" />
        </div>
        <div className="plot-detail"><span>Estimated stage</span><strong>{stage}</strong></div>
        <div className="plot-detail"><span>{plot.cropId === 'tomato' ? 'Transplant date' : stage === 'Planned' ? 'Planting date' : 'Planted'}</span><strong>{displayDate(plot.plantedOn)}</strong></div>
        {previewing ? <p className="plot-preview-label">Season preview</p> : <>
          {lastWatering && <div className="plot-detail"><span>Last watered</span><strong>{wateredToday ? 'Today' : displayDate(lastWatering)}</strong></div>}
          <button className="text-button" onClick={() => setEditing(true)}>Edit planting <Settings2 size={14} /></button>
          {stage !== 'Planned' && !wateredToday && (dueWatering
            ? <TaskCard task={dueWatering} state={state} onAction={onTaskAction} selected />
            : <button type="button" className="button secondary full-width plot-water-button"
                onClick={() => onAction({ type: 'record_watering', plotId: plot.id }, 'Irrigation logged.')}>
                <Droplets size={17} aria-hidden="true" />Watered
              </button>)}
        </>}
      </section>
    );
  }
  return <form className="plot-editor" onSubmit={(event) => {
    event.preventDefault();
    if (!dateSchema.safeParse(plantedOn).success) { setError('Choose a valid date.'); return; }
    onAction(plot ? { type: 'edit_plot', plotId: plot.id, cropId, plantedOn } : { type: 'plant', slotId, cropId, plantedOn }, `${cropName(cropId)} ${plot ? 'updated' : 'planted'} in ${getBedName(state.layout, slotId)}.`);
    setError(null);
    setEditing(false);
  }}>
    <div className="plot-editor-heading"><span className="eyebrow">{bedName}</span><h3>{plot ? 'Edit planting' : 'Plant crop'}</h3></div>
    <Select label="Crop" value={cropId} onChange={(value) => {
      setCropId(value as CropId);
      if (!plot) setPlantedOn(state.analysis?.cropOptions.find((option) => option.cropId === value)?.recommendedPlantingDate ?? state.demoToday);
    }} options={CROP_CATALOG.map((crop) => ({ value: crop.id, label: crop.name }))} />
    {recommendedDate && <p className="field-hint">{state.analysis?.dataMode === 'mock' ? 'Demo planting recommendation' : 'Recommended planting'}: {displayDate(recommendedDate)}</p>}
    <label>{cropId === 'tomato' ? 'Transplant date' : 'Planting date'}<input type="date" value={plantedOn} onChange={(event) => setPlantedOn(event.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary full-width" type="submit"><Sprout size={16} />{plot ? 'Save planting' : 'Plant crop'}</button>
    {plot && <div className="task-alternatives">
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
      <button className="danger-text" type="button" onClick={() => {
        if (window.confirm(`Remove ${cropName(plot.cropId)} from ${bedName}?`)) onAction({ type: 'remove_plot', plotId: plot.id }, 'Planting removed. Your journal history is preserved.');
      }}><Trash2 size={13} />Remove crop</button>
    </div>}
  </form>;
}

function JournalRow({ entry, state, onUndo }: { entry: JournalEntry; state: FarmState; onUndo: () => void }) {
  const plot = state.plots.find((item) => item.id === entry.plotId);
  const label = entry.action === 'watered' ? 'Irrigation logged' : entry.action === 'skipped' ? 'Task skipped' : entry.action === 'snoozed' ? 'Reminder moved to tomorrow' : 'Care task completed';
  return <article className={`journal-row ${entry.undone ? 'undone' : ''}`} data-testid="journal-entry"><span className="journal-row-icon">{entry.action === 'watered' ? <Droplets size={22} /> : entry.action === 'snoozed' ? <CalendarDays size={22} /> : <Check size={22} />}</span><div><span className="small muted">{displayDate(entry.createdOn)}{plot ? ` · ${getBedName(state.layout, plot.slotId)} · ${cropName(plot.cropId)}` : ' · Past planting'}</span><h3>{label}</h3></div>{canUndoJournalEntry(state, entry) && <button className="button secondary compact" onClick={onUndo}><Undo2 size={15} />Undo</button>}{entry.undone && <span className="muted small">Undone</span>}</article>;
}
