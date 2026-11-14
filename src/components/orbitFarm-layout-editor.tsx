import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, MousePointer2, Pencil, Plus, Redo2, Trash2, Undo2, X } from 'lucide-react';
import { createDefaultLayout, getPlotLabel, validateFarmLayout } from '../domain/orbitFarm-domain';
import type { FarmBed, FarmLayout, LayoutPoint } from '../domain/orbitFarm-types';
import { getSchematicLabelPosition } from './orbitFarm-farm-scene';
import './orbitFarm-layout-editor.css';

export interface FarmLayoutEditorProps {
  layout: FarmLayout;
  onSave: (layout: FarmLayout) => void;
  onCancel: () => void;
  plantedSlotIds: number[];
  onDirtyChange?: (dirty: boolean) => void;
}

type Drag = { pointerId: number; slotId: number; vertex: number | null; start: LayoutPoint; original: FarmLayout; candidate: FarmLayout };
const clone = (layout: FarmLayout) => structuredClone(layout);
const same = (a: FarmLayout, b: FarmLayout) => JSON.stringify(a) === JSON.stringify(b);
const pointsText = (points: LayoutPoint[]) => points.map(point => `${point.x},${point.y}`).join(' ');
const round = (value: number) => Math.round(value * 100) / 100;
const rectangle = (x: number, y: number, width: number, height: number): LayoutPoint[] => [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];

export function FarmLayoutEditor({ layout, onSave, onCancel, plantedSlotIds, onDirtyChange }: FarmLayoutEditorProps) {
  const [draft, setDraft] = useState(() => clone(layout));
  const [past, setPast] = useState<FarmLayout[]>([]);
  const [future, setFuture] = useState<FarmLayout[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(layout.beds[0]?.slotId ?? null);
  const [vertex, setVertex] = useState(0);
  const [tool, setTool] = useState<'select' | 'draw'>('select');
  const [drawing, setDrawing] = useState<LayoutPoint[]>([]);
  const [pointer, setPointer] = useState<LayoutPoint | null>(null);
  const [preview, setPreview] = useState<FarmLayout | null>(null);
  const [dragging, setDragging] = useState(false);
  const [snap, setSnap] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('Choose a bed to adjust its shape, or draw something new.');
  const [pointX, setPointX] = useState('1');
  const [pointY, setPointY] = useState('1');
  const [cornerX, setCornerX] = useState(String(layout.beds[0]?.points[0]?.x ?? ''));
  const [cornerY, setCornerY] = useState(String(layout.beds[0]?.points[0]?.y ?? ''));
  const [name, setName] = useState(layout.beds[0]?.name ?? '');
  const board = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const drawingPress = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const nextId = useRef(Math.max(-1, ...layout.beds.map(bed => bed.slotId)) + 1);
  const unique = useId().replaceAll(':', '');
  const shown = preview ?? draft;
  const selected = draft.beds.find(bed => bed.slotId === selectedId);
  const corner = selected?.points[Math.min(vertex, selected.points.length - 1)];
  const valid = validateFarmLayout(draft);
  const invalidPreview = preview !== null && !validateFarmLayout(preview).valid;
  const pendingFields = Boolean(selected && (name.trim() !== selected.name || !cornerX.trim() || !cornerY.trim() || Number(cornerX) !== corner?.x || Number(cornerY) !== corner?.y));
  const dirty = !same(layout, draft) || drawing.length > 0 || pendingFields;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { setName(selected?.name ?? ''); }, [selectedId, selected?.name]);
  useEffect(() => { setCornerX(String(corner?.x ?? '')); setCornerY(String(corner?.y ?? '')); }, [selectedId, vertex, corner?.x, corner?.y]);
  useEffect(() => {
    const svg = board.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    let previousWidth = svg.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = svg.getBoundingClientRect().width;
      if (Math.abs(previousWidth - width) > 1 && drag.current) {
        const pointerId = drag.current.pointerId;
        if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
        drag.current = null; setPreview(null); setDragging(false);
        setMessage('Move cancelled after resizing. Your last saved shape is unchanged.');
      }
      previousWidth = width;
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  function position(event: { clientX: number; clientY: number }): LayoutPoint | null {
    const svg = board.current, matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return null;
    const point = svg.createSVGPoint(); point.x = event.clientX; point.y = event.clientY;
    const converted = point.matrixTransform(matrix.inverse());
    return { x: snap ? Math.round(converted.x * 2) / 2 : round(converted.x), y: snap ? Math.round(converted.y * 2) / 2 : round(converted.y) };
  }
  function commit(next: FarmLayout, announcement?: string) {
    const checked = validateFarmLayout(next);
    if (!checked.valid) { setError(checked.errors[0] ?? 'This shape cannot be saved.'); return false; }
    if (!same(draft, next)) { setPast(history => [...history.slice(-39), clone(draft)]); setFuture([]); setDraft(clone(next)); }
    setError(null);
    if (announcement) setMessage(announcement);
    return true;
  }
  function updateBed(bed: FarmBed, announcement: string) { return commit({ ...draft, beds: draft.beds.map(item => item.slotId === bed.slotId ? bed : item) }, announcement); }
  function withPendingFields(): FarmLayout | null {
    if (!selected || !pendingFields) return draft;
    const x = Number(cornerX), y = Number(cornerY);
    if (!cornerX.trim() || !cornerY.trim() || !Number.isFinite(x) || !Number.isFinite(y)) { setError('Enter a number for each corner coordinate, or revert the fields.'); return null; }
    const next = { ...draft, beds: draft.beds.map(bed => bed.slotId !== selected.slotId ? bed : { ...bed, name: name.trim(), points: bed.points.map((point, index) => index === vertex ? { x, y } : point) }) };
    const checked = validateFarmLayout(next);
    if (!checked.valid) { setError(checked.errors[0] ?? 'Check the selected bed before continuing.'); return null; }
    return next;
  }
  function selectBed(slotId: number | null) {
    const next = withPendingFields(); if (!next) return;
    if (!same(draft, next)) commit(next, 'Bed changes applied.');
    setSelectedId(slotId); setVertex(0); setTool('select'); setError(null);
  }
  function beginDrawing() {
    const next = withPendingFields(); if (!next) return;
    if (!same(draft, next)) commit(next, 'Bed changes applied.');
    setTool('draw'); setSelectedId(null); setError(null);
  }
  function selectCorner(index: number) {
    const next = withPendingFields(); if (!next) return;
    if (!same(draft, next)) commit(next, 'Bed changes applied.');
    setVertex(index);
  }
  function save() { const next = withPendingFields(); if (next) onSave(clone(next)); }
  function revertFields() {
    setName(selected?.name ?? ''); setCornerX(String(corner?.x ?? '')); setCornerY(String(corner?.y ?? '')); setError(null); setMessage('Unapplied fields reverted.');
  }
  function addPoint(point: LayoutPoint) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 24 || point.y < 0 || point.y > 12) { setError('Place each corner inside the 24 × 12 planning area.'); return; }
    if (drawing.length >= 32) { setError('A bed can have at most 32 corners.'); return; }
    if (drawing.some(item => Math.hypot(item.x - point.x, item.y - point.y) < .01)) { setError('That corner is already in this bed. Use Finish bed to close it.'); return; }
    setDrawing(points => [...points, point]); setPointX(String(point.x)); setPointY(String(point.y)); setError(null);
  }
  function finishBed() {
    if (drawing.length < 3) { setError('Add at least three corners before finishing a bed.'); return; }
    const slotId = nextId.current;
    const bed: FarmBed = { slotId, name: getPlotLabel(slotId), points: drawing };
    if (commit({ ...draft, beds: [...draft.beds, bed] }, `${bed.name} added. Its planting will be assigned after saving the layout.`)) {
      nextId.current++; setSelectedId(slotId); setVertex(0); setDrawing([]); setPointer(null); setTool('select');
    }
  }
  function startDrag(event: ReactPointerEvent<SVGGElement>, slotId: number, cornerIndex: number | null) {
    if (tool !== 'select' || event.button !== 0) return;
    if (pendingFields) { event.preventDefault(); event.stopPropagation(); setError('Apply or revert your current bed fields before dragging. Save layout also applies valid fields.'); return; }
    const start = position(event);
    if (!start) return;
    event.preventDefault(); event.stopPropagation();
    setSelectedId(slotId); if (cornerIndex !== null) setVertex(cornerIndex); else setVertex(0);
    drag.current = { pointerId: event.pointerId, slotId, vertex: cornerIndex, start, original: clone(draft), candidate: clone(draft) };
    board.current?.setPointerCapture(event.pointerId); setDragging(true); setError(null);
  }
  function movePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const at = position(event);
    if (!at) return;
    if (tool === 'draw') { setPointer(at.x >= 0 && at.x <= 24 && at.y >= 0 && at.y <= 12 ? at : null); return; }
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = round(at.x - active.start.x), dy = round(at.y - active.start.y);
    const candidate: FarmLayout = { ...active.original, beds: active.original.beds.map(bed => bed.slotId !== active.slotId ? bed : { ...bed, points: bed.points.map((point, index) => active.vertex === null || active.vertex === index ? { x: round(point.x + dx), y: round(point.y + dy) } : point) }) };
    active.candidate = candidate; setPreview(candidate);
  }
  function endPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (active && active.pointerId === event.pointerId) {
      drag.current = null; setPreview(null); setDragging(false);
      if (board.current?.hasPointerCapture(event.pointerId)) board.current.releasePointerCapture(event.pointerId);
      commit(active.candidate, active.vertex === null ? 'Bed moved. Planting and care history stay connected.' : 'Corner updated.');
      return;
    }
    const press = drawingPress.current; drawingPress.current = null;
    if (tool === 'draw' && press?.pointerId === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 8) {
      const at = position(event);
      if (!at) return;
      if (drawing.length >= 3 && Math.hypot(at.x - drawing[0].x, at.y - drawing[0].y) < .55) finishBed(); else addPoint(at);
    }
  }
  function cancelPointer() { drag.current = null; drawingPress.current = null; setPreview(null); setDragging(false); }
  function moveBed(dx: number, dy: number) {
    const next = withPendingFields(); if (!next || !selected) return;
    commit({ ...next, beds: next.beds.map(bed => bed.slotId !== selected.slotId ? bed : { ...bed, points: bed.points.map(point => ({ x: round(point.x + dx), y: round(point.y + dy) })) }) }, 'Bed moved. Planting and care history stay connected.');
  }
  function updateCorner() {
    if (!selected) return;
    const x = Number(cornerX), y = Number(cornerY);
    if (!cornerX.trim() || !cornerY.trim() || !Number.isFinite(x) || !Number.isFinite(y)) { setError('Enter a number for each corner coordinate.'); return; }
    updateBed({ ...selected, points: selected.points.map((point, index) => index === vertex ? { x, y } : point) }, 'Corner updated.');
  }
  function removeBed() {
    if (!selected) return;
    commit({ ...draft, beds: draft.beds.filter(bed => bed.slotId !== selected.slotId) }, 'Bed removed from this draft. Save layout to apply your changes.');
    setSelectedId(null); setVertex(0);
  }
  function applyPattern(pattern: 'classic' | 'rows' | 'patchwork') {
    if ((draft.beds.length || drawing.length) && !window.confirm('Replace the draft with this pattern? Changes are applied only when you save the layout.')) return;
    let shapes: LayoutPoint[][];
    if (pattern === 'classic') shapes = createDefaultLayout().beds.map(bed => bed.points);
    else if (pattern === 'rows') shapes = [1, 4.5, 8].map(y => rectangle(1, y, 22, 2.5));
    else shapes = [
      [{ x: 1, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 1, y: 10 }],
      [{ x: 10, y: 1 }, { x: 16, y: 1 }, { x: 19, y: 4 }, { x: 16, y: 7 }, { x: 10, y: 7 }],
      [{ x: 20, y: 1 }, { x: 23, y: 1 }, { x: 23, y: 11 }, { x: 18, y: 11 }, { x: 18, y: 8 }, { x: 21, y: 8 }, { x: 21, y: 5 }, { x: 20, y: 4 }],
      rectangle(6, 8, 10, 3),
    ];
    const beds = shapes.map((points, index) => {
      const existing = draft.beds[index];
      const slotId = existing?.slotId ?? nextId.current++;
      return { slotId, name: existing?.name ?? getPlotLabel(slotId), points };
    });
    if (commit({ width: 24, height: 12, beds }, 'Pattern applied to your draft. Adjust any corner to make it yours.')) { setDrawing([]); setPointer(null); setTool('select'); setSelectedId(beds[0]?.slotId ?? null); setVertex(0); }
  }
  function undo() {
    if (pendingFields) { revertFields(); return; }
    const previous = past.at(-1); if (!previous) return;
    setFuture(items => [clone(draft), ...items]); setPast(items => items.slice(0, -1)); setDraft(previous); setVertex(0); setDrawing([]); setPreview(null); setError(null); setMessage('Layout change undone.');
  }
  function redo() {
    const next = future[0]; if (!next) return;
    setPast(items => [...items, clone(draft)]); setFuture(items => items.slice(1)); setDraft(next); setVertex(0); setError(null); setMessage('Layout change restored.');
  }
  function cancel() { if (!dirty || window.confirm('Discard the unsaved layout changes? Your saved farm will stay unchanged.')) onCancel(); }

  return <section className="of-layout-editor" data-testid="layout-editor" aria-labelledby={`${unique}-title`}>
    <header className="of-layout-header"><div><span className="eyebrow">A LITTLE SPACE, YOUR OWN WAY</span><h1 id={`${unique}-title`}>Design your beds</h1><p>Draw any simple shape. Give every crop its own little corner.</p></div><div className="of-layout-save-actions"><button className="button secondary" onClick={cancel}><X size={16} />Cancel</button><button className="button primary" disabled={!valid.valid || drawing.length > 0 || dragging} onClick={save}><Check size={16} />Save layout</button></div></header>
    <div className="of-layout-toolbar" aria-label="Layout tools"><div className="of-layout-modes"><button className={tool === 'select' ? 'active' : ''} aria-pressed={tool === 'select'} disabled={drawing.length > 0} onClick={() => { setTool('select'); setError(null); }}><MousePointer2 size={17} />Select & move</button><button className={tool === 'draw' ? 'active' : ''} aria-pressed={tool === 'draw'} disabled={draft.beds.length >= 24} onClick={beginDrawing}><Pencil size={17} />Draw bed</button></div><div className="of-layout-history"><button aria-label="Undo" disabled={(!past.length && !pendingFields) || drawing.length > 0 || dragging} onClick={undo}><Undo2 size={17} /><span>Undo</span></button><button aria-label="Redo" disabled={!future.length || pendingFields || drawing.length > 0 || dragging} onClick={redo}><Redo2 size={17} /><span>Redo</span></button></div><label className="of-layout-snap"><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} />Snap to grid</label></div>
    <div className="of-layout-workspace"><div className="of-layout-canvas-panel"><div className="of-layout-board-heading"><span><span className="live-dot" />Your planting canvas</span><span>{draft.beds.length} / 24 beds</span></div>
      <svg ref={board} viewBox="0 0 24 12" className={`of-layout-board${tool === 'draw' ? ' is-drawing' : ''}${dragging ? ' is-dragging' : ''}`} data-testid="layout-board" aria-label="Farm bed layout canvas" tabIndex={0}
        onPointerDown={event => { if (event.button !== 0) return; if (tool === 'draw') drawingPress.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }; else if (event.target === event.currentTarget || (event.target as SVGElement).dataset.canvasBackground) selectBed(null); }}
        onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={cancelPointer}
        onKeyDown={event => { if (tool === 'draw' && event.key === 'Enter') { event.preventDefault(); finishBed(); } if (tool === 'draw' && event.key === 'Escape') { setDrawing([]); setPointer(null); setTool('select'); } }}>
        <defs><pattern id={`${unique}-grid`} width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#93ad7c" strokeWidth=".035" /><circle cx="0" cy="0" r=".055" fill="#799966" /></pattern></defs>
        <rect data-canvas-background="true" width="24" height="12" fill="#e7efda" /><rect data-canvas-background="true" width="24" height="12" fill={`url(#${unique}-grid)`} />
        {shown.beds.map(bed => { const label = getSchematicLabelPosition(bed.points).point; return <g key={bed.slotId} className={`of-layout-bed${selectedId === bed.slotId ? ' selected' : ''}${invalidPreview && drag.current?.slotId === bed.slotId ? ' invalid' : ''}`} role="button" tabIndex={0} aria-label={`${bed.name} on canvas`} aria-pressed={selectedId === bed.slotId} data-testid={`layout-bed-${bed.slotId}`} onPointerDown={event => startDrag(event, bed.slotId, null)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectBed(bed.slotId); } if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); if (pendingFields) { setError('Apply or revert your current bed fields before moving with the keyboard.'); return; } if (bed.slotId !== selectedId) setVertex(0); setSelectedId(bed.slotId); const dx = event.key === 'ArrowLeft' ? -.5 : event.key === 'ArrowRight' ? .5 : 0; const dy = event.key === 'ArrowUp' ? -.5 : event.key === 'ArrowDown' ? .5 : 0; updateBed({ ...bed, points: bed.points.map(point => ({ x: round(point.x + dx), y: round(point.y + dy) })) }, 'Bed moved.'); } }}>
          <polygon points={pointsText(bed.points)} data-testid={`layout-shape-${bed.slotId}`} />
          <text x={label.x} y={label.y} aria-hidden="true">{getPlotLabel(bed.slotId).replace('Plot ', '')}</text>
        </g>; })}
        {tool === 'select' && shown.beds.find(bed => bed.slotId === selectedId)?.points.map((point, index) => <g key={index} className={`of-layout-vertex${vertex === index ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`Corner ${index + 1} of ${selected?.name ?? 'bed'}`} data-testid={`layout-vertex-${index}`} onPointerDown={event => startDrag(event, selectedId!, index)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setVertex(index); } }}><circle className="hit-area" cx={point.x} cy={point.y} r=".65" /><circle cx={point.x} cy={point.y} r=".22" /><text x={point.x} y={point.y - .45} aria-hidden="true">{index + 1}</text></g>)}
        {drawing.length > 0 && <g className="of-layout-drawing" aria-hidden="true"><polygon points={pointsText(drawing)} /><polyline points={pointsText(pointer ? [...drawing, pointer] : drawing)} />{drawing.map((point, index) => <g key={index} onPointerDown={event => event.stopPropagation()} onPointerUp={event => { event.stopPropagation(); if (index === 0 && drawing.length >= 3) finishBed(); }}><circle className="hit-area" cx={point.x} cy={point.y} r=".65" /><circle cx={point.x} cy={point.y} r={index === 0 ? '.24' : '.17'} /><text x={point.x} y={point.y - .4}>{index + 1}</text></g>)}</g>}
      </svg>
      <div className="of-layout-canvas-footer"><span>{tool === 'draw' ? `${drawing.length} corners placed · finish with at least 3` : 'Drag a bed or one of its corners'}</span><span>24 × 12 · schematic, not to scale</span></div>
      <p className="of-layout-status" role="status">{tool === 'draw' ? 'Tap to place corners. Tap the first corner again, or choose Finish bed.' : message}</p>
      {error && <div className="of-layout-error" role="alert">{error} Your last valid layout is preserved.</div>}
      <div className="of-layout-patterns"><div><strong>A starting point</strong><p>Make a pattern yours, then adjust any corner.</p></div><div><button onClick={() => applyPattern('classic')}>Classic 3 × 2</button><button onClick={() => applyPattern('rows')}>Long rows</button><button onClick={() => applyPattern('patchwork')}>Patchwork</button></div></div>
    </div><aside className="of-layout-inspector" aria-label="Bed design controls">
      {tool === 'draw' ? <section className="of-layout-control-card"><span className="eyebrow">A NEW LITTLE PATCH</span><h2>Draw your shape</h2><p>Add corners on the canvas, or enter precise coordinates below.</p><div className="of-layout-coordinate-row"><label>Point X<input type="number" min="0" max="24" step=".5" value={pointX} onChange={event => setPointX(event.target.value)} /></label><label>Point Y<input type="number" min="0" max="12" step=".5" value={pointY} onChange={event => setPointY(event.target.value)} /></label></div><button className="button secondary full-width" onClick={() => { if (!pointX.trim() || !pointY.trim()) { setError('Enter a number for each point coordinate.'); return; } addPoint({ x: Number(pointX), y: Number(pointY) }); }}><Plus size={16} />Add point</button><div className="of-layout-drawing-actions"><button disabled={!drawing.length} onClick={() => { setDrawing(points => points.slice(0, -1)); setError(null); }}>Undo point</button><button onClick={() => { setDrawing([]); setPointer(null); setTool('select'); setError(null); }}>Cancel drawing</button></div><button className="button primary full-width" disabled={drawing.length < 3} onClick={finishBed}><Check size={16} />Finish bed</button><p className="of-layout-hint">Simple polygons only. Beds can touch, but their planted areas cannot overlap.</p></section> : selected ? <section className="of-layout-control-card"><span className="eyebrow">YOUR SELECTED BED</span><h2>{selected.name}</h2><p>{plantedSlotIds.includes(selected.slotId) ? 'Planted · moving this bed keeps its crop and care history.' : 'Unplanted · assign a crop after saving.'}</p><label>Bed name<input type="text" maxLength={40} value={name} onChange={event => setName(event.target.value)} /></label><button className="of-layout-text-button" onClick={() => updateBed({ ...selected, name: name.trim() }, 'Bed renamed.')}>Rename bed</button><div className="of-layout-divider" />{pendingFields && <div className="of-layout-pending"><span>Unsaved fields · Save layout will apply them.</span><button className="of-layout-text-button" onClick={revertFields}>Revert fields</button></div>}<strong className="of-layout-small-heading">Move the whole bed</strong><div className="of-layout-move-controls"><button aria-label="Move bed left" onClick={() => moveBed(-.5, 0)}><ArrowLeft size={18} /></button><button aria-label="Move bed up" onClick={() => moveBed(0, -.5)}><ArrowUp size={18} /></button><button aria-label="Move bed down" onClick={() => moveBed(0, .5)}><ArrowDown size={18} /></button><button aria-label="Move bed right" onClick={() => moveBed(.5, 0)}><ArrowRight size={18} /></button></div><span className="of-layout-hint">Each step moves the bed by 0.5 cells.</span><div className="of-layout-divider" /><strong className="of-layout-small-heading">Fine-tune a corner</strong><div className="of-layout-corner-picker" aria-label="Choose a corner">{selected.points.map((_, index) => <button key={index} aria-label={`Edit corner ${index + 1}`} aria-pressed={vertex === index} onClick={() => selectCorner(index)}>{index + 1}</button>)}</div><div className="of-layout-coordinate-row"><label>Corner X<input type="number" min="0" max="24" step=".5" value={cornerX} onChange={event => setCornerX(event.target.value)} /></label><label>Corner Y<input type="number" min="0" max="12" step=".5" value={cornerY} onChange={event => setCornerY(event.target.value)} /></label></div><button className="button secondary full-width" onClick={updateCorner}>Update corner</button><div className="of-layout-drawing-actions"><button disabled={pendingFields || selected.points.length >= 32} onClick={() => { const a = selected.points[vertex], b = selected.points[(vertex + 1) % selected.points.length]; const points = [...selected.points]; points.splice(vertex + 1, 0, { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) }); if (updateBed({ ...selected, points }, 'Corner added.')) setVertex(vertex + 1); }}>Add corner</button><button disabled={pendingFields || selected.points.length <= 3} onClick={() => { if (updateBed({ ...selected, points: selected.points.filter((_, index) => index !== vertex) }, 'Corner removed.')) setVertex(Math.max(0, vertex - 1)); }}>Remove corner</button></div><div className="of-layout-divider" /><button className="of-layout-delete" onClick={removeBed}><Trash2 size={16} />Delete bed</button></section> : <section className="of-layout-control-card of-layout-empty"><MousePointer2 size={30} /><h2>Your shape, your way.</h2><p>Select a bed to move it, change its corners, or give it a name.</p><button className="button primary" disabled={draft.beds.length >= 24} onClick={beginDrawing}><Pencil size={16} />Draw a bed</button></section>}
      <section className="of-layout-bed-list"><div><strong>Your beds</strong><span>{draft.beds.length}</span></div>{draft.beds.length ? draft.beds.map(bed => <button key={bed.slotId} aria-label={`Select ${bed.name}`} aria-pressed={selectedId === bed.slotId} disabled={drawing.length > 0} onClick={() => selectBed(bed.slotId)}><span className="of-layout-bed-swatch" aria-hidden="true">{getPlotLabel(bed.slotId).replace('Plot ', '')}</span><span>{bed.name}</span><small>{plantedSlotIds.includes(bed.slotId) ? 'Planted' : `${bed.points.length} corners`}</small></button>) : <p>No beds yet. Draw one or try a pattern.</p>}</section>
    </aside></div>
  </section>;
}
